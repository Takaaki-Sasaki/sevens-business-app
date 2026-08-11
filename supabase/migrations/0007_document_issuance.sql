-- Phase 10: 帳票発行履歴
-- 0001〜0006 を適用済みのSupabase SQL Editorで実行する。

begin;

create or replace function public.record_document_issue(
  p_document_type text,
  p_source_invoice_id uuid default null,
  p_source_sale_id uuid default null,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operator_id uuid := auth.uid();
  v_organization_id uuid;
  v_source_exists boolean := false;
  v_document_id uuid;
  v_file_name text;
  v_response jsonb;
begin
  if v_operator_id is null then
    raise exception 'ログインが必要です。';
  end if;
  if p_document_type not in ('estimate', 'invoice', 'receipt', 'payment_notice', 'order', 'delivery') then
    raise exception '不正な帳票種別です。';
  end if;
  if (p_source_invoice_id is null) = (p_source_sale_id is null) then
    raise exception '請求または売上のいずれか一つを帳票元として指定してください。';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles profile
  where profile.id = v_operator_id and profile.active = true;
  if v_organization_id is null then
    raise exception '有効な利用者情報がありません。';
  end if;

  if p_source_invoice_id is not null then
    select exists (
      select 1 from public.invoices invoice
      where invoice.id = p_source_invoice_id
        and invoice.organization_id = v_organization_id
        and invoice.deleted_at is null
    ) into v_source_exists;
  else
    select exists (
      select 1 from public.sales sale
      where sale.id = p_source_sale_id
        and sale.organization_id = v_organization_id
        and sale.deleted_at is null
    ) into v_source_exists;
  end if;
  if not v_source_exists then
    raise exception '帳票元のデータが見つかりません。';
  end if;

  v_file_name := coalesce(nullif(btrim(p_file_name), ''), p_document_type || '_' || to_char(now(), 'YYYYMMDDHH24MISS') || '.pdf');
  if char_length(v_file_name) > 255 then
    raise exception 'ファイル名が長すぎます。';
  end if;

  insert into public.documents (
    organization_id, document_type, source_sale_id, source_invoice_id, file_name, issued_by
  ) values (
    v_organization_id, p_document_type, p_source_sale_id, p_source_invoice_id, v_file_name, v_operator_id
  ) returning id into v_document_id;

  v_response := jsonb_build_object('document_id', v_document_id, 'file_name', v_file_name, 'document_type', p_document_type);
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, after_json)
  values (v_organization_id, v_operator_id, 'document.print_opened', 'document', v_document_id, v_response);
  return v_response;
end;
$$;

revoke all on function public.record_document_issue(text, uuid, uuid, text) from public;
grant execute on function public.record_document_issue(text, uuid, uuid, text) to authenticated;

create index documents_source_history_idx on public.documents (organization_id, source_invoice_id, source_sale_id, issued_at desc);

commit;
