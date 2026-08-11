-- Phase 8: 売上から請求への変換
-- 0001〜0004 を適用済みのSupabase SQL Editorで実行する。

begin;

create sequence public.invoice_number_sequence start with 1 increment by 1;

-- 本体処理。p_require_admin=false は、掛売を会計と同時に自動請求化する内部呼出し専用。
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
  v_subject text;
  v_billing_month date;
  v_item_count integer;
  v_response jsonb;
begin
  if v_operator_id is null then
    raise exception 'ログインが必要です。';
  end if;

  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then
    raise exception '有効な利用者情報がありません。';
  end if;
  if p_require_admin and v_role <> 'admin' then
    raise exception '請求データの作成は管理者のみ実行できます。';
  end if;

  select sale.* into v_sale
  from public.sales sale
  where sale.id = p_sale_id
    and sale.organization_id = v_organization_id
    and sale.deleted_at is null
  for update;
  if v_sale.id is null then
    raise exception '対象の売上が見つかりません。';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception '確定済みの売上のみ請求データを作成できます。';
  end if;
  if v_sale.customer_id is null then
    raise exception '請求データの作成には顧客の選択が必要です。';
  end if;

  -- 親の売上行をロックしているため、同じ売上への同時作成も一件に収束する。
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
      'invoice_id', v_existing_invoice_id,
      'invoice_number', v_existing_invoice_number,
      'status', v_existing_status,
      'already_exists', true
    );
  end if;

  select invoice_number_prefix into v_invoice_prefix
  from public.organization_settings
  where organization_id = v_organization_id;
  if v_invoice_prefix is null then
    raise exception '請求番号のプレフィックスが未設定です。発行元設定を確認してください。';
  end if;

  v_subject := coalesce(nullif(btrim(p_subject), ''), '売上 ' || v_sale.sale_number || ' 分');
  v_billing_month := coalesce(p_billing_month, date_trunc('month', v_sale.sale_date)::date);
  if p_due_date is not null and p_due_date < v_billing_month then
    raise exception '支払期限は請求月以降の日付を指定してください。';
  end if;
  v_invoice_number := v_invoice_prefix || lpad(nextval('public.invoice_number_sequence')::text, 6, '0');

  insert into public.invoices (
    organization_id, invoice_number, source_sale_id, customer_id, customer_name_snapshot,
    subject, billing_month, due_date, subtotal_yen, tax_amount_yen, total_amount_yen,
    status, created_by
  ) values (
    v_organization_id, v_invoice_number, v_sale.id, v_sale.customer_id, v_sale.customer_name_snapshot,
    v_subject, v_billing_month, p_due_date, v_sale.subtotal_yen, v_sale.tax_amount_yen, v_sale.total_amount_yen,
    'draft', v_operator_id
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    organization_id, invoice_id, source_sale_item_id, item_name_snapshot, quantity,
    unit_price_yen, discount_yen, tax_rate_basis_points,
    line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
  )
  select
    v_organization_id, v_invoice_id, item.id, item.product_name_snapshot, item.quantity,
    item.unit_price_yen, item.discount_yen, item.tax_rate_basis_points,
    item.line_subtotal_yen, item.tax_amount_yen, item.line_total_yen, item.sort_order
  from public.sale_items item
  where item.organization_id = v_organization_id and item.sale_id = v_sale.id
  order by item.sort_order;
  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then
    raise exception '売上明細が見つからないため請求データを作成できません。';
  end if;

  v_response := jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'draft',
    'source_sale_id', v_sale.id,
    'already_exists', false
  );
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.created_from_sale', 'invoice', v_invoice_id, v_response);
  return v_response;
end;
$$;

