-- Phase 18: レジ会計全体の割引と請求への引き継ぎ
-- 0001〜0010 を適用済みの Supabase SQL Editor で実行する。

begin;

-- 明細割引（sale_items / invoice_items.discount_yen）とは別に、税計算後の会計全体へ適用する割引を保持する。
alter table public.sales
  add column if not exists pre_order_discount_total_yen bigint,
  add column if not exists order_discount_type text,
  add column if not exists order_discount_amount_yen bigint,
  add column if not exists order_discount_rate_basis_points integer;

alter table public.invoices
  add column if not exists pre_order_discount_total_yen bigint,
  add column if not exists order_discount_type text,
  add column if not exists order_discount_amount_yen bigint,
  add column if not exists order_discount_rate_basis_points integer;

-- 既存行は「割引なし」とし、従来の合計を割引前合計として保持する。
update public.sales
set pre_order_discount_total_yen = total_amount_yen,
    order_discount_type = 'none',
    order_discount_amount_yen = 0,
    order_discount_rate_basis_points = null
where pre_order_discount_total_yen is null;

update public.invoices
set pre_order_discount_total_yen = total_amount_yen,
    order_discount_type = 'none',
    order_discount_amount_yen = 0,
    order_discount_rate_basis_points = null
where pre_order_discount_total_yen is null;

alter table public.sales
  alter column pre_order_discount_total_yen set default 0,
  alter column pre_order_discount_total_yen set not null,
  alter column order_discount_type set default 'none',
  alter column order_discount_type set not null,
  alter column order_discount_amount_yen set default 0,
  alter column order_discount_amount_yen set not null;

alter table public.invoices
  alter column pre_order_discount_total_yen set default 0,
  alter column pre_order_discount_total_yen set not null,
  alter column order_discount_type set default 'none',
  alter column order_discount_type set not null,
  alter column order_discount_amount_yen set default 0,
  alter column order_discount_amount_yen set not null;

alter table public.sales
  drop constraint if exists sales_order_discount_type_check,
  drop constraint if exists sales_order_discount_values_check,
  drop constraint if exists sales_order_discount_total_check,
  add constraint sales_order_discount_type_check check (order_discount_type in ('none', 'amount', 'rate')),
  add constraint sales_order_discount_values_check check (
    pre_order_discount_total_yen >= 0
    and order_discount_amount_yen between 0 and pre_order_discount_total_yen
    and (order_discount_rate_basis_points is null or order_discount_rate_basis_points between 0 and 10000)
    and (
      (order_discount_type = 'none' and order_discount_amount_yen = 0 and order_discount_rate_basis_points is null)
      or (order_discount_type = 'amount' and order_discount_rate_basis_points is null)
      or (order_discount_type = 'rate' and order_discount_rate_basis_points is not null)
    )
  ),
  add constraint sales_order_discount_total_check check (
    total_amount_yen = pre_order_discount_total_yen - order_discount_amount_yen
  );

alter table public.invoices
  drop constraint if exists invoices_order_discount_type_check,
  drop constraint if exists invoices_order_discount_values_check,
  drop constraint if exists invoices_order_discount_total_check,
  add constraint invoices_order_discount_type_check check (order_discount_type in ('none', 'amount', 'rate')),
  add constraint invoices_order_discount_values_check check (
    pre_order_discount_total_yen >= 0
    and order_discount_amount_yen between 0 and pre_order_discount_total_yen
    and (order_discount_rate_basis_points is null or order_discount_rate_basis_points between 0 and 10000)
    and (
      (order_discount_type = 'none' and order_discount_amount_yen = 0 and order_discount_rate_basis_points is null)
      or (order_discount_type = 'amount' and order_discount_rate_basis_points is null)
      or (order_discount_type = 'rate' and order_discount_rate_basis_points is not null)
    )
  ),
  add constraint invoices_order_discount_total_check check (
    total_amount_yen = pre_order_discount_total_yen - order_discount_amount_yen
  );

-- 既存の手動請求RPCなどが割引項目を指定しない場合は、割引なしの整合した値へ自動補完する。
create or replace function public.normalize_order_discount_totals()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_discount_type = 'none' then
    new.pre_order_discount_total_yen := new.total_amount_yen;
    new.order_discount_amount_yen := 0;
    new.order_discount_rate_basis_points := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_normalize_order_discount on public.sales;
