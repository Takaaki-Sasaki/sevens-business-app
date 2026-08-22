-- 請求月の任意入力、手動請求の商品選択、下書き手動請求の編集
-- 0001〜0008 を適用済みの Supabase SQL Editor で実行する。

begin;

-- 商品選択と税率選択を明細に記録する。既存の売上由来・手動請求明細は NULL のまま保持する。
alter table public.invoice_items
  add column if not exists product_id uuid references public.products(id),
  add column if not exists tax_rate_id uuid references public.tax_rates(id);

create index if not exists invoice_items_product_idx
  on public.invoice_items (organization_id, product_id)
  where product_id is not null;

-- 手動請求を作成する。請求月未入力時は billing_month を NULL のまま保存する。
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
  v_tax_reference_date date;
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
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_idempotency_key is null then raise exception '請求作成キーがありません。'; end if;
  if p_customer_id is null then raise exception '請求データの作成には顧客の選択が必要です。'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception '請求明細を1件以上指定してください。'; end if;

  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '請求データの作成は管理者のみ実行できます。'; end if;

  v_billing_month := p_billing_month;
  v_tax_reference_date := coalesce(v_billing_month, current_date);
  if p_due_date is not null and v_billing_month is not null and p_due_date < v_billing_month then
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
    select request_hash, response_json into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id and operation = 'create_manual_invoice' and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then raise exception '同じ請求作成キーに異なる内容が送信されました。画面を更新してやり直してください。'; end if;
    if v_response is null then raise exception '同じ請求作成を実行中です。しばらくしてから再試行してください。'; end if;
    return v_response;
  end if;

  select customer.name into v_customer_name
  from public.customers customer
  where customer.id = p_customer_id and customer.organization_id = v_organization_id and customer.deleted_at is null;
  if v_customer_name is null then raise exception '選択した顧客が見つかりません。'; end if;

  select settings.invoice_number_prefix, settings.tax_rounding_mode into v_invoice_prefix, v_rounding_mode
  from public.organization_settings settings where settings.organization_id = v_organization_id;
  if v_invoice_prefix is null or v_rounding_mode is null then raise exception '発行元設定または税の端数処理設定がありません。'; end if;

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
      product_id uuid,
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
    if v_input.quantity_milli < 1 or v_input.quantity_milli > 9999999 then raise exception '数量は0.001〜9,999.999の範囲で指定してください。'; end if;
    if v_input.unit_price_yen < 0 or v_input.unit_price_yen > 99999999 or v_input.discount_yen < 0 or v_input.discount_yen > 99999999 then raise exception '単価・割引は0〜99,999,999円で指定してください。'; end if;
    if v_input.product_id is not null and not exists (
      select 1 from public.products product
      where product.id = v_input.product_id and product.organization_id = v_organization_id
    ) then raise exception '選択した商品が見つかりません。'; end if;

    v_tax_rate_basis_points := null;
    select tax.rate_basis_points into v_tax_rate_basis_points
    from public.tax_rates tax
    where tax.id = v_input.tax_rate_id and tax.organization_id = v_organization_id and tax.active = true
      and tax.effective_from <= v_tax_reference_date
      and (tax.effective_to is null or tax.effective_to >= v_tax_reference_date);
    if v_tax_rate_basis_points is null then raise exception '有効な消費税率が見つかりません。'; end if;

    v_base_amount_yen := public.round_yen(v_input.unit_price_yen::numeric * v_input.quantity_milli::numeric / 1000, v_rounding_mode);
    v_discount_line_yen := least(v_input.discount_yen, v_base_amount_yen);
    v_taxable_amount_yen := v_base_amount_yen - v_discount_line_yen;
    v_tax_line_yen := public.round_yen(v_taxable_amount_yen::numeric * v_tax_rate_basis_points::numeric / 10000, v_rounding_mode);
    v_total_line_yen := v_taxable_amount_yen + v_tax_line_yen;
    v_sort_order := v_sort_order + 10;
    v_line_count := v_line_count + 1;

    insert into public.invoice_items (
      organization_id, invoice_id, product_id, tax_rate_id, item_name_snapshot, quantity, unit_price_yen, discount_yen,
      tax_rate_basis_points, line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
    ) values (
      v_organization_id, v_invoice_id, v_input.product_id, v_input.tax_rate_id, v_item_name, v_input.quantity_milli::numeric / 1000,
      v_input.unit_price_yen, v_discount_line_yen, v_tax_rate_basis_points,
      v_base_amount_yen, v_tax_line_yen, v_total_line_yen, v_sort_order
    );
    v_subtotal_yen := v_subtotal_yen + v_base_amount_yen;
    v_tax_amount_yen := v_tax_amount_yen + v_tax_line_yen;
    v_total_amount_yen := v_total_amount_yen + v_total_line_yen;
  end loop;
  if v_line_count = 0 or v_total_amount_yen <= 0 then raise exception '請求金額は1円以上である必要があります。'; end if;

  update public.invoices
  set subtotal_yen = v_subtotal_yen, tax_amount_yen = v_tax_amount_yen, total_amount_yen = v_total_amount_yen
  where id = v_invoice_id;
  v_response := jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number, 'status', 'draft', 'already_exists', false);
  update public.idempotency_requests set response_json = v_response, completed_at = now() where id = v_request_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.created_manual', 'invoice', v_invoice_id, v_response);
  return v_response;
