import { useEffect, useState } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import type { CreateInvoiceFromSaleInput } from '../invoices/types';
import type { SaleDetail } from './types';
import { formatDiscountRate } from '../pos/cart';

type SaleDetailPanelProps = {
  detail?: SaleDetail;
  loading: boolean;
  profile: Profile;
  onSaveNotes: (notes: string) => Promise<void>;
  notesSaving: boolean;
  onCancel: (reason: string) => Promise<void>;
  cancelling: boolean;
  onCreateInvoice: (input: CreateInvoiceFromSaleInput) => Promise<void>;
  invoiceCreating: boolean;
  onDelete: () => Promise<void>;
  deleting: boolean;
};

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? quantity.toLocaleString() : quantity.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatVehicle(detail: SaleDetail): string {
  if (!detail.vehicle) return detail.sale.vehicle_id ? '登録済み車両（現在は参照不可）' : '車両指定なし';
  const parts = [detail.vehicle.registration_number, detail.vehicle.manufacturer, detail.vehicle.model_name].filter(Boolean);
  return parts.join(' / ') || 'ナンバー未登録の車両';
}

export function SaleDetailPanel({ detail, loading, profile, onSaveNotes, notesSaving, onCancel, cancelling, onCreateInvoice, invoiceCreating, onDelete, deleting }: SaleDetailPanelProps) {
  const [reason, setReason] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [invoiceSubject, setInvoiceSubject] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [dueDate, setDueDate] = useState('');
  const canCancel = !!detail && detail.sale.status === 'confirmed' && hasPermission(profile.role, 'sales.cancel');
  const canDelete = !!detail && hasPermission(profile.role, 'sales.delete');
  const canCreateInvoice = !!detail && detail.sale.status === 'confirmed' && !detail.invoice && hasPermission(profile.role, 'invoices.write');
  const canUpdateNotes = hasPermission(profile.role, 'sales.notes.update');

  useEffect(() => {
    if (!detail) return;
    setInvoiceSubject(`売上 ${detail.sale.sale_number} 分`);
    setBillingMonth(detail.sale.sale_date.slice(0, 7));
    setDueDate('');
  }, [detail?.sale.id]);

  useEffect(() => {
    setNotesInput(detail?.sale.notes || '');
  }, [detail?.sale.id, detail?.sale.notes]);

  async function handleCancel() {
    if (!detail) return;
    if (!window.confirm(`売上 ${detail.sale.sale_number} を取り消しますか？\n取消後も履歴は残ります。`)) return;
    await onCancel(reason);
    setReason('');
  }

  async function handleCreateInvoice() {
    if (!detail) return;
    await onCreateInvoice({
      saleId: detail.sale.id,
      subject: invoiceSubject,
      billingMonth: billingMonth ? `${billingMonth}-01` : undefined,
      dueDate: dueDate || undefined,
    });
  }

  async function handleDelete() {
    if (!detail || !window.confirm(`売上 ${detail.sale.sale_number} を完全に削除しますか？\n明細・支払・帳票発行履歴も削除され、元に戻せません。\n紐づく請求がある場合は、先に請求を完全削除してください。`)) return;
    await onDelete();
  }

  if (loading) {
    return <section className="panel sale-detail-panel sale-detail-placeholder"><p>売上詳細を読み込んでいます…</p></section>;
  }
  if (!detail) {
    return <section className="panel sale-detail-panel sale-detail-placeholder"><p>左の一覧から売上を選択すると、明細と会計内容を確認できます。</p></section>;
  }

  const { sale, items, payments } = detail;
  const lineDiscountYen = items.reduce((total, item) => total + item.discount_yen, 0);
  const orderDiscountLabel = sale.order_discount_rate_basis_points === null
    ? '会計割引'
    : `会計割引（${formatDiscountRate(sale.order_discount_rate_basis_points)}%）`;
  return (
    <section className="panel sale-detail-panel" aria-labelledby="sale-detail-title">
      <header className="panel-heading sale-detail-heading">
        <div>
          <p className="eyebrow">SALE DETAIL</p>
          <h2 id="sale-detail-title">{sale.sale_number}</h2>
        </div>
        <span className={`sale-status ${sale.status}`}>{sale.status === 'confirmed' ? '確定' : sale.status === 'cancelled' ? '取消済み' : '下書き'}</span>
      </header>
      <div className="sale-detail-body">
        <dl className="sale-meta-grid">
          <div><dt>売上日</dt><dd>{sale.sale_date.replaceAll('-', '/')}</dd></div>
          <div><dt>顧客</dt><dd>{sale.customer_name_snapshot || '一般客'}</dd></div>
          <div><dt>車両</dt><dd>{formatVehicle(detail)}</dd></div>
          <div><dt>会計時刻</dt><dd>{sale.confirmed_at ? new Date(sale.confirmed_at).toLocaleString('ja-JP') : '—'}</dd></div>
        </dl>
        {canUpdateNotes ? (
          <section className="record-notes-editor" aria-labelledby="sale-notes-title">
            <label className="field">
              <span id="sale-notes-title">備考</span>
              <textarea rows={4} maxLength={5000} value={notesInput} placeholder="帳票へ記載するコメントなどを入力" onChange={(event) => setNotesInput(event.target.value)} />
            </label>
            <div className="record-notes-actions">
              <small>{notesInput.length.toLocaleString()} / 5,000文字{detail.invoice ? '　保存すると紐づく請求にも反映されます。' : ''}</small>
              <button type="button" className="secondary-button" disabled={notesSaving || notesInput.trim() === (sale.notes || '')} onClick={() => void onSaveNotes(notesInput)}>{notesSaving ? '保存中…' : '備考を保存'}</button>
            </div>
          </section>
        ) : sale.notes ? <section className="record-notes"><strong>備考</strong><p>{sale.notes}</p></section> : null}

        <div className="sale-item-table-wrap">
          <table className="sale-item-table">
            <thead><tr><th>商品・作業</th><th>数量</th><th>単価</th><th>割引</th><th>税</th><th>金額</th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.product_name_snapshot}</strong><small>{item.product_code_snapshot || 'コードなし'}</small></td>
                  <td>{formatQuantity(item.quantity)}</td>
                  <td>¥{item.unit_price_yen.toLocaleString()}</td>
                  <td>{item.discount_yen ? `−¥${item.discount_yen.toLocaleString()}` : '—'}</td>
                  <td>¥{item.tax_amount_yen.toLocaleString()}</td>
                  <td><strong>¥{item.line_total_yen.toLocaleString()}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sale-detail-footer">
          <div className="sale-payments">
            <p className="eyebrow">PAYMENT</p>
            {payments.map((payment) => (
              <p key={payment.id}>{payment.payment_method_name_snapshot} <strong>¥{payment.amount_yen.toLocaleString()}</strong>{payment.change_amount_yen > 0 ? `（お釣り ¥${payment.change_amount_yen.toLocaleString()}）` : ''}</p>
            ))}
          </div>
          <dl className="sale-totals">
            <div><dt>小計</dt><dd>¥{sale.subtotal_yen.toLocaleString()}</dd></div>
            {lineDiscountYen > 0 && <div><dt>明細割引</dt><dd>−¥{lineDiscountYen.toLocaleString()}</dd></div>}
            <div><dt>消費税</dt><dd>¥{sale.tax_amount_yen.toLocaleString()}</dd></div>
            <div><dt>割引前合計</dt><dd>¥{sale.pre_order_discount_total_yen.toLocaleString()}</dd></div>
            <div><dt>{orderDiscountLabel}</dt><dd>{sale.order_discount_amount_yen ? `−¥${sale.order_discount_amount_yen.toLocaleString()}` : '¥0'}</dd></div>
            <div className="grand"><dt>合計</dt><dd>¥{sale.total_amount_yen.toLocaleString()}</dd></div>
          </dl>
        </div>

        {sale.status === 'cancelled' && (
          <p className="sale-cancelled-note">取消日時：{sale.cancelled_at ? new Date(sale.cancelled_at).toLocaleString('ja-JP') : '—'}{sale.cancellation_reason ? ` ／ 理由：${sale.cancellation_reason}` : ''}</p>
        )}
        {detail.invoice && (
          <p className="sale-invoice-linked">請求データ作成済み：<strong>{detail.invoice.invoice_number}</strong>（{detail.invoice.status === 'draft' ? '下書き' : detail.invoice.status}）</p>
        )}
        {canCreateInvoice && (
          <div className="sale-invoice-action">
            <div>
              <p className="eyebrow">CREATE INVOICE</p>
              <h3>この売上から請求データを作成</h3>
            </div>
            <div className="sale-invoice-form">
              <label className="field"><span>件名</span><input value={invoiceSubject} maxLength={200} onChange={(event) => setInvoiceSubject(event.target.value)} /></label>
              <label className="field"><span>請求月</span><input type="month" value={billingMonth} onChange={(event) => setBillingMonth(event.target.value)} /></label>
              <label className="field"><span>支払期限（任意）</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            </div>
            <button type="button" className="secondary-button" disabled={invoiceCreating} onClick={() => void handleCreateInvoice()}>{invoiceCreating ? '請求データを作成中…' : '請求データを作成'}</button>
          </div>
        )}
        {canCancel && (
          <div className="sale-cancel-action">
            <label className="field">
              <span>取消理由（任意）</span>
              <input value={reason} maxLength={500} placeholder="例：入力誤りのため" onChange={(event) => setReason(event.target.value)} />
            </label>
            <button type="button" className="danger-button" disabled={cancelling} onClick={() => void handleCancel()}>{cancelling ? '取り消し中…' : 'この売上を取消'}</button>
          </div>
        )}
        {canDelete && (
          <div className="permanent-delete-action">
            <div><strong>売上データの完全削除</strong><small>明細・支払・帳票発行履歴を含めて削除します。この操作は元に戻せません。</small></div>
            <button type="button" className="danger-button" disabled={deleting || cancelling || invoiceCreating} onClick={() => void handleDelete()}>{deleting ? '完全削除中…' : '売上を完全削除'}</button>
          </div>
        )}
      </div>
    </section>
  );
}
