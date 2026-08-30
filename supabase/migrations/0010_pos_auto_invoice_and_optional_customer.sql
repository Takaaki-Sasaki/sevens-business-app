-- レジ会計時の請求自動作成と、顧客未設定請求への対応
-- 0001〜0009 を適用済みの Supabase SQL Editor で実行する。

begin;

-- 顧客未設定の請求を許可する。既存行の値は変更しない。
alter table public.invoices
  alter column customer_id drop not null,
  alter column customer_name_snapshot drop not null,
  add column if not exists payment_method_id uuid references public.payment_methods(id),
  add column if not exists payment_method_name_snapshot text;

create index if not exists invoices_payment_method_idx
  on public.invoices (organization_id, payment_method_id, created_at desc)
  where payment_method_id is not null and deleted_at is null;

-- 確定済み売上を請求へ変換する共通処理。
-- 顧客未設定を許可し、会計時の支払方法も請求へスナップショット保存する。
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
  where sale.id = p_sale_id
    and sale.organization_id = v_organization_id
    and sale.deleted_at is null
  for update;
  if v_sale.id is null then raise exception '対象の売上が見つかりません。'; end if;
  if v_sale.status <> 'confirmed' then raise exception '確定済みの売上のみ請求データを作成できます。'; end if;

  -- 売上行をロックした状態で既存請求を確認する。同時実行も同じ1件へ収束する。
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
      'source_sale_id', v_sale.id,
      'already_exists', true
    );
  end if;

  select settings.invoice_number_prefix into v_invoice_prefix
  from public.organization_settings settings
  where settings.organization_id = v_organization_id;
  if v_invoice_prefix is null then raise exception '請求番号のプレフィックスが未設定です。発行元設定を確認してください。'; end if;

  select payment.payment_method_name_snapshot into v_payment_method_name
  from public.payments payment
  where payment.organization_id = v_organization_id and payment.sale_id = v_sale.id
  order by payment.created_at
  limit 1;

  v_subject := coalesce(nullif(btrim(p_subject), ''), '売上 ' || v_sale.sale_number || ' 分');
  v_billing_month := coalesce(p_billing_month, date_trunc('month', v_sale.sale_date)::date);
  if p_due_date is not null and p_due_date < v_billing_month then raise exception '支払期限は請求月以降の日付を指定してください。'; end if;
  v_invoice_number := v_invoice_prefix || lpad(nextval('public.invoice_number_sequence')::text, 6, '0');

  insert into public.invoices (
    organization_id, invoice_number, source_sale_id, customer_id, customer_name_snapshot,
    payment_method_id, payment_method_name_snapshot,
    subject, billing_month, due_date, subtotal_yen, tax_amount_yen, total_amount_yen,
    status, created_by
  ) values (
    v_organization_id, v_invoice_number, v_sale.id, v_sale.customer_id, v_sale.customer_name_snapshot,
    v_sale.primary_payment_method_id, v_payment_method_name,
    v_subject, v_billing_month, p_due_date, v_sale.subtotal_yen, v_sale.tax_amount_yen, v_sale.total_amount_yen,
    'draft', v_operator_id
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

-- すべてのレジ会計で、売上・明細・支払・請求を同じDBトランザクション内に作成する。
-- p_create_invoice は既存クライアントとの互換性のため残すが、値にかかわらず請求を作成する。
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
  v_sale_response jsonb;
  v_invoice_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;

  v_sale_response := public.checkout_sale(
    p_idempotency_key, p_customer_id, p_vehicle_id, p_sale_date,
    p_payment_method_id, p_amount_received_yen, p_lines
  );
  v_invoice_response := public.create_invoice_from_sale_internal(
    (v_sale_response ->> 'sale_id')::uuid,
    p_invoice_subject, p_billing_month, p_due_date,
    false
  );
  return v_sale_response || jsonb_build_object('invoice', v_invoice_response);
end;
$$;

-- 顧客を指定しない手動請求も作成できる。金額・税額はDBで再計算する。
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
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception '請求明細を1件以上指定してください。'; end if;

  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then raise exception '請求データの作成は管理者のみ実行できます。'; end if;

  v_billing_month := p_billing_month;
  v_tax_reference_date := coalesce(v_billing_month, current_date);
  if p_due_date is not null and v_billing_month is not null and p_due_date < v_billing_month then raise exception '支払期限は請求月以降の日付を指定してください。'; end if;

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

  if p_customer_id is not null then
    select customer.name into v_customer_name
    from public.customers customer
    where customer.id = p_customer_id and customer.organization_id = v_organization_id and customer.deleted_at is null;
    if v_customer_name is null then raise exception '選択した顧客が見つかりません。'; end if;
  end if;

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

-- 売上由来ではない下書き請求を、顧客未設定の状態にも更新できる。
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
  v_validated_lines jsonb := '[]'::jsonb;
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
  if p_invoice_id is null then raise exception '更新する請求を指定してください。'; end if;
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

  if p_customer_id is not null then
    select customer.name into v_customer_name
    from public.customers customer
    where customer.id = p_customer_id and customer.organization_id = v_organization_id and customer.deleted_at is null;
    if v_customer_name is null then raise exception '選択した顧客が見つかりません。'; end if;
  end if;

  select settings.tax_rounding_mode into v_rounding_mode
  from public.organization_settings settings where settings.organization_id = v_organization_id;
  if v_rounding_mode is null then raise exception '税の端数処理設定がありません。'; end if;

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
    v_validated_lines := v_validated_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_input.product_id,
      'tax_rate_id', v_input.tax_rate_id,
      'item_name', v_item_name,
      'quantity_milli', v_input.quantity_milli,
      'unit_price_yen', v_input.unit_price_yen,
      'discount_yen', v_discount_line_yen,
      'tax_rate_basis_points', v_tax_rate_basis_points,
      'line_subtotal_yen', v_base_amount_yen,
      'tax_amount_yen', v_tax_line_yen,
      'line_total_yen', v_total_line_yen,
      'sort_order', v_sort_order
    ));
    v_subtotal_yen := v_subtotal_yen + v_base_amount_yen;
    v_tax_amount_yen := v_tax_amount_yen + v_tax_line_yen;
    v_total_amount_yen := v_total_amount_yen + v_total_line_yen;
  end loop;
  if v_line_count = 0 or v_total_amount_yen <= 0 then raise exception '請求金額は1円以上である必要があります。'; end if;

  delete from public.invoice_items where organization_id = v_organization_id and invoice_id = p_invoice_id;
  for v_input in
    select * from jsonb_to_recordset(v_validated_lines) as line(
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

revoke all on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date) from public;
revoke all on function public.create_invoice_from_sale_internal(uuid, text, date, date, boolean) from public;
revoke all on function public.create_invoice_from_sale_internal(uuid, text, date, date, boolean) from authenticated;
revoke all on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) from public;
revoke all on function public.update_manual_invoice(uuid, uuid, uuid, text, date, date, jsonb) from public;
grant execute on function public.checkout_sale_with_invoice(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date) to authenticated;
grant execute on function public.create_manual_invoice(uuid, uuid, text, date, date, jsonb) to authenticated;
grant execute on function public.update_manual_invoice(uuid, uuid, uuid, text, date, date, jsonb) to authenticated;

commit;
