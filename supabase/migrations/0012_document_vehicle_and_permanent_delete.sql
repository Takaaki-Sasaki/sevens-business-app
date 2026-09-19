-- Phase 19: 帳票の車両表示と、管理者限定の売上・請求物理削除
-- 0001〜0011 を適用済みの Supabase SQL Editor で実行する。

begin;

-- 請求本体、明細、請求を元にした帳票発行履歴を同じトランザクションで完全削除する。
-- テーブルへのDELETEポリシーは追加せず、この管理者専用RPCだけを削除経路とする。
create or replace function public.delete_invoice_permanently(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_role public.app_role;
  v_invoice public.invoices%rowtype;
  v_item_count integer := 0;
  v_document_count integer := 0;
  v_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_invoice_id is null then raise exception '完全削除する請求を指定してください。'; end if;

  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then
    raise exception '請求の完全削除は管理者のみ実行できます。';
  end if;

  select invoice.* into v_invoice
  from public.invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = v_organization_id
  for update;
  if v_invoice.id is null then raise exception '完全削除する請求データが見つかりません。'; end if;

  delete from public.documents
  where organization_id = v_organization_id and source_invoice_id = p_invoice_id;
  get diagnostics v_document_count = row_count;

  delete from public.invoice_items
  where organization_id = v_organization_id and invoice_id = p_invoice_id;
  get diagnostics v_item_count = row_count;

  delete from public.invoices
  where organization_id = v_organization_id and id = p_invoice_id;

  v_response := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_number', v_invoice.invoice_number,
    'deleted', true,
    'deleted_item_count', v_item_count,
    'deleted_document_count', v_document_count
  );
  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata
  ) values (
    v_organization_id, v_operator_id, 'invoice.deleted_permanently', 'invoice', p_invoice_id,
    to_jsonb(v_invoice), null,
    jsonb_build_object('deleted_item_count', v_item_count, 'deleted_document_count', v_document_count)
  );
  return v_response;
end;
$$;

-- 売上に請求が紐付いている場合は請求を先に完全削除させる。
-- 意図せず請求まで連鎖削除しないことで、会計・請求の削除対象を管理者が個別に確認できる。
create or replace function public.delete_sale_permanently(p_sale_id uuid)
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
  v_invoice_count integer := 0;
  v_item_reference_count integer := 0;
  v_item_count integer := 0;
  v_payment_count integer := 0;
  v_document_count integer := 0;
  v_response jsonb;
begin
  if v_operator_id is null then raise exception 'ログインが必要です。'; end if;
  if p_sale_id is null then raise exception '完全削除する売上を指定してください。'; end if;

  select profile.organization_id, profile.role into v_organization_id, v_role
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null or v_role <> 'admin' then
    raise exception '売上の完全削除は管理者のみ実行できます。';
  end if;

  select sale.* into v_sale
  from public.sales sale
  where sale.id = p_sale_id and sale.organization_id = v_organization_id
  for update;
  if v_sale.id is null then raise exception '完全削除する売上データが見つかりません。'; end if;

  select count(*) into v_invoice_count
  from public.invoices invoice
  where invoice.organization_id = v_organization_id and invoice.source_sale_id = p_sale_id;
  if v_invoice_count > 0 then
    raise exception '紐づく請求データがあるため、先に請求管理から該当請求を完全削除してください。';
  end if;

  select count(*) into v_item_reference_count
  from public.invoice_items invoice_item
  join public.sale_items sale_item on sale_item.id = invoice_item.source_sale_item_id
  where sale_item.organization_id = v_organization_id and sale_item.sale_id = p_sale_id;
  if v_item_reference_count > 0 then
    raise exception '売上明細を参照する請求データがあるため、先に該当請求を完全削除してください。';
  end if;

  delete from public.documents
  where organization_id = v_organization_id and source_sale_id = p_sale_id;
  get diagnostics v_document_count = row_count;

  delete from public.payments
  where organization_id = v_organization_id and sale_id = p_sale_id;
  get diagnostics v_payment_count = row_count;

  delete from public.sale_items
  where organization_id = v_organization_id and sale_id = p_sale_id;
  get diagnostics v_item_count = row_count;

  delete from public.sales
  where organization_id = v_organization_id and id = p_sale_id;

  v_response := jsonb_build_object(
    'sale_id', p_sale_id,
    'sale_number', v_sale.sale_number,
    'deleted', true,
    'deleted_item_count', v_item_count,
    'deleted_payment_count', v_payment_count,
    'deleted_document_count', v_document_count
  );
  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, before_json, after_json, metadata
  ) values (
    v_organization_id, v_operator_id, 'sale.deleted_permanently', 'sale', p_sale_id,
    to_jsonb(v_sale), null,
    jsonb_build_object(
      'deleted_item_count', v_item_count,
      'deleted_payment_count', v_payment_count,
      'deleted_document_count', v_document_count
    )
  );
  return v_response;
end;
$$;

revoke all on function public.delete_invoice_permanently(uuid) from public;
revoke all on function public.delete_sale_permanently(uuid) from public;
grant execute on function public.delete_invoice_permanently(uuid) to authenticated;
grant execute on function public.delete_sale_permanently(uuid) to authenticated;

commit;