create trigger sales_normalize_order_discount
before insert or update on public.sales
for each row execute function public.normalize_order_discount_totals();

drop trigger if exists invoices_normalize_order_discount on public.invoices;
create trigger invoices_normalize_order_discount
before insert or update on public.invoices
for each row execute function public.normalize_order_discount_totals();

-- 売上から請求を作る共通処理。会計全体の割引と最終合計をそのままスナップショットする。
create or replace function public.create_invoice_from_sale_internal(
  p_sale_id uuid,
  p_subject text default null,
  p_billing_month date default null,
  p_due_date date default null,
  p_require_admin boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_role public.app_role;
  v_sale public.sales%rowtype;
  v_existing_invoice_id uuid;
  v_existing_invoice_number text;
  v_existing_status public.invoice_status;
  v_invoice_prefix text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_payment_method_name text;
  v_subject text;
  v_billing_month date;
  v_item_count integer;
  v_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;
  if p_require_admin and v_role <> 'admin' then raise exception '請求データの作成は管理者のみ実行できます。'; end if;

  select sale.* into v_sale
  from public.sales sale
  where sale.id = p_sale_id and sale.organization_id = v_organization_id and sale.deleted_at is null
  for update;
  if v_sale.id is null then raise exception '対象の売上が見つかりません。'; end if;
  if v_sale.status <> 'confirmed' then raise exception '確定済みの売上のみ請求データを作成できます。'; end if;

  select invoice.id, invoice.invoice_number, invoice.status
    into v_existing_invoice_id, v_existing_invoice_number, v_existing_status
  from public.invoices invoice
  where invoice.organization_id = v_organization_id
    and invoice.source_sale_id = v_sale.id
    and invoice.deleted_at is null
    and invoice.status <> 'cancelled'
  order by invoice.created_at desc
  limit 1;
  if v_existing_invoice_id is not null then
    return jsonb_build_object(
      'invoice_id', v_existing_invoice_id, 'invoice_number', v_existing_invoice_number,
      'status', v_existing_status, 'source_sale_id', v_sale.id, 'already_exists', true
    );
  end if;

  select settings.invoice_number_prefix into v_invoice_prefix
  from public.organization_settings settings
  where settings.organization_id = v_organization_id;
  if v_invoice_prefix is null then raise exception '請求番号のプレフィックスが未設定です。発行元設定を確認してください。'; end if;

  select payment.payment_method_name_snapshot into v_payment_method_name
  from public.payments payment
  where payment.organization_id = v_organization_id and payment.sale_id = v_sale.id
  order by payment.created_at limit 1;

  v_subject := coalesce(nullif(btrim(p_subject), ''), '売上 ' || v_sale.sale_number || ' 分');
  v_billing_month := coalesce(p_billing_month, date_trunc('month', v_sale.sale_date)::date);
  if p_due_date is not null and p_due_date < v_billing_month then raise exception '支払期限は請求月以降の日付を指定してください。'; end if;
  v_invoice_number := v_invoice_prefix || lpad(nextval('public.invoice_number_sequence')::text, 6, '0');

  insert into public.invoices (
    organization_id, invoice_number, source_sale_id, customer_id, customer_name_snapshot,
    payment_method_id, payment_method_name_snapshot, subject, billing_month, due_date,
    subtotal_yen, tax_amount_yen, pre_order_discount_total_yen,
    order_discount_type, order_discount_amount_yen, order_discount_rate_basis_points,
    total_amount_yen, status, created_by
  ) values (
    v_organization_id, v_invoice_number, v_sale.id, v_sale.customer_id, v_sale.customer_name_snapshot,
    v_sale.primary_payment_method_id, v_payment_method_name, v_subject, v_billing_month, p_due_date,
    v_sale.subtotal_yen, v_sale.tax_amount_yen, v_sale.pre_order_discount_total_yen,
    v_sale.order_discount_type, v_sale.order_discount_amount_yen, v_sale.order_discount_rate_basis_points,
    v_sale.total_amount_yen, 'draft', v_operator_id
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    organization_id, invoice_id, source_sale_item_id, product_id, item_name_snapshot, quantity,
    unit_price_yen, discount_yen, tax_rate_basis_points,
    line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
  )
  select
    v_organization_id, v_invoice_id, item.id, item.product_id, item.product_name_snapshot, item.quantity,
    item.unit_price_yen, item.discount_yen, item.tax_rate_basis_points,
    item.line_subtotal_yen, item.tax_amount_yen, item.line_total_yen, item.sort_order
  from public.sale_items item
  where item.organization_id = v_organization_id and item.sale_id = v_sale.id
  order by item.sort_order;
  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then raise exception '売上明細が見つからないため請求データを作成できません。'; end if;

  v_response := jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'status', 'draft',
    'source_sale_id', v_sale.id, 'already_exists', false
  );
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.created_from_sale', 'invoice', v_invoice_id, v_response);
  return v_response;
