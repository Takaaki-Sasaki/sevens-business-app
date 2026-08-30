import { useState } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import type { InvoiceDetail, InvoiceStatus } from './types';

type InvoiceDetailPanelProps = {
  detail?: InvoiceDetail;
  loading: boolean;
  profile: Profile;
  pendingAction?: 'issue' | 'paid' | 'cancel';
  onEdit: () => void;
  onIssue: () => Promise<void>;
  onMarkPaid: () => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
};

function displayedStatus(detail: InvoiceDetail): InvoiceStatus {
  const invoice = detail.invoice;
  const today = new Date().toISOString().slice(0, 10);
  return invoice.status === 'issued' && !!invoice.due_date && invoice.due_date < today ? 'overdue' : invoice.status;
}

function statusLabel(status: InvoiceStatus): string {
  return ({ draft: '下書き', issued: '発行済み', paid: '入金済み', overdue: '期限超過', cancelled: '取消済み' })[status];
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function InvoiceDetailPanel({ detail, loading, profile, pendingAction, onEdit, onIssue, onMarkPaid, onCancel }: InvoiceDetailPanelProps) {
  const [reason, setReason] = useState('');
  const canWrite = hasPermission(profile.role, 'invoices.write');

  async function cancel() {
    if (!detail || !window.confirm(`請求 ${detail.invoice.invoice_number} を取り消しますか？\n請求データは履歴として保持されます。`)) return;
    await onCancel(reason);
    setReason('');
  }

  if (loading) return <section className="panel invoice-detail-panel invoice-detail-placeholder"><p>請求詳細を読み込んでいます…</p></section>;
  if (!detail) return <section className="panel invoice-detail-panel invoice-detail-placeholder"><p>左の一覧から請求データを選択するか、「請求登録」から新規作成してください。</p></section>;

  const { invoice, items } = detail;
  const status = displayedStatus(detail);
  const canEdit = canWrite && invoice.status === 'draft' && !invoice.source_sale_id;
  return (
    <section className="panel invoice-detail-panel" aria-labelledby="invoice-detail-title">
      <header className="panel-heading invoice-detail-heading">
        <div><p className="eyebrow">INVOICE DETAIL</p><h2 id="invoice-detail-title">{invoice.invoice_number}</h2></div>
        <span className={`invoice-status ${status}`}>{statusLabel(status)}</span>
      </header>
      <div className="invoice-detail-body">
        <dl className="invoice-meta-grid">
          <div><dt>顧客</dt><dd>{invoice.customer_name_snapshot || '顧客未設定'}</dd></div>
          <div><dt>支払方法</dt><dd>{invoice.payment_method_name_snapshot || '未設定'}</dd></div>
          <div><dt>件名</dt><dd>{invoice.subject || '件名未設定'}</dd></div>
          <div><dt>請求月</dt><dd>{invoice.billing_month ? invoice.billing_month.replaceAll('-', '/') : '—'}</dd></div>
          <div><dt>支払期限</dt><dd>{invoice.due_date ? invoice.due_date.replaceAll('-', '/') : '未設定'}</dd></div>
          <div><dt>元売上</dt><dd>{invoice.source_sale_id ? '売上データから作成' : '手動登録'}</dd></div>
          <div><dt>作成日時</dt><dd>{new Date(invoice.created_at).toLocaleString('ja-JP')}</dd></div>
        </dl>
        <div className="invoice-item-table-wrap"><table className="invoice-item-table"><thead><tr><th>明細</th><th>数量</th><th>単価</th><th>割引</th><th>税</th><th>金額</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.item_name_snapshot}</strong></td><td>{formatQuantity(item.quantity)}</td><td>¥{item.unit_price_yen.toLocaleString()}</td><td>{item.discount_yen ? `−¥${item.discount_yen.toLocaleString()}` : '—'}</td><td>¥{item.tax_amount_yen.toLocaleString()}</td><td><strong>¥{item.line_total_yen.toLocaleString()}</strong></td></tr>)}</tbody></table></div>
        <dl className="invoice-totals"><div><dt>小計</dt><dd>¥{invoice.subtotal_yen.toLocaleString()}</dd></div><div><dt>消費税</dt><dd>¥{invoice.tax_amount_yen.toLocaleString()}</dd></div><div className="grand"><dt>請求金額</dt><dd>¥{invoice.total_amount_yen.toLocaleString()}</dd></div></dl>
        {invoice.status === 'cancelled' && <p className="invoice-cancelled-note">取消日時：{invoice.cancelled_at ? new Date(invoice.cancelled_at).toLocaleString('ja-JP') : '—'}{invoice.cancellation_reason ? ` ／ 理由：${invoice.cancellation_reason}` : ''}</p>}
        {canWrite && invoice.status !== 'cancelled' && invoice.status !== 'paid' && <div className="invoice-actions">{canEdit && <button type="button" className="secondary-button" disabled={!!pendingAction} onClick={onEdit}>請求を編集</button>}{invoice.status === 'draft' && <button type="button" className="primary-button" disabled={!!pendingAction} onClick={() => void onIssue()}>{pendingAction === 'issue' ? '発行中…' : '請求を発行済みにする'}</button>}{invoice.status === 'issued' && <button type="button" className="primary-button" disabled={!!pendingAction} onClick={() => void onMarkPaid()}>{pendingAction === 'paid' ? '登録中…' : '入金済みにする'}</button>}<label className="field"><span>取消理由（任意）</span><input value={reason} maxLength={500} placeholder="例：内容誤りのため" onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="danger-button" disabled={!!pendingAction} onClick={() => void cancel()}>{pendingAction === 'cancel' ? '取消中…' : '請求を取消'}</button></div>}
      </div>
    </section>
  );
}