-- 売上履歴からの任意作成用。関数内で管理者権限を確認する。
create or replace function public.invoice_from_sale(
  p_sale_id uuid,
  p_subject text default null,
  p_billing_month date default null,
  p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_invoice_from_sale_internal(p_sale_id, p_subject, p_billing_month, p_due_date, true);
end;
$$;

-- 会計と請求を同じRPCトランザクションで実行する。
-- 掛売は p_create_invoice の値によらず必ず請求化し、その他の支払方法は管理者が任意指定できる。
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
  p_due_date date default null
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
  v_payment_code text;
  v_sale_response jsonb;
  v_invoice_response jsonb;
  v_should_create_invoice boolean := false;
begin
  if v_operator_id is null then
    raise exception 'ログインが必要です。';
  end if;
  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then
    raise exception '有効な利用者情報がありません。';
  end if;

  select method.code into v_payment_code
  from public.payment_methods method
  where method.id = p_payment_method_id
    and method.organization_id = v_organization_id
    and method.active = true;

  if v_payment_code = 'accounts_receivable' then
    v_should_create_invoice := true;
  elsif coalesce(p_create_invoice, false) then
    if v_role <> 'admin' then
      raise exception '任意の請求データ作成は管理者のみ実行できます。';
    end if;
    v_should_create_invoice := true;
  end if;

  v_sale_response := public.checkout_sale(
    p_idempotency_key, p_customer_id, p_vehicle_id, p_sale_date,
    p_payment_method_id, p_amount_received_yen, p_lines
  );

  if v_should_create_invoice then
    v_invoice_response := public.create_invoice_from_sale_internal(
      (v_sale_response ->> 'sale_id')::uuid,
      p_invoice_subject, p_billing_month, p_due_date,
      false
    );
  end if;

  return v_sale_response || jsonb_build_object('invoice', v_invoice_response);
end;
$$;

-- 請求済み売上の取消は、請求を先に取消す運用とする。売上と請求の不整合を防止する。
create or replace function public.cancel_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_operator_id uuid := auth.uid();
  v_role public.app_role;
  v_sale_number text;
  v_status public.sale_status;
  v_response jsonb;
begin
  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then
    raise exception '売上取消は管理者のみ実行できます。';
  end if;

  select sale.sale_number, sale.status into v_sale_number, v_status
  from public.sales sale
  where sale.id = p_sale_id
    and sale.organization_id = v_organization_id
    and sale.deleted_at is null
  for update;
  if v_sale_number is null then
    raise exception '売上が見つかりません。';
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('sale_id', p_sale_id, 'sale_number', v_sale_number, 'status', 'cancelled', 'already_cancelled', true);
  end if;
  if v_status <> 'confirmed' then
    raise exception 'この売上は取消できません。';
  end if;
  if exists (
    select 1 from public.invoices invoice
    where invoice.organization_id = v_organization_id
      and invoice.source_sale_id = p_sale_id
      and invoice.deleted_at is null
      and invoice.status <> 'cancelled'
  ) then
    raise exception '有効な請求データに紐付いているため、先に請求を取消してください。';
  end if;

  update public.sales
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_operator_id,
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_sale_id;

  v_response := jsonb_build_object('sale_id', p_sale_id, 'sale_number', v_sale_number, 'status', 'cancelled');
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json, metadata)
  values (v_organization_id, v_operator_id, 'sale.cancelled', 'sale', p_sale_id, v_response, jsonb_build_object('reason', p_reason));
  return v_response;
end;
$$;

-- 旧RPCをクライアントから直接呼べないようにし、請求連携を含む新RPCへ統一する。
revoke all on function public.checkout_sale(uuid, uuid, uuid, date, uuid, bigint, jsonb) from public;
revoke all on function public.checkout_sale(uuid, uuid, uuid, date, uuid, bigint, jsonb) from authenticated;
revoke all on function public.create_invoice_from_sale_internal(uuid, text, date, date, boolean) from public;
revoke all on function public.invoice_from_sale(uuid, text, date, date) from public;
revoke all on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date) from public;
grant execute on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date) to authenticated;
grant execute on function public.invoice_from_sale(uuid, text, date, date) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;

create index invoices_source_sale_active_idx on public.invoices (organization_id, source_sale_id)
  where deleted_at is null and status <> 'cancelled';

commit;
