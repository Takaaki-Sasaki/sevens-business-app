-- Phase 7: 売上確定・支払・取消
-- 0001_foundation.sql の適用後に実行する。

begin;

create sequence public.sale_number_sequence start with 1 increment by 1;

create or replace function public.round_yen(p_value numeric, p_mode text)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value < 0 then
    raise exception '金額は0以上である必要があります。';
  end if;
  case p_mode
    when 'floor' then return floor(p_value)::bigint;
    when 'ceil' then return ceil(p_value)::bigint;
    when 'round' then return round(p_value)::bigint;
    else raise exception '不正な税の端数処理です。';
  end case;
end;
$$;

create or replace function public.checkout_sale(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_payment_method_id uuid,
  p_amount_received_yen bigint,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_operator_id uuid := auth.uid();
  v_role public.app_role;
  v_request_id uuid;
  v_existing_hash text;
  v_response jsonb;
  v_request_hash text;
  v_rounding_mode text;
  v_sale_prefix text;
  v_sale_id uuid;
  v_sale_number text;
  v_customer_name text;
  v_vehicle_customer_id uuid;
  v_payment_method_code text;
  v_payment_method_name text;
  v_amount_received_yen bigint;
  v_change_amount_yen bigint := 0;
  v_subtotal_yen bigint := 0;
  v_discount_yen bigint := 0;
  v_tax_amount_yen bigint := 0;
  v_total_amount_yen bigint := 0;
  v_computed_lines jsonb := '[]'::jsonb;
  v_seen_product_ids uuid[] := '{}'::uuid[];
  v_input record;
  v_product_code text;
  v_product_name text;
  v_product_price_yen bigint;
  v_product_category_id uuid;
  v_product_tax_rate_id uuid;
  v_tax_rate_name text;
  v_tax_rate_basis_points integer;
  v_category_count integer;
  v_category_path_active boolean;
  v_category_root_reached boolean;
  v_base_amount_yen bigint;
  v_discount_line_yen bigint;
  v_taxable_amount_yen bigint;
  v_tax_line_yen bigint;
  v_total_line_yen bigint;
  v_sort_order integer := 0;
begin
  if v_operator_id is null then
    raise exception 'ログインが必要です。';
  end if;
  if p_idempotency_key is null then
    raise exception '会計処理キーがありません。';
  end if;
  if p_payment_method_id is null then
    raise exception '支払方法を選択してください。';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '会計明細を1件以上指定してください。';
  end if;

  select profile.organization_id, profile.role
    into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then
    raise exception '有効な利用者情報がありません。';
  end if;

  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'vehicle_id', p_vehicle_id,
    'sale_date', coalesce(p_sale_date, current_date),
    'payment_method_id', p_payment_method_id,
    'amount_received_yen', p_amount_received_yen,
    'lines', p_lines
  )::text);

  insert into public.idempotency_requests (organization_id, operation, idempotency_key, request_hash)
  values (v_organization_id, 'checkout_sale', p_idempotency_key, v_request_hash)
  on conflict (organization_id, operation, idempotency_key) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select request_hash, response_json
      into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id
      and operation = 'checkout_sale'
      and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then
      raise exception '同じ会計処理キーに異なる内容が送信されました。画面を更新してやり直してください。';
    end if;
    if v_response is null then
      raise exception '同じ会計処理を実行中です。しばらくしてから再試行してください。';
    end if;
    return v_response;
  end if;

  select settings.tax_rounding_mode, settings.sale_number_prefix
    into v_rounding_mode, v_sale_prefix
  from public.organization_settings settings
  where settings.organization_id = v_organization_id;
  if v_rounding_mode is null or v_sale_prefix is null then
    raise exception '組織設定が未登録です。発行元設定を確認してください。';
  end if;

  select method.code, method.name
    into v_payment_method_code, v_payment_method_name
  from public.payment_methods method
  where method.id = p_payment_method_id
    and method.organization_id = v_organization_id
    and method.active = true;
  if v_payment_method_code is null then
    raise exception '有効な支払方法を選択してください。';
  end if;

  if p_customer_id is not null then
    select customer.name into v_customer_name
    from public.customers customer
    where customer.id = p_customer_id
      and customer.organization_id = v_organization_id
      and customer.deleted_at is null;
    if v_customer_name is null then
      raise exception '選択した顧客が見つかりません。';
    end if;
  end if;

  if p_vehicle_id is not null then
    select vehicle.customer_id into v_vehicle_customer_id
    from public.vehicles vehicle
    where vehicle.id = p_vehicle_id
      and vehicle.organization_id = v_organization_id
      and vehicle.deleted_at is null;
    if v_vehicle_customer_id is null then
      raise exception '選択した車両が見つかりません。';
    end if;
    if p_customer_id is null or v_vehicle_customer_id <> p_customer_id then
      raise exception '車両は選択した顧客に紐付いている必要があります。';
    end if;
  end if;

  for v_input in
    select * from jsonb_to_recordset(p_lines) as input(
      product_id uuid,
      quantity_milli integer,
      unit_price_yen bigint,
      discount_yen bigint
    )
  loop
    if v_input.product_id is null
      or v_input.quantity_milli is null
      or v_input.unit_price_yen is null
      or v_input.discount_yen is null then
      raise exception '会計明細の形式が不正です。';
    end if;
    if v_input.product_id = any(v_seen_product_ids) then
      raise exception '同一商品を複数の明細として送信できません。';
    end if;
    v_seen_product_ids := array_append(v_seen_product_ids, v_input.product_id);
    if v_input.quantity_milli < 1 or v_input.quantity_milli > 9999999 then
      raise exception '数量は0.001〜9,999.999の範囲で指定してください。';
    end if;
    if v_input.unit_price_yen < 0 or v_input.unit_price_yen > 99999999
      or v_input.discount_yen < 0 or v_input.discount_yen > 99999999 then
      raise exception '単価・割引は0〜99,999,999円で指定してください。';
    end if;

    select product.product_code, product.name, product.price_yen, product.category_id,
      product.tax_rate_id, tax.name, tax.rate_basis_points
      into v_product_code, v_product_name, v_product_price_yen, v_product_category_id,
        v_product_tax_rate_id, v_tax_rate_name, v_tax_rate_basis_points
    from public.products product
    join public.tax_rates tax on tax.id = product.tax_rate_id
      and tax.organization_id = product.organization_id
    where product.id = v_input.product_id
      and product.organization_id = v_organization_id
      and product.active = true
      and product.deleted_at is null
      and tax.active = true
      and tax.effective_from <= coalesce(p_sale_date, current_date)
      and (tax.effective_to is null or tax.effective_to >= coalesce(p_sale_date, current_date));
    if v_product_code is null then
      raise exception '有効な商品または税率が見つかりません。';
    end if;
    if v_role <> 'admin' and v_input.unit_price_yen <> v_product_price_yen then
      raise exception '単価変更は管理者のみ実行できます。';
    end if;

    with recursive category_path as (
      select category.id, category.parent_id, category.organization_id, category.active, category.deleted_at
      from public.product_categories category
      where category.id = v_product_category_id
      union all
      select parent.id, parent.parent_id, parent.organization_id, parent.active, parent.deleted_at
      from public.product_categories parent
      join category_path path on parent.id = path.parent_id
    )
    select count(*),
      coalesce(bool_and(organization_id = v_organization_id and active and deleted_at is null), false),
      coalesce(bool_or(parent_id is null), false)
      into v_category_count, v_category_path_active, v_category_root_reached
    from category_path;
    if v_category_count = 0 or not v_category_path_active or not v_category_root_reached then
      raise exception '商品カテゴリが停止中または不正です。商品マスタを確認してください。';
    end if;

    v_base_amount_yen := public.round_yen(v_input.unit_price_yen::numeric * v_input.quantity_milli::numeric / 1000, v_rounding_mode);
    v_discount_line_yen := least(v_input.discount_yen, v_base_amount_yen);
    v_taxable_amount_yen := v_base_amount_yen - v_discount_line_yen;
    v_tax_line_yen := public.round_yen(v_taxable_amount_yen::numeric * v_tax_rate_basis_points::numeric / 10000, v_rounding_mode);
    v_total_line_yen := v_taxable_amount_yen + v_tax_line_yen;
    v_sort_order := v_sort_order + 10;

    v_subtotal_yen := v_subtotal_yen + v_base_amount_yen;
    v_discount_yen := v_discount_yen + v_discount_line_yen;
    v_tax_amount_yen := v_tax_amount_yen + v_tax_line_yen;
    v_total_amount_yen := v_total_amount_yen + v_total_line_yen;
    v_computed_lines := v_computed_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_input.product_id,
      'product_code', v_product_code,
      'product_name', v_product_name,
      'quantity_milli', v_input.quantity_milli,
      'unit_price_yen', v_input.unit_price_yen,
      'discount_yen', v_discount_line_yen,
      'tax_rate_basis_points', v_tax_rate_basis_points,
      'line_subtotal_yen', v_base_amount_yen,
      'tax_amount_yen', v_tax_line_yen,
      'line_total_yen', v_total_line_yen,
      'sort_order', v_sort_order
    ));
  end loop;

  if v_total_amount_yen <= 0 then
    raise exception '会計金額は1円以上である必要があります。';
  end if;

  if v_payment_method_code = 'cash' then
    if p_amount_received_yen is null or p_amount_received_yen < v_total_amount_yen then
      raise exception '預かり金が会計金額に不足しています。';
    end if;
    v_amount_received_yen := p_amount_received_yen;
    v_change_amount_yen := p_amount_received_yen - v_total_amount_yen;
  else
    v_amount_received_yen := null;
    v_change_amount_yen := 0;
  end if;

  v_sale_number := v_sale_prefix || lpad(nextval('public.sale_number_sequence')::text, 6, '0');
  insert into public.sales (
    organization_id, sale_number, customer_id, customer_name_snapshot, vehicle_id, sale_date,
    primary_payment_method_id, amount_received_yen, change_amount_yen, status, operator_id, confirmed_at
  ) values (
    v_organization_id, v_sale_number, p_customer_id, v_customer_name, p_vehicle_id, coalesce(p_sale_date, current_date),
    p_payment_method_id, v_amount_received_yen, v_change_amount_yen, 'confirmed', v_operator_id, now()
  ) returning id into v_sale_id;

  for v_input in
    select * from jsonb_to_recordset(v_computed_lines) as line(
      product_id uuid,
      product_code text,
      product_name text,
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
    insert into public.sale_items (
      organization_id, sale_id, product_id, product_code_snapshot, product_name_snapshot,
      quantity, unit_price_yen, discount_yen, tax_rate_basis_points,
      line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order
    ) values (
      v_organization_id, v_sale_id, v_input.product_id, v_input.product_code, v_input.product_name,
      v_input.quantity_milli::numeric / 1000, v_input.unit_price_yen, v_input.discount_yen, v_input.tax_rate_basis_points,
      v_input.line_subtotal_yen, v_input.tax_amount_yen, v_input.line_total_yen, v_input.sort_order
    );
  end loop;

  insert into public.payments (
    organization_id, sale_id, payment_method_id, payment_method_name_snapshot,
    amount_yen, amount_received_yen, change_amount_yen
  ) values (
    v_organization_id, v_sale_id, p_payment_method_id, v_payment_method_name,
    v_total_amount_yen, v_amount_received_yen, v_change_amount_yen
  );

  update public.sales
  set subtotal_yen = v_subtotal_yen,
      tax_amount_yen = v_tax_amount_yen,
      total_amount_yen = v_total_amount_yen,
      amount_received_yen = v_amount_received_yen,
      change_amount_yen = v_change_amount_yen
  where id = v_sale_id;

  v_response := jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'subtotal_yen', v_subtotal_yen,
    'discount_yen', v_discount_yen,
    'tax_amount_yen', v_tax_amount_yen,
    'total_amount_yen', v_total_amount_yen,
    'change_amount_yen', v_change_amount_yen,
    'status', 'confirmed'
  );
  update public.idempotency_requests
  set response_json = v_response, completed_at = now()
  where id = v_request_id;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'sale.confirmed', 'sale', v_sale_id, v_response);

  return v_response;
end;
$$;

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

revoke all on function public.checkout_sale(uuid, uuid, uuid, date, uuid, bigint, jsonb) from public;
revoke all on function public.cancel_sale(uuid, text) from public;
grant execute on function public.checkout_sale(uuid, uuid, uuid, date, uuid, bigint, jsonb) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;

create index sales_number_search_idx on public.sales (organization_id, sale_number);
create index sales_customer_history_idx on public.sales (organization_id, customer_id, sale_date desc)
  where deleted_at is null;

commit;
