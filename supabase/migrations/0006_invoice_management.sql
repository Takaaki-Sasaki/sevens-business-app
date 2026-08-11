-- Phase 9: 請求登録・請求状態管理
-- 0001〜0005 を適用済みのSupabase SQL Editorで実行する。

begin;

alter table public.invoices
  add column if not exists issued_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancellation_reason text;

-- 売上に紐付かない手動請求を作成する。金額・税額はサーバーで再計算する。
create or replace function public.create_manual_invoice(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_subject text default null,
  p_billing_month date default null,
  p_due_date date default null,
  p_lines jsonb default '[]'::jsonb
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
  v_request_id uuid;
  v_existing_hash text;
  v_response jsonb;
  v_request_hash text;
  v_customer_name text;
  v_invoice_prefix text;
  v_rounding_mode text;
  v_billing_month date;
  v_invoice_id uuid;
  v_invoice_number text;
  v_input record;
  v_item_name text;
  v_tax_rate_basis_points integer;
  v_base_amount_yen bigint;
  v_discount_line_yen bigint;
  v_taxable_amount_yen bigint;
  v_tax_line_yen bigint;
  v_total_line_yen bigint;
  v_subtotal_yen bigint := 0;
  v_tax_amount_yen bigint := 0;
  v_total_amount_yen bigint := 0;
  v_sort_order integer := 0;
  v_line_count integer := 0;
begin
  if v_operator_id is null then
    raise exception 'ログインが必要です。';
  end if;
  if p_idempotency_key is null then
    raise exception '請求作成キーがありません。';
  end if;
  if p_customer_id is null then
    raise exception '請求データの作成には顧客の選択が必要です。';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '請求明細を1件以上指定してください。';
  end if;

  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then
    raise exception '請求データの作成は管理者のみ実行できます。';
  end if;

  v_billing_month := coalesce(p_billing_month, date_trunc('month', current_date)::date);
  if p_due_date is not null and p_due_date < v_billing_month then
    raise exception '支払期限は請求月以降の日付を指定してください。';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'subject', nullif(btrim(p_subject), ''),
    'billing_month', v_billing_month,
    'due_date', p_due_date,
    'lines', p_lines
  )::text);
  insert into public.idempotency_requests (organization_id, operation, idempotency_key, request_hash)
  values (v_organization_id, 'create_manual_invoice', p_idempotency_key, v_request_hash)
  on conflict (organization_id, operation, idempotency_key) do nothing
  returning id into v_request_id;
  if v_request_id is null then
    select request_hash, response_json
      into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id
      and operation = 'create_manual_invoice'
      and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then
      raise exception '同じ請求作成キーに異なる内容が送信されました。画面を更新してやり直してください。';
    end if;
    if v_response is null then
      raise exception '同じ請求作成を実行中です。しばらくしてから再試行してください。';
    end if;
    return v_response;
  end if;

  select customer.name into v_customer_name
  from public.customers customer
  where customer.id = p_customer_id
    and customer.organization_id = v_organization_id
    and customer.deleted_at is null;
  if v_customer_name is null then
    raise exception '選択した顧客が見つかりません。';
  end if;

  select settings.invoice_number_prefix, settings.tax_rounding_mode
    into v_invoice_prefix, v_rounding_mode
  from public.organization_settings settings
  where settings.organization_id = v_organization_id;
  if v_invoice_prefix is null or v_rounding_mode is null then
    raise exception '発行元設定または税の端数処理設定がありません。';
  end if;

  v_invoice_number := v_invoice_prefix || lpad(nextval('public.invoice_number_sequence')::text, 6, '0');
  insert into public.invoices (
    organization_id, invoice_number, customer_id, customer_name_snapshot,
    subject, billing_month, due_date, status, created_by
  ) values (
    v_organization_id, v_invoice_number, p_customer_id, v_customer_name,
    coalesce(nullif(btrim(p_subject), ''), '請求書'), v_billing_month, p_due_date, 'draft', v_operator_id
  ) returning id into v_invoice_id;

  for v_input in
    select * from jsonb_to_recordset(p_lines) as line(
      item_name text,
      quantity_milli integer,
      unit_price_yen bigint,
      discount_yen bigint,
      tax_rate_id uuid
    )
  loop
    v_item_name := nullif(btrim(v_input.item_name), '');
    if v_item_name is null or char_length(v_item_name) > 250
      or v_input.quantity_milli is null or v_input.unit_price_yen is null
      or v_input.discount_yen is null or v_input.tax_rate_id is null then
      raise exception '請求明細の形式が不正です。';
    end if;
    if v_input.quantity_milli < 1 or v_input.quantity_milli > 9999999 then
      raise exception '数量は0.001〜9,999.999の範囲で指定してください。';
    end if;
    if v_input.unit_price_yen < 0 or v_input.unit_price_yen > 99999999
      or v_input.discount_yen < 0 or v_input.discount_yen > 99999999 then
      raise exception '単価・割引は0〜99,999,999円で指定してください。';
    end if;

    select tax.rate_basis_points into v_tax_rate_basis_points
    from public.tax_rates tax
    where tax.id = v_input.tax_rate_id
      and tax.organization_id = v_organization_id
      and tax.active = true
      and tax.effective_from <= v_billing_month
      and (tax.effective_to is null or tax.effective_to >= v_billing_month);
    if v_tax_rate_basis_points is null then
      raise exception '有効な消費税率が見つかりません。';
    end if;

    v_base_amount_yen := public.round_yen(v_input.unit_price_yen::numeric * v_input.quantity_milli::numeric / 1000, v_rounding_mode);
    v_discount_line_yen := least(v_input.discount_yen, v_base_amount_yen);
    v_taxable_amount_yen := v_base_amount_yen - v_discount_line_yen;
    v_tax_line_yen := public.round_yen(v_taxable_amount_yen::numeric * v_tax_rate_basis_points::numeric / 10000, v_rounding_mode);
    v_total_line_yen := v_taxable_amount_yen + v_tax_line_yen;
    v_sort_order := v_sort_order + 10;
    v_line_count := v_line_count + 1;

    insert into public.invoice_items (
      organization_id, invoice_id, item_name_snapshot, quantity, unit_price_yen, discount_yen,
      tax_rate_basis_points, line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
    ) values (
      v_organization_id, v_invoice_id, v_item_name, v_input.quantity_milli::numeric / 1000,
      v_input.unit_price_yen, v_discount_line_yen, v_tax_rate_basis_points,
      v_base_amount_yen, v_tax_line_yen, v_total_line_yen, v_sort_order
    );
    v_subtotal_yen := v_subtotal_yen + v_base_amount_yen;
    v_tax_amount_yen := v_tax_amount_yen + v_tax_line_yen;
    v_total_amount_yen := v_total_amount_yen + v_total_line_yen;
  end loop;
  if v_line_count = 0 or v_total_amount_yen <= 0 then
    raise exception '請求金額は1円以上である必要があります。';
  end if;

  update public.invoices
  set subtotal_yen = v_subtotal_yen,
      tax_amount_yen = v_tax_amount_yen,
      total_amount_yen = v_total_amount_yen
  where id = v_invoice_id;

  v_response := jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'draft',
    'already_exists', false
  );
  update public.idempotency_requests
  set response_json = v_response, completed_at = now()
  where id = v_request_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.created_manual', 'invoice', v_invoice_id, v_response);
  return v_response;