end;
$$;

-- 旧シグネチャを削除し、割引入力を含む会計RPCへ置き換える。
drop function if exists public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date);

create or replace function public.checkout_sale_with_invoice(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_payment_method_id uuid,
  p_amount_received_yen bigint,
  p_lines jsonb,
  p_create_invoice boolean default false,
  p_invoice_subject text default null,
  p_billing_month date default null,
  p_due_date date default null,
  p_order_discount_amount_yen bigint default null,
  p_order_discount_rate_basis_points integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_request_id uuid;
  v_existing_hash text;
  v_request_hash text;
  v_response jsonb;
  v_sale_response jsonb;
  v_invoice_response jsonb;
  v_sale_id uuid;
  v_payment_method_code text;
  v_rounding_mode text;
  v_pre_discount_total_yen bigint;
  v_discount_type text := 'none';
  v_discount_amount_yen bigint := 0;
  v_total_amount_yen bigint;
  v_amount_received_yen bigint;
  v_change_amount_yen bigint := 0;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_idempotency_key is null then raise exception '会計処理キーがありません。'; end if;
  if p_order_discount_amount_yen is not null and p_order_discount_rate_basis_points is not null then
    raise exception '割引金額と割引率は同時に指定できません。';
  end if;
  if p_order_discount_amount_yen is not null
    and (p_order_discount_amount_yen < 0 or p_order_discount_amount_yen > 99999999) then
    raise exception '割引金額は0〜99,999,999円で指定してください。';
  end if;
  if p_order_discount_rate_basis_points is not null
    and (p_order_discount_rate_basis_points < 0 or p_order_discount_rate_basis_points > 10000) then
    raise exception using message = '割引率は0〜100%で指定してください。';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;

  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id, 'vehicle_id', p_vehicle_id,
    'sale_date', coalesce(p_sale_date, current_date), 'payment_method_id', p_payment_method_id,
    'amount_received_yen', p_amount_received_yen, 'lines', p_lines,
    'order_discount_amount_yen', p_order_discount_amount_yen,
    'order_discount_rate_basis_points', p_order_discount_rate_basis_points,
    'invoice_subject', nullif(btrim(p_invoice_subject), ''),
    'billing_month', p_billing_month, 'due_date', p_due_date
  )::text);
  insert into public.idempotency_requests (organization_id, operation, idempotency_key, request_hash)
  values (v_organization_id, 'checkout_sale_with_order_discount', p_idempotency_key, v_request_hash)
  on conflict (organization_id, operation, idempotency_key) do nothing
  returning id into v_request_id;
  if v_request_id is null then
    select request_hash, response_json into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id
      and operation = 'checkout_sale_with_order_discount'
      and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then
      raise exception '同じ会計処理キーに異なる内容が送信されました。画面を更新してやり直してください。';
    end if;
    if v_response is null then raise exception '同じ会計処理を実行中です。しばらくしてから再試行してください。'; end if;
    return v_response;
  end if;

  -- checkout_sale 自体の検証・明細計算を再利用する。現金は割引前検証を通すため一時的な預かり上限を渡し、同一トランザクション内で実額へ更新する。
  v_sale_response := public.checkout_sale(
    gen_random_uuid(), p_customer_id, p_vehicle_id, p_sale_date,
    p_payment_method_id, 9223372036854775807::bigint, p_lines
  );
  v_sale_id := (v_sale_response ->> 'sale_id')::uuid;
  v_pre_discount_total_yen := (v_sale_response ->> 'total_amount_yen')::bigint;

  select settings.tax_rounding_mode, method.code
    into v_rounding_mode, v_payment_method_code
  from public.organization_settings settings
  join public.payment_methods method
    on method.organization_id = settings.organization_id and method.id = p_payment_method_id
  where settings.organization_id = v_organization_id;
  if v_rounding_mode is null or v_payment_method_code is null then raise exception '組織設定または支払方法を確認できません。'; end if;

  if p_order_discount_amount_yen is not null then
    v_discount_type := 'amount';
    v_discount_amount_yen := p_order_discount_amount_yen;
  elsif p_order_discount_rate_basis_points is not null then
    v_discount_type := 'rate';
    v_discount_amount_yen := public.round_yen(
      v_pre_discount_total_yen::numeric * p_order_discount_rate_basis_points::numeric / 10000,
      v_rounding_mode
    );
  end if;
  if v_discount_amount_yen > v_pre_discount_total_yen then
    raise exception '割引金額は割引前合計以下で入力してください。';
  end if;
  v_total_amount_yen := v_pre_discount_total_yen - v_discount_amount_yen;

  if v_payment_method_code = 'cash' then
    if p_amount_received_yen is null and v_total_amount_yen > 0 then raise exception '預かり金を入力してください。'; end if;
    v_amount_received_yen := coalesce(p_amount_received_yen, 0);
    if v_amount_received_yen < 0 or v_amount_received_yen < v_total_amount_yen then
      raise exception '預かり金が会計金額に不足しています。';
    end if;
    v_change_amount_yen := v_amount_received_yen - v_total_amount_yen;
  else
    v_amount_received_yen := null;
    v_change_amount_yen := 0;
  end if;

  update public.sales
  set pre_order_discount_total_yen = v_pre_discount_total_yen,
      order_discount_type = v_discount_type,
      order_discount_amount_yen = v_discount_amount_yen,
      order_discount_rate_basis_points = case when v_discount_type = 'rate' then p_order_discount_rate_basis_points else null end,
      total_amount_yen = v_total_amount_yen,
      amount_received_yen = v_amount_received_yen,
      change_amount_yen = v_change_amount_yen
  where id = v_sale_id and organization_id = v_organization_id;

  update public.payments
  set amount_yen = v_total_amount_yen,
      amount_received_yen = v_amount_received_yen,
      change_amount_yen = v_change_amount_yen
  where sale_id = v_sale_id and organization_id = v_organization_id;

  v_sale_response := v_sale_response || jsonb_build_object(
    'pre_order_discount_total_yen', v_pre_discount_total_yen,
    'order_discount_type', v_discount_type,
    'order_discount_amount_yen', v_discount_amount_yen,
    'order_discount_rate_basis_points', case when v_discount_type = 'rate' then p_order_discount_rate_basis_points else null end,
    'total_amount_yen', v_total_amount_yen,
    'change_amount_yen', v_change_amount_yen
  );

  -- checkout_sale が作った監査記録も、確定後の金額へ揃える。
  update public.audit_logs
  set after_json = v_sale_response
  where id = (
    select log.id from public.audit_logs log
    where log.organization_id = v_organization_id and log.entity_id = v_sale_id
      and log.entity_type = 'sale' and log.action = 'sale.confirmed'
    order by log.created_at desc limit 1
  );

  v_invoice_response := public.create_invoice_from_sale_internal(
    v_sale_id, p_invoice_subject, p_billing_month, p_due_date, false
  );
  v_response := v_sale_response || jsonb_build_object('invoice', v_invoice_response);
  update public.idempotency_requests
  set response_json = v_response, completed_at = now()
  where id = v_request_id;
  return v_response;
end;
$$;

revoke all on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date, bigint, integer) from public;
revoke all on function public.create_invoice_from_sale_internal(uuid, text, date, date, boolean) from public;
revoke all on function public.create_invoice_from_sale_internal(uuid, text, date, date, boolean) from authenticated;
revoke all on function public.normalize_order_discount_totals() from public;
grant execute on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date, bigint, integer) to authenticated;

commit;
