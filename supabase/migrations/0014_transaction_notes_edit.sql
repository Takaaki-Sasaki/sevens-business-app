-- Phase 21: 売上履歴・請求管理からの備考参照／修正
-- 0001〜0013 を適用済みの Supabase SQL Editor で実行する。

begin;

-- 売上の備考を更新し、売上由来の請求にも同じ内容を同期する。
create or replace function public.update_sale_notes(
  p_sale_id uuid,
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
  v_sale public.sales%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_synced_invoice_count integer := 0;
  v_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_sale_id is null then raise exception '備考を更新する売上を指定してください。'; end if;
  if v_notes is not null and char_length(v_notes) > 5000 then
    raise exception '備考は5,000文字以内で入力してください。';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;

  select sale.* into v_sale
  from public.sales sale
  where sale.id = p_sale_id
    and sale.organization_id = v_organization_id
    and sale.deleted_at is null
  for update;
  if v_sale.id is null then raise exception '備考を更新する売上が見つかりません。'; end if;

  update public.sales
  set notes = v_notes
  where id = v_sale.id and organization_id = v_organization_id;

  update public.invoices
  set notes = v_notes
  where source_sale_id = v_sale.id
    and organization_id = v_organization_id
    and deleted_at is null;
  get diagnostics v_synced_invoice_count = row_count;

  v_response := jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'notes', v_notes,
    'synced_invoice_count', v_synced_invoice_count
  );
  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata
  ) values (
    v_organization_id, v_operator_id, 'sale.notes_updated', 'sale', v_sale.id,
    jsonb_build_object('notes', v_sale.notes),
    jsonb_build_object('notes', v_notes),
    jsonb_build_object('synced_invoice_count', v_synced_invoice_count)
  );
  return v_response;
end;
$$;

-- 請求の備考を更新する。売上由来の場合は元売上と同じ売上に紐づく請求も同期する。
create or replace function public.update_invoice_notes(
  p_invoice_id uuid,
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
  v_invoice public.invoices%rowtype;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_synced_sale_count integer := 0;
  v_synced_invoice_count integer := 0;
  v_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_invoice_id is null then raise exception '備考を更新する請求を指定してください。'; end if;
  if v_notes is not null and char_length(v_notes) > 5000 then
    raise exception '備考は5,000文字以内で入力してください。';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then raise exception '有効な利用者情報がありません。'; end if;

  select invoice.* into v_invoice
  from public.invoices invoice
  where invoice.id = p_invoice_id
    and invoice.organization_id = v_organization_id
    and invoice.deleted_at is null;
  if v_invoice.id is null then raise exception '備考を更新する請求が見つかりません。'; end if;

  -- 売上由来の場合は、売上→請求の順にロックして同時更新時の競合を避ける。
  if v_invoice.source_sale_id is not null then
    perform 1
    from public.sales sale
    where sale.id = v_invoice.source_sale_id
      and sale.organization_id = v_organization_id
      and sale.deleted_at is null
    for update;
  end if;

  select invoice.* into v_invoice
  from public.invoices invoice
  where invoice.id = p_invoice_id
    and invoice.organization_id = v_organization_id
    and invoice.deleted_at is null
  for update;
  if v_invoice.id is null then raise exception '備考を更新する請求が見つかりません。'; end if;

  if v_invoice.source_sale_id is not null then
    update public.sales
    set notes = v_notes
    where id = v_invoice.source_sale_id
      and organization_id = v_organization_id
      and deleted_at is null;
    get diagnostics v_synced_sale_count = row_count;

    update public.invoices
    set notes = v_notes
    where source_sale_id = v_invoice.source_sale_id
      and organization_id = v_organization_id
      and deleted_at is null;
    get diagnostics v_synced_invoice_count = row_count;
  else
    update public.invoices
    set notes = v_notes
    where id = v_invoice.id and organization_id = v_organization_id;
    v_synced_invoice_count := 1;
  end if;

  v_response := jsonb_build_object(
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'source_sale_id', v_invoice.source_sale_id,
    'notes', v_notes
  );
  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata
  ) values (
    v_organization_id, v_operator_id, 'invoice.notes_updated', 'invoice', v_invoice.id,
    jsonb_build_object('notes', v_invoice.notes),
    jsonb_build_object('notes', v_notes),
    jsonb_build_object(
      'synced_sale_count', v_synced_sale_count,
      'synced_invoice_count', v_synced_invoice_count
    )
  );
  return v_response;
end;
$$;

revoke all on function public.update_sale_notes(uuid, text) from public;
revoke all on function public.update_invoice_notes(uuid, text) from public;
grant execute on function public.update_sale_notes(uuid, text) to authenticated;
grant execute on function public.update_invoice_notes(uuid, text) to authenticated;

commit;