end;
$$;

create or replace function public.issue_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_role public.app_role;
  v_invoice_number text;
  v_status public.invoice_status;
  v_response jsonb;
begin
  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '請求発行は管理者のみ実行できます。'; end if;
  select invoice.invoice_number, invoice.status into v_invoice_number, v_status
  from public.invoices invoice where invoice.id = p_invoice_id and invoice.organization_id = v_organization_id and invoice.deleted_at is null
  for update;
  if v_invoice_number is null then raise exception '請求データが見つかりません。'; end if;
  if v_status = 'issued' then return jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'issued', 'already_issued', true); end if;
  if v_status <> 'draft' then raise exception '下書きの請求データのみ発行できます。'; end if;
  update public.invoices set status = 'issued', issued_at = now(), issued_by = v_operator_id where id = p_invoice_id;
  v_response := jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'issued');
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.issued', 'invoice', p_invoice_id, v_response);
  return v_response;
end;
$$;

create or replace function public.mark_invoice_paid(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_role public.app_role;
  v_invoice_number text;
  v_status public.invoice_status;
  v_response jsonb;
begin
  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '入金登録は管理者のみ実行できます。'; end if;
  select invoice.invoice_number, invoice.status into v_invoice_number, v_status
  from public.invoices invoice where invoice.id = p_invoice_id and invoice.organization_id = v_organization_id and invoice.deleted_at is null
  for update;
  if v_invoice_number is null then raise exception '請求データが見つかりません。'; end if;
  if v_status = 'paid' then return jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'paid', 'already_paid', true); end if;
  if v_status not in ('issued', 'overdue') then raise exception '発行済みの請求データのみ入金済みにできます。'; end if;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice_id;
  v_response := jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'paid');
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.paid', 'invoice', p_invoice_id, v_response);
  return v_response;
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_role public.app_role;
  v_invoice_number text;
  v_status public.invoice_status;
  v_response jsonb;
begin
  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '請求取消は管理者のみ実行できます。'; end if;
  select invoice.invoice_number, invoice.status into v_invoice_number, v_status
  from public.invoices invoice where invoice.id = p_invoice_id and invoice.organization_id = v_organization_id and invoice.deleted_at is null
  for update;
  if v_invoice_number is null then raise exception '請求データが見つかりません。'; end if;
  if v_status = 'cancelled' then return jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'cancelled', 'already_cancelled', true); end if;
  if v_status = 'paid' then raise exception '入金済みの請求データは取消できません。'; end if;
  update public.invoices
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_operator_id,
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_invoice_id;
  v_response := jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'cancelled');
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json, metadata)
  values (v_organization_id, v_operator_id, 'invoice.cancelled', 'invoice', p_invoice_id, v_response, jsonb_build_object('reason', p_reason));
  return v_response;
end;
$$;

revoke all on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) from public;
revoke all on function public.issue_invoice(uuid) from public;
revoke all on function public.mark_invoice_paid(uuid) from public;
revoke all on function public.cancel_invoice(uuid, text) from public;
grant execute on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) to authenticated;
grant execute on function public.issue_invoice(uuid) to authenticated;
grant execute on function public.mark_invoice_paid(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;

create index invoices_customer_status_idx on public.invoices (organization_id, customer_id, status, billing_month desc)
  where deleted_at is null;

commit;
