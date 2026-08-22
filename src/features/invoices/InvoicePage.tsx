import { useEffect, useState } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import { cancelInvoice, getInvoiceDetail, issueInvoice, listInvoices, markInvoicePaid } from './invoiceApi';
import { InvoiceDetailPanel } from './InvoiceDetailPanel';
import { InvoiceList } from './InvoiceList';
import { ManualInvoiceForm } from './ManualInvoiceForm';
import type { Invoice, InvoiceDetail, InvoiceFilters } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type Editor = { kind: 'create' } | { kind: 'edit'; invoice: Invoice } | { kind: 'detail'; invoice?: Invoice };
const defaultFilters: InvoiceFilters = { query: '', customerId: '', status: '' };

export function InvoicePage({ profile }: { profile: Profile }) {
  const [filters, setFilters] = useState<InvoiceFilters>(defaultFilters);
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
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void listInvoices(profile.organization_id, filters)
        .then((rows) => { if (!cancelled) { setInvoices(rows); if (selectedInvoiceId && !rows.some((invoice) => invoice.id === selectedInvoiceId)) setEditor({ kind: 'detail' }); } })
        .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '請求一覧を取得できませんでした。' })); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [profile.organization_id, filters, refreshKey]);

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
        <InvoiceList invoices={invoices} filters={filters} selectedId={selectedInvoiceId} loading={loading} onFiltersChange={setFilters} onSelect={(invoice) => setEditor({ kind: 'detail', invoice })} onCreate={() => setEditor({ kind: 'create' })} canCreate={canWrite} />
        {(editor.kind === 'create' || editor.kind === 'edit') && canWrite ? <ManualInvoiceForm organizationId={profile.organization_id} invoiceDetail={editor.kind === 'edit' ? detail : undefined} onSaved={(invoiceId) => { setFilters(defaultFilters); setEditor({ kind: 'detail', invoice: { id: invoiceId } as Invoice }); setRefreshKey((value) => value + 1); }} /> : <InvoiceDetailPanel detail={detail} loading={detailLoading} profile={profile} pendingAction={pendingAction} onEdit={() => { if (editor.kind === 'detail' && editor.invoice) setEditor({ kind: 'edit', invoice: editor.invoice }); }} onIssue={() => runAction('issue', () => issueInvoice(selectedInvoiceId!))} onMarkPaid={() => runAction('paid', () => markInvoicePaid(selectedInvoiceId!))} onCancel={(reason) => runAction('cancel', () => cancelInvoice(selectedInvoiceId!, reason))} />}
      </div>
    </section>
  );
}
