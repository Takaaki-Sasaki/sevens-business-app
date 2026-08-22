import { useEffect, useRef, useState } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import { cancelInvoice, getInvoiceDetail, issueInvoice, listInvoices, markInvoicePaid } from './invoiceApi';
import { InvoiceDetailPanel } from './InvoiceDetailPanel';
import { InvoiceList } from './InvoiceList';
import { ManualInvoiceForm } from './ManualInvoiceForm';
import { createEmptyInvoiceFilters, type Invoice, type InvoiceDetail, type InvoiceFilters } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type Editor = { kind: 'create' } | { kind: 'edit'; invoice: Invoice } | { kind: 'detail'; invoice?: Invoice };
export type InvoiceFilterRequest = { id: number; filters: InvoiceFilters };

export function InvoicePage({ profile, filterRequest }: { profile: Profile; filterRequest?: InvoiceFilterRequest }) {
  const [draftFilters, setDraftFilters] = useState<InvoiceFilters>(() => filterRequest?.filters ?? createEmptyInvoiceFilters());
  const [activeFilters, setActiveFilters] = useState<InvoiceFilters>(() => filterRequest?.filters ?? createEmptyInvoiceFilters());
  const handledFilterRequestId = useRef(filterRequest?.id);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editor, setEditor] = useState<Editor>({ kind: 'detail' });
  const [detail, setDetail] = useState<InvoiceDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<'issue' | 'paid' | 'cancel'>();
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedInvoiceId = editor.kind === 'create' ? undefined : editor.invoice?.id;
  const canWrite = hasPermission(profile.role, 'invoices.write');

  useEffect(() => {
    if (!filterRequest || handledFilterRequestId.current === filterRequest.id) return;
    handledFilterRequestId.current = filterRequest.id;
    setDraftFilters(filterRequest.filters);
    setActiveFilters(filterRequest.filters);
    setEditor({ kind: 'detail' });
  }, [filterRequest]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listInvoices(profile.organization_id, activeFilters)
      .then((rows) => { if (!cancelled) { setInvoices(rows); if (selectedInvoiceId && !rows.some((invoice) => invoice.id === selectedInvoiceId)) setEditor({ kind: 'detail' }); } })
      .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '請求一覧を取得できませんでした。' })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, activeFilters, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedInvoiceId) { setDetail(undefined); return undefined; }
    setDetailLoading(true);
    setError(null);
    void getInvoiceDetail(profile.organization_id, selectedInvoiceId)
      .then((nextDetail) => { if (!cancelled) setDetail(nextDetail); })
      .catch((caught: unknown) => { if (!cancelled) { setDetail(undefined); setError(toUserMessage(caught, { fallback: '請求詳細を取得できませんでした。' })); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, selectedInvoiceId, refreshKey]);

  async function runAction(action: 'issue' | 'paid' | 'cancel', operation: () => Promise<unknown>) {
    setPendingAction(action);
    setError(null);
    try { await operation(); setRefreshKey((value) => value + 1); } catch (caught) { setError(toUserMessage(caught, { fallback: '請求状態を更新できませんでした。', retryAction: '操作を実行' })); } finally { setPendingAction(undefined); }
  }

  return (
    <section className="page-view invoices-page" aria-labelledby="invoices-page-title">
      <header className="page-header"><div><p className="eyebrow">INVOICE MANAGEMENT</p><h1 id="invoices-page-title">請求管理</h1><p className="page-description">売上から作成した請求と、手動登録した請求を一元管理します。</p></div></header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}
      <div className="invoice-workspace">
        <InvoiceList invoices={invoices} filters={draftFilters} selectedId={selectedInvoiceId} loading={loading} onFiltersChange={setDraftFilters} onSearch={() => setActiveFilters({ ...draftFilters })} onClearFilters={() => { const defaults = createEmptyInvoiceFilters(); setDraftFilters(defaults); setActiveFilters(defaults); }} onSelect={(invoice) => setEditor({ kind: 'detail', invoice })} onCreate={() => setEditor({ kind: 'create' })} canCreate={canWrite} />
        {(editor.kind === 'create' || editor.kind === 'edit') && canWrite ? <ManualInvoiceForm organizationId={profile.organization_id} invoiceDetail={editor.kind === 'edit' ? detail : undefined} onSaved={(invoiceId) => { const defaults = createEmptyInvoiceFilters(); setDraftFilters(defaults); setActiveFilters(defaults); setEditor({ kind: 'detail', invoice: { id: invoiceId } as Invoice }); setRefreshKey((value) => value + 1); }} /> : <InvoiceDetailPanel detail={detail} loading={detailLoading} profile={profile} pendingAction={pendingAction} onEdit={() => { if (editor.kind === 'detail' && editor.invoice) setEditor({ kind: 'edit', invoice: editor.invoice }); }} onIssue={() => runAction('issue', () => issueInvoice(selectedInvoiceId!))} onMarkPaid={() => runAction('paid', () => markInvoicePaid(selectedInvoiceId!))} onCancel={(reason) => runAction('cancel', () => cancelInvoice(selectedInvoiceId!, reason))} />}
      </div>
    </section>
  );
}
