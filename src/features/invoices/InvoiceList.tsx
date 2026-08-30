import type { Invoice, InvoiceFilters, InvoiceStatus } from './types';

type InvoiceListProps = {
  invoices: Invoice[];
  filters: InvoiceFilters;
  selectedId?: string;
  loading: boolean;
  onFiltersChange: (filters: InvoiceFilters) => void;
  onSearch: () => void;
  onClearFilters: () => void;
  onSelect: (invoice: Invoice) => void;
  onCreate: () => void;
  canCreate: boolean;
};

function visibleStatus(invoice: Invoice): InvoiceStatus {
  const today = new Date().toISOString().slice(0, 10);
  return invoice.status === 'issued' && !!invoice.due_date && invoice.due_date < today ? 'overdue' : invoice.status;
}

function statusLabel(status: InvoiceStatus): string {
  return ({ draft: '下書き', issued: '発行済み', paid: '入金済み', overdue: '期限超過', cancelled: '取消済み' })[status];
}

function displayIssuedDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('ja-JP') : '未発行';
}

export function InvoiceList({ invoices, filters, selectedId, loading, onFiltersChange, onSearch, onClearFilters, onSelect, onCreate, canCreate }: InvoiceListProps) {
  return (
    <section className="panel invoice-list-panel" aria-labelledby="invoice-list-title">
      <header className="panel-heading">
        <div><p className="eyebrow">INVOICES</p><h2 id="invoice-list-title">請求一覧</h2></div>
        {canCreate && <button type="button" className="secondary-button" onClick={onCreate}>＋ 請求登録</button>}
      </header>
      <form className="invoice-filters" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
        <label className="field"><span>発行開始日</span><input type="date" value={filters.issuedFrom} onChange={(event) => onFiltersChange({ ...filters, issuedFrom: event.target.value })} /></label>
        <label className="field"><span>発行終了日</span><input type="date" value={filters.issuedTo} onChange={(event) => onFiltersChange({ ...filters, issuedTo: event.target.value })} /></label>
        <label className="field invoice-filter-query"><span>請求番号・顧客・件名</span><input value={filters.query} placeholder="例：INV- / 田中" onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} /></label>
        <label className="field"><span>状態</span><select value={filters.status} onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as InvoiceFilters['status'] })}><option value="">すべて</option><option value="draft">下書き</option><option value="issued">発行済み</option><option value="overdue">期限超過</option><option value="paid">入金済み</option><option value="cancelled">取消済み</option></select></label>
        <div className="invoice-filter-actions"><button type="submit" className="primary-button">検索</button><button type="button" className="text-button" onClick={onClearFilters}>条件をクリア</button></div>
      </form>
      <div className="invoice-list">
        {loading && <p className="pos-empty-state">請求一覧を読み込んでいます…</p>}
        {!loading && invoices.length === 0 && <p className="pos-empty-state">該当する請求データはありません。</p>}
        {invoices.map((invoice) => {
          const status = visibleStatus(invoice);
          return (
            <button key={invoice.id} type="button" className={invoice.id === selectedId ? 'invoice-row selected' : 'invoice-row'} onClick={() => onSelect(invoice)}>
              <span className="invoice-row-main"><strong>{invoice.invoice_number}</strong><small>{displayIssuedDate(invoice.issued_at)} ／ {invoice.customer_name_snapshot || '顧客未設定'} ／ {invoice.subject || '件名未設定'}</small></span>
              <span className="invoice-row-side"><em className={status}>{statusLabel(status)}</em><strong>¥{invoice.total_amount_yen.toLocaleString()}</strong></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
