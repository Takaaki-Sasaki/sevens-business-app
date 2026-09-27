-- Phase 20: レジ備考の保存、請求への引き継ぎ、帳票備考欄
-- 0001〜0012 を適用済みの Supabase SQL Editor で実行する。

begin;

-- PostgreSQL の text 型で長文を保持する。帳票に収める運用を考慮し、入力上限は5,000文字とする。
alter table public.sales
  add column if not exists notes text;

alter table public.invoices
  add column if not exists notes text;

alter table public.sales
  drop constraint if exists sales_notes_length_check,
  add constraint sales_notes_length_check check (notes is null or char_length(notes) <= 5000);

alter table public.invoices
  drop constraint if exists invoices_notes_length_check,
  add constraint invoices_notes_length_check check (notes is null or char_length(notes) <= 5000);

-- 会計後に売上から請求を作成した場合にも、売上の備考を請求へ引き継ぐ。
create or replace function public.inherit_sale_notes_to_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_sale_id is not null and new.notes is null then
    select sale.notes into new.notes
    from public.sales sale
    where sale.id = new.source_sale_id
      and sale.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_inherit_sale_notes on public.invoices;
create trigger invoices_inherit_sale_notes
before insert on public.invoices
for each row execute function public.inherit_sale_notes_to_invoice();

-- 既存の会計・割引・請求自動作成RPCを利用し、その同一トランザクション内で備考を保存する。
-- 外側にも冪等性キーを記録し、再送時に備考だけが別内容へ変わることを防ぐ。
create or replace function public.checkout_sale_with_notes(
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
  p_order_discount_rate_basis_points integer default null,
  p_notes text default null
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
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_response jsonb;
  v_sale_id uuid;
  v_invoice_id uuid;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_idempotency_key is null then raise exception '会計処理キーがありません。'; end if;
  if v_notes is not null and char_length(v_notes) > 5000 then
    raise exception '備考は5,000文字以内で入力してください。';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;

  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'vehicle_id', p_vehicle_id,
    'sale_date', coalesce(p_sale_date, current_date),
    'payment_method_id', p_payment_method_id,
    'amount_received_yen', p_amount_received_yen,
    'lines', p_lines,
    'create_invoice', p_create_invoice,
    'invoice_subject', nullif(btrim(p_invoice_subject), ''),
    'billing_month', p_billing_month,
    'due_date', p_due_date,
    'order_discount_amount_yen', p_order_discount_amount_yen,
    'order_discount_rate_basis_points', p_order_discount_rate_basis_points,
    'notes', v_notes
  )::text);

  insert into public.idempotency_requests (organization_id, operation, idempotency_key, request_hash)
  values (v_organization_id, 'checkout_sale_with_notes', p_idempotency_key, v_request_hash)
  on conflict (organization_id, operation, idempotency_key) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select request_hash, response_json into v_existing_hash, v_response
    from public.idempotency_requests
    where organization_id = v_organization_id
      and operation = 'checkout_sale_with_notes'
      and idempotency_key = p_idempotency_key;
    if v_existing_hash is distinct from v_request_hash then
      raise exception '同じ会計処理キーに異なる内容が送信されました。画面を更新してやり直してください。';
    end if;
    if v_response is null then
      raise exception '同じ会計処理を実行中です。しばらくしてから再試行してください。';
    end if;
    return v_response;
  end if;

  v_response := public.checkout_sale_with_invoice(
    p_idempotency_key,
    p_customer_id,
    p_vehicle_id,
    p_sale_date,
    p_payment_method_id,
    p_amount_received_yen,
    p_lines,
    p_create_invoice,
    p_invoice_subject,
    p_billing_month,
    p_due_date,
    p_order_discount_amount_yen,
    p_order_discount_rate_basis_points
  );

  v_sale_id := (v_response ->> 'sale_id')::uuid;
  v_invoice_id := nullif(v_response -> 'invoice' ->> 'invoice_id', '')::uuid;

  update public.sales
  set notes = v_notes
  where id = v_sale_id and organization_id = v_organization_id;

  if v_invoice_id is not null then
    update public.invoices
    set notes = v_notes
    where id = v_invoice_id
      and source_sale_id = v_sale_id
      and organization_id = v_organization_id;
  end if;

  -- 既存RPCが作成した監査記録にも、確定時点の備考を含める。
  update public.audit_logs
  set after_json = coalesce(after_json, '{}'::jsonb) || jsonb_build_object('notes', v_notes)
  where id = (
    select log.id from public.audit_logs log
    where log.organization_id = v_organization_id
      and log.entity_id = v_sale_id
      and log.entity_type = 'sale'
      and log.action = 'sale.confirmed'
    order by log.created_at desc
    limit 1
  );

  if v_invoice_id is not null then
    update public.audit_logs
    set after_json = coalesce(after_json, '{}'::jsonb) || jsonb_build_object('notes', v_notes)
    where id = (
      select log.id from public.audit_logs log
      where log.organization_id = v_organization_id
        and log.entity_id = v_invoice_id
        and log.entity_type = 'invoice'
        and log.action = 'invoice.created_from_sale'
      order by log.created_at desc
      limit 1
    );
  end if;

  v_response := v_response || jsonb_build_object('notes', v_notes);
  update public.idempotency_requests
  set response_json = v_response, completed_at = now()
  where id = v_request_id;
  return v_response;
end;
$$;

revoke all on function public.checkout_sale_with_notes(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date, bigint, integer, text) from public;
revoke all on function public.inherit_sale_notes_to_invoice() from public;
grant execute on function public.checkout_sale_with_notes(uuid, uuid, uuid, date, uuid, bigint, jsonb, boolean, text, date, date, bigint, integer, text) to authenticated;

commit;