end;
$$;

-- 売上由来ではない下書き請求だけを編集する。発行済み・入金済み・売上由来の請求は変更しない。
create or replace function public.update_manual_invoice(
  p_idempotency_key uuid,
  p_invoice_id uuid,
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
  v_rounding_mode text;
  v_billing_month date;
  v_tax_reference_date date;
  v_invoice_number text;
  v_status public.invoice_status;
  v_source_sale_id uuid;
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
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_idempotency_key is null then raise exception '請求更新キーがありません。'; end if;
  if p_invoice_id is null or p_customer_id is null then raise exception '更新する請求と顧客を指定してください。'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception '請求明細を1件以上指定してください。'; end if;

  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '請求データの編集は管理者のみ実行できます。'; end if;

  v_billing_month := p_billing_month;
  v_tax_reference_date := coalesce(v_billing_month, current_date);
  if p_due_date is not null and v_billing_month is not null and p_due_date < v_billing_month then raise exception '支払期限は請求月以降の日付を指定してください。'; end if;

  v_request_hash := md5(jsonb_build_object(
    'invoice_id', p_invoice_id,
    'customer_id', p_customer_id,
    'subject', nullif(btrim(p_subject), ''),
    'billing_month', v_billing_month,
    'due_date', p_due_date,
    'lines', p_lines
  )::text);
  insert into public.idempotency_requests (organization_id, operation, idempotency_key, request_hash)
  values (v_organization_id, 'update_manual_invoice', p_idempotency_key, v_request_hash)
  on conflict (organization_id, operation, idempotency_key) do nothing
  returning id into v_request_id;
  if v_request_id is null then
    select request_hash, response_json into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id and operation = 'update_manual_invoice' and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then raise exception '同じ請求更新キーに異なる内容が送信されました。画面を更新してやり直してください。'; end if;
    if v_response is null then raise exception '同じ請求更新を実行中です。しばらくしてから再試行してください。'; end if;
    return v_response;
  end if;

  select invoice.invoice_number, invoice.status, invoice.source_sale_id
    into v_invoice_number, v_status, v_source_sale_id
  from public.invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = v_organization_id and invoice.deleted_at is null
  for update;
  if v_invoice_number is null then raise exception '更新する請求データが見つかりません。'; end if;
  if v_source_sale_id is not null or v_status <> 'draft' then raise exception '売上由来ではない下書き請求のみ編集できます。'; end if;

  select customer.name into v_customer_name
  from public.customers customer
  where customer.id = p_customer_id and customer.organization_id = v_organization_id and customer.deleted_at is null;
  if v_customer_name is null then raise exception '選択した顧客が見つかりません。'; end if;

  select settings.tax_rounding_mode into v_rounding_mode
  from public.organization_settings settings where settings.organization_id = v_organization_id;
  if v_rounding_mode is null then raise exception '税の端数処理設定がありません。'; end if;

  -- すべての明細を先に検証・再計算し、エラー時はトランザクション全体をロールバックする。
  for v_input in
    select * from jsonb_to_recordset(p_lines) as line(
      product_id uuid,
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
      or v_input.discount_yen is null or v_input.tax_rate_id is null then raise exception '請求明細の形式が不正です。'; end if;
    if v_input.quantity_milli < 1 or v_input.quantity_milli > 9999999 then raise exception '数量は0.001〜9,999.999の範囲で指定してください。'; end if;
    if v_input.unit_price_yen < 0 or v_input.unit_price_yen > 99999999 or v_input.discount_yen < 0 or v_input.discount_yen > 99999999 then raise exception '単価・割引は0〜99,999,999円で指定してください。'; end if;
    if v_input.product_id is not null and not exists (
      select 1 from public.products product
      where product.id = v_input.product_id and product.organization_id = v_organization_id
    ) then raise exception '選択した商品が見つかりません。'; end if;

    v_tax_rate_basis_points := null;
    select tax.rate_basis_points into v_tax_rate_basis_points
    from public.tax_rates tax
    where tax.id = v_input.tax_rate_id and tax.organization_id = v_organization_id and tax.active = true
      and tax.effective_from <= v_tax_reference_date
      and (tax.effective_to is null or tax.effective_to >= v_tax_reference_date);
    if v_tax_rate_basis_points is null then raise exception '有効な消費税率が見つかりません。'; end if;

    v_base_amount_yen := public.round_yen(v_input.unit_price_yen::numeric * v_input.quantity_milli::numeric / 1000, v_rounding_mode);
    v_discount_line_yen := least(v_input.discount_yen, v_base_amount_yen);
    v_taxable_amount_yen := v_base_amount_yen - v_discount_line_yen;
    v_tax_line_yen := public.round_yen(v_taxable_amount_yen::numeric * v_tax_rate_basis_points::numeric / 10000, v_rounding_mode);
    v_total_line_yen := v_taxable_amount_yen + v_tax_line_yen;
    v_sort_order := v_sort_order + 10;
    v_line_count := v_line_count + 1;

    -- 検証済みの行をJSON化し、既存明細の削除後に同じ順序で登録する。
    v_response := coalesce(v_response, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'product_id', v_input.product_id, 'tax_rate_id', v_input.tax_rate_id, 'item_name', v_item_name,
      'quantity_milli', v_input.quantity_milli, 'unit_price_yen', v_input.unit_price_yen,
      'discount_yen', v_discount_line_yen, 'tax_rate_basis_points', v_tax_rate_basis_points,
      'line_subtotal_yen', v_base_amount_yen, 'tax_amount_yen', v_tax_line_yen,
      'line_total_yen', v_total_line_yen, 'sort_order', v_sort_order
    ));
    v_subtotal_yen := v_subtotal_yen + v_base_amount_yen;
    v_tax_amount_yen := v_tax_amount_yen + v_tax_line_yen;
    v_total_amount_yen := v_total_amount_yen + v_total_line_yen;
  end loop;
  if v_line_count = 0 or v_total_amount_yen <= 0 then raise exception '請求金額は1円以上である必要があります。'; end if;

  delete from public.invoice_items where organization_id = v_organization_id and invoice_id = p_invoice_id;
  for v_input in
    select * from jsonb_to_recordset(v_response) as line(
      product_id uuid,
      tax_rate_id uuid,
      item_name text,
      quantity_milli integer,
      unit_price_yen bigint,
      discount_yen bigint,
      tax_rate_basis_points integer,
      line_subtotal_yen bigint,
      tax_amount_yen bigint,
      line_total_yen bigint,
      sort_order integer
    )
  loop
    insert into public.invoice_items (
      organization_id, invoice_id, product_id, tax_rate_id, item_name_snapshot, quantity, unit_price_yen, discount_yen,
      tax_rate_basis_points, line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
    ) values (
      v_organization_id, p_invoice_id, v_input.product_id, v_input.tax_rate_id, v_input.item_name, v_input.quantity_milli::numeric / 1000,
      v_input.unit_price_yen, v_input.discount_yen, v_input.tax_rate_basis_points,
      v_input.line_subtotal_yen, v_input.tax_amount_yen, v_input.line_total_yen, v_input.sort_order
    );
  end loop;

  update public.invoices
  set customer_id = p_customer_id,
      customer_name_snapshot = v_customer_name,
      subject = coalesce(nullif(btrim(p_subject), ''), '請求書'),
      billing_month = v_billing_month,
      due_date = p_due_date,
      subtotal_yen = v_subtotal_yen,
      tax_amount_yen = v_tax_amount_yen,
      total_amount_yen = v_total_amount_yen
  where id = p_invoice_id;

  v_response := jsonb_build_object('invoice_id', p_invoice_id, 'invoice_number', v_invoice_number, 'status', 'draft', 'updated', true);
  update public.idempotency_requests set response_json = v_response, completed_at = now() where id = v_request_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'invoice.updated_manual', 'invoice', p_invoice_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) from public;
revoke all on function public.update_manual_invoice(uuid, uuid, uuid, text, date, date, jsonb) from public;
grant execute on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) to authenticated;
grant execute on function public.update_manual_invoice(uuid, uuid, uuid, text, date, date, jsonb) to authenticated;

commit;
