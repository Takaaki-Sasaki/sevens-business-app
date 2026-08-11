import { useEffect, useMemo, useState } from 'react';
import type { Profile } from '../auth/types';
import { listPaymentMethods } from '../products/productApi';
import { cancelSale, getSaleDetail, listSaleOperators, listSales } from './saleApi';
import { SaleDetailPanel } from './SaleDetailPanel';
import type { Sale, SaleDetail, SaleFilters, SaleOperator } from './types';
import type { PaymentMethod } from '../products/types';
import { createInvoiceFromSale } from '../invoices/invoiceApi';
import type { CreateInvoiceFromSaleInput } from '../invoices/types';
import { toUserMessage } from '../../shared/lib/userError';

function currentMonthFilters(): SaleFilters {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return { from: `${local.slice(0, 8)}01`, to: local, query: '', payment_method_id: '', operator_id: '' };
}

function displayOperator(operator?: SaleOperator): string {
  return operator?.display_name || operator?.email || '—';
}

export function SalesHistoryPage({ profile }: { profile: Profile }) {
  const [draftFilters, setDraftFilters] = useState<SaleFilters>(currentMonthFilters);
  const [activeFilters, setActiveFilters] = useState<SaleFilters>(currentMonthFilters);
  const [sales, setSales] = useState<Sale[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [operators, setOperators] = useState<SaleOperator[]>([]);
  const [selectedSaleId, setSelectedSaleId] = useState<string>();
  const [detail, setDetail] = useState<SaleDetail>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [invoiceCreating, setInvoiceCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listPaymentMethods(profile.organization_id),
      listSaleOperators(profile.organization_id),
    ])
      .then(([methods, nextOperators]) => {
        if (cancelled) return;
        setPaymentMethods(methods);
        setOperators(nextOperators);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toUserMessage(caught, { fallback: '検索条件を取得できませんでした。' }));
      });
    return () => { cancelled = true; };
  }, [profile.organization_id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listSales(profile.organization_id, activeFilters)
      .then((rows) => {
        if (cancelled) return;
        setSales(rows);
        setSelectedSaleId((selected) => rows.some((sale) => sale.id === selected) ? selected : undefined);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toUserMessage(caught, { fallback: '売上履歴を取得できませんでした。' }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, activeFilters, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedSaleId) {
      setDetail(undefined);
      return undefined;
    }
    setDetailLoading(true);
    setError(null);
    void getSaleDetail(profile.organization_id, selectedSaleId)
      .then((nextDetail) => { if (!cancelled) setDetail(nextDetail); })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setDetail(undefined);
          setError(toUserMessage(caught, { fallback: '売上詳細を取得できませんでした。' }));
        }
      })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, selectedSaleId, refreshKey]);

  const paymentNames = useMemo(() => new Map(paymentMethods.map((method) => [method.id, method.name])), [paymentMethods]);
  const operatorsById = useMemo(() => new Map(operators.map((operator) => [operator.id, operator])), [operators]);
  const totals = useMemo(() => sales.reduce((sum, sale) => sale.status === 'confirmed' ? sum + sale.total_amount_yen : sum, 0), [sales]);

  async function handleCancel(reason: string) {
    if (!detail) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelSale(detail.sale.id, reason);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '売上を取り消せませんでした。', retryAction: '取消を実行' }));
    } finally {
      setCancelling(false);
    }
  }

  async function handleCreateInvoice(input: CreateInvoiceFromSaleInput) {
    setInvoiceCreating(true);
    setError(null);
    try {
      await createInvoiceFromSale(input);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '請求データを作成できませんでした。', retryAction: '請求データを作成' }));
    } finally {
      setInvoiceCreating(false);
    }
  }

  return (
    <section className="page-view sales-page" aria-labelledby="sales-page-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">SALES HISTORY</p>
          <h1 id="sales-page-title">売上履歴</h1>
          <p className="page-description">確定した会計、明細、支払情報を確認します。取消済みの売上も監査用に保持されます。</p>
        </div>
      </header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}

      <form className="panel sale-filter-panel" onSubmit={(event) => { event.preventDefault(); setActiveFilters({ ...draftFilters }); }}>
        <label className="field"><span>開始日</span><input type="date" value={draftFilters.from} onChange={(event) => setDraftFilters((filters) => ({ ...filters, from: event.target.value }))} /></label>
        <label className="field"><span>終了日</span><input type="date" value={draftFilters.to} onChange={(event) => setDraftFilters((filters) => ({ ...filters, to: event.target.value }))} /></label>
        <label className="field sale-filter-query"><span>売上番号・顧客</span><input value={draftFilters.query} placeholder="例：SAL- / 田中" onChange={(event) => setDraftFilters((filters) => ({ ...filters, query: event.target.value }))} /></label>
        <label className="field"><span>支払方法</span><select value={draftFilters.payment_method_id} onChange={(event) => setDraftFilters((filters) => ({ ...filters, payment_method_id: event.target.value }))}><option value="">すべて</option>{paymentMethods.map((method) => <option value={method.id} key={method.id}>{method.name}</option>)}</select></label>
        <label className="field"><span>担当者</span><select value={draftFilters.operator_id} onChange={(event) => setDraftFilters((filters) => ({ ...filters, operator_id: event.target.value }))}><option value="">すべて</option>{operators.map((operator) => <option value={operator.id} key={operator.id}>{displayOperator(operator)}</option>)}</select></label>
        <div className="sale-filter-actions"><button type="submit" className="primary-button">検索</button><button type="button" className="text-button" onClick={() => { const defaults = currentMonthFilters(); setDraftFilters(defaults); setActiveFilters(defaults); }}>今月に戻す</button></div>
      </form>

      <div className="sales-workspace">
        <section className="panel sales-list-panel" aria-label="売上一覧">
          <header className="panel-heading sales-list-heading">
            <div><p className="eyebrow">RESULTS</p><h2>{loading ? '検索中…' : `${sales.length}件`}</h2></div>
            <strong>確定合計 ¥{totals.toLocaleString()}</strong>
          </header>
          <div className="sales-list">
            {!loading && sales.length === 0 && <p className="pos-empty-state">該当する売上はありません。</p>}
            {sales.map((sale) => (
              <button key={sale.id} type="button" onClick={() => setSelectedSaleId(sale.id)} className={sale.id === selectedSaleId ? 'sale-row selected' : 'sale-row'}>
                <span className="sale-row-date">{sale.sale_date.replaceAll('-', '/')}</span>
                <span className="sale-row-main"><strong>{sale.sale_number}</strong><small>{sale.customer_name_snapshot || '一般客'} ／ {paymentNames.get(sale.primary_payment_method_id || '') || '支払方法なし'} ／ {displayOperator(operatorsById.get(sale.operator_id))}</small></span>
                <span className="sale-row-total"><em className={sale.status}>{sale.status === 'cancelled' ? '取消済み' : '確定'}</em><strong>¥{sale.total_amount_yen.toLocaleString()}</strong></span>
              </button>
            ))}
          </div>
        </section>
        <SaleDetailPanel detail={detail} loading={detailLoading} profile={profile} onCancel={handleCancel} cancelling={cancelling} onCreateInvoice={handleCreateInvoice} invoiceCreating={invoiceCreating} />
      </div>
    </section>
  );
}
