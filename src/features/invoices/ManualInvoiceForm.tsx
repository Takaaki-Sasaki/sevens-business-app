import { useEffect, useMemo, useState } from 'react';
import { listCustomers } from '../customers/customerApi';
import type { Customer } from '../customers/types';
import { getTaxRoundingMode, listTaxRates } from '../products/productApi';
import type { TaxRate } from '../products/types';
import type { TaxRoundingMode } from '../pos/cart';
import { createManualInvoice } from './invoiceApi';
import { calculateManualInvoice, createManualInvoiceLine, validateManualInvoice } from './manualInvoice';
import type { ManualInvoiceLineInput } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type ManualInvoiceFormProps = {
  organizationId: string;
  onCreated: (invoiceId: string) => void;
};

function initialBillingMonth(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 7);
}

export function ManualInvoiceForm({ organizationId, onCreated }: ManualInvoiceFormProps) {
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [roundingMode, setRoundingMode] = useState<TaxRoundingMode>('round');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer>();
  const [subject, setSubject] = useState('');
  const [billingMonth, setBillingMonth] = useState(initialBillingMonth);
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<ManualInvoiceLineInput[]>([createManualInvoiceLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listTaxRates(organizationId), getTaxRoundingMode(organizationId)])
      .then(([rates, mode]) => {
        if (cancelled) return;
        setTaxRates(rates);
        setRoundingMode(mode);
        setLines((current) => current.map((line) => {
          if (line.taxRateId || !rates[0]) return line;
          return { ...line, taxRateId: rates[0].id };
        }));
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '税率を取得できませんでした。' })); });
    return () => { cancelled = true; };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    const term = customerSearch.trim();
    if (!term || customer) {
      setCustomerResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void listCustomers(organizationId, term)
        .then((customers) => { if (!cancelled) setCustomerResults(customers.slice(0, 8)); })
        .catch(() => { if (!cancelled) setCustomerResults([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [organizationId, customerSearch, customer]);

  const totals = useMemo(() => calculateManualInvoice(lines, taxRates, roundingMode), [lines, taxRates, roundingMode]);

  function invalidateRequest() { setIdempotencyKey(crypto.randomUUID()); }
  function updateLine(id: string, patch: Partial<ManualInvoiceLineInput>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    invalidateRequest();
  }

  async function submit() {
    const validationError = validateManualInvoice({ customerId: customer?.id, billingMonth, dueDate, lines }, taxRates);
    if (validationError) { setError(validationError); return; }
    if (totals.totalAmountYen <= 0) { setError('請求金額は1円以上になるよう明細を入力してください。'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await createManualInvoice({ idempotencyKey, customerId: customer!.id, subject, billingMonth, dueDate, lines });
      onCreated(result.invoice_id);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '請求データを作成できませんでした。', retryAction: '請求データを作成' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel manual-invoice-panel" aria-labelledby="manual-invoice-title">
      <header className="panel-heading">
        <div><p className="eyebrow">MANUAL INVOICE</p><h2 id="manual-invoice-title">請求登録</h2></div>
      </header>
      <div className="manual-invoice-form">
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="manual-invoice-customer">
          <label className="field"><span>請求先顧客</span><input value={customer ? `${customer.customer_code} / ${customer.name}` : customerSearch} placeholder="顧客番号・氏名・電話番号で検索" onChange={(event) => { setCustomer(undefined); setCustomerSearch(event.target.value); invalidateRequest(); }} /></label>
          {customer && <button type="button" className="text-button" onClick={() => { setCustomer(undefined); setCustomerSearch(''); invalidateRequest(); }}>選択解除</button>}
          {!customer && customerSearch && <div className="customer-search-results">{customerResults.map((item) => <button key={item.id} type="button" onClick={() => { setCustomer(item); setCustomerSearch(''); invalidateRequest(); }}><strong>{item.name}</strong><small>{item.customer_code} ／ {item.phone || item.mobile_phone || '電話番号未登録'}</small></button>)}</div>}
        </div>
        <div className="manual-invoice-header-fields">
          <label className="field"><span>件名</span><input value={subject} maxLength={200} placeholder="例：8月分整備代" onChange={(event) => { setSubject(event.target.value); invalidateRequest(); }} /></label>
          <label className="field"><span>請求月</span><input type="month" value={billingMonth} onChange={(event) => { setBillingMonth(event.target.value); invalidateRequest(); }} /></label>
          <label className="field"><span>支払期限（任意）</span><input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); invalidateRequest(); }} /></label>
        </div>
        <div className="manual-invoice-lines">
          <div className="manual-invoice-line-label"><span>内容</span><span>数量</span><span>単価</span><span>割引</span><span>税率</span><span>金額</span><span aria-hidden="true" /></div>
          {lines.map((line, index) => {
            const calculated = totals.lines[index];
            return (
              <div className="manual-invoice-line" key={line.id}>
                <input aria-label={`明細${index + 1}の内容`} value={line.itemName} placeholder="作業・商品名" onChange={(event) => updateLine(line.id, { itemName: event.target.value })} />
                <input aria-label={`明細${index + 1}の数量`} inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
                <input aria-label={`明細${index + 1}の単価`} inputMode="numeric" value={line.unitPriceYen} onChange={(event) => updateLine(line.id, { unitPriceYen: event.target.value })} />
                <input aria-label={`明細${index + 1}の割引`} inputMode="numeric" value={line.discountYen} onChange={(event) => updateLine(line.id, { discountYen: event.target.value })} />
                <select aria-label={`明細${index + 1}の税率`} value={line.taxRateId} onChange={(event) => updateLine(line.id, { taxRateId: event.target.value })}><option value="">税率</option>{taxRates.map((rate) => <option value={rate.id} key={rate.id}>{rate.name}（{rate.rate_basis_points / 100}%）</option>)}</select>
                <strong>¥{calculated?.totalAmountYen.toLocaleString() || '0'}</strong>
                <button type="button" className="text-button" aria-label={`明細${index + 1}を削除`} disabled={lines.length === 1} onClick={() => { setLines((current) => current.filter((item) => item.id !== line.id)); invalidateRequest(); }}>×</button>
              </div>
            );
          })}
          <button type="button" className="secondary-button add-invoice-line" onClick={() => { setLines((current) => [...current, createManualInvoiceLine(taxRates[0]?.id)]); invalidateRequest(); }}>＋ 明細を追加</button>
        </div>
        <dl className="manual-invoice-totals"><div><dt>小計</dt><dd>¥{totals.subtotalYen.toLocaleString()}</dd></div><div><dt>消費税</dt><dd>¥{totals.taxAmountYen.toLocaleString()}</dd></div><div className="grand"><dt>請求金額</dt><dd>¥{totals.totalAmountYen.toLocaleString()}</dd></div></dl>
        <button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? '請求データを作成中…' : '請求データを作成'}</button>
      </div>
    </section>
  );
}
