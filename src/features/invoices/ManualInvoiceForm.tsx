import { useEffect, useMemo, useState } from 'react';
import { listCustomers } from '../customers/customerApi';
import type { Customer } from '../customers/types';
import { categoryPath } from '../products/categoryTree';
import { getTaxRoundingMode, listActiveCategories, listActiveProducts, listTaxRates } from '../products/productApi';
import type { Product, ProductCategory, TaxRate } from '../products/types';
import type { TaxRoundingMode } from '../pos/cart';
import { createManualInvoice, updateManualInvoice } from './invoiceApi';
import { calculateManualInvoice, createManualInvoiceLine, validateManualInvoice } from './manualInvoice';
import type { InvoiceDetail, ManualInvoiceLineInput } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type ManualInvoiceFormProps = {
  organizationId: string;
  invoiceDetail?: InvoiceDetail;
  onSaved: (invoiceId: string) => void;
};

function inputLinesFromDetail(detail: InvoiceDetail, taxRates: TaxRate[]): ManualInvoiceLineInput[] {
  return detail.items.map((item) => ({
    id: item.id,
    productId: item.product_id || '',
    itemName: item.item_name_snapshot,
    quantity: String(item.quantity),
    unitPriceYen: String(item.unit_price_yen),
    discountYen: String(item.discount_yen),
    taxRateId: item.tax_rate_id || taxRates.find((rate) => rate.rate_basis_points === item.tax_rate_basis_points)?.id || '',
  }));
}

export function ManualInvoiceForm({ organizationId, invoiceDetail, onSaved }: ManualInvoiceFormProps) {
  const editingInvoice = invoiceDetail?.invoice;
  const isEditing = !!editingInvoice;
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [roundingMode, setRoundingMode] = useState<TaxRoundingMode>('round');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>();
  const [customerDisplay, setCustomerDisplay] = useState('');
  const [subject, setSubject] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<ManualInvoiceLineInput[]>([createManualInvoiceLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listTaxRates(organizationId),
      getTaxRoundingMode(organizationId),
      listActiveProducts(organizationId),
      listActiveCategories(organizationId),
    ])
      .then(([rates, mode, nextProducts, nextCategories]) => {
        if (cancelled) return;
        setTaxRates(rates);
        setRoundingMode(mode);
        setProducts(nextProducts);
        setCategories(nextCategories);
        setLines((current) => current.map((line) => {
          if (line.taxRateId || !rates[0]) return line;
          return { ...line, taxRateId: rates[0].id };
        }));
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '請求登録に必要なマスタを取得できませんでした。' })); });
    return () => { cancelled = true; };
  }, [organizationId]);

  useEffect(() => {
    if (!editingInvoice || !invoiceDetail) {
      setCustomerSearch('');
      setCustomerId(undefined);
      setCustomerDisplay('');
      setSubject('');
      setBillingMonth('');
      setDueDate('');
      setLines([createManualInvoiceLine(taxRates[0]?.id)]);
      setIdempotencyKey(crypto.randomUUID());
      setError(null);
      return;
    }
    setCustomerSearch('');
    setCustomerId(editingInvoice.customer_id || undefined);
    setCustomerDisplay(editingInvoice.customer_name_snapshot || '');
    setSubject(editingInvoice.subject || '');
    setBillingMonth(editingInvoice.billing_month ? editingInvoice.billing_month.slice(0, 7) : '');
    setDueDate(editingInvoice.due_date || '');
    setLines(inputLinesFromDetail(invoiceDetail, taxRates));
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  }, [editingInvoice?.id, invoiceDetail, taxRates]);

  useEffect(() => {
    let cancelled = false;
    const term = customerSearch.trim();
    if (!term || customerId) {
      setCustomerResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void listCustomers(organizationId, term)
        .then((customers) => { if (!cancelled) setCustomerResults(customers.slice(0, 8)); })
        .catch(() => { if (!cancelled) setCustomerResults([]); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [organizationId, customerSearch, customerId]);

  const totals = useMemo(() => calculateManualInvoice(lines, taxRates, roundingMode), [lines, taxRates, roundingMode]);

  function invalidateRequest() { setIdempotencyKey(crypto.randomUUID()); }
  function updateLine(id: string, patch: Partial<ManualInvoiceLineInput>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    invalidateRequest();
  }

  function chooseProduct(line: ManualInvoiceLineInput, productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      updateLine(line.id, { productId: '' });
      return;
    }
    updateLine(line.id, {
      productId,
      itemName: product.name,
      unitPriceYen: String(product.price_yen),
      taxRateId: product.tax_rate_id || line.taxRateId,
    });
  }

  async function submit() {
    const validationError = validateManualInvoice({ customerId, billingMonth, dueDate, lines }, taxRates);
    if (validationError) { setError(validationError); return; }
    if (totals.totalAmountYen <= 0) { setError('請求金額は1円以上になるよう明細を入力してください。'); return; }
    setSaving(true);
    setError(null);
    try {
      const input = { idempotencyKey, customerId, subject, billingMonth, dueDate, lines };
      const result = isEditing
        ? await updateManualInvoice({ ...input, invoiceId: editingInvoice.id })
        : await createManualInvoice(input);
      onSaved(result.invoice_id);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: isEditing ? '請求データを更新できませんでした。' : '請求データを作成できませんでした。', retryAction: isEditing ? '請求データを保存' : '請求データを作成' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel manual-invoice-panel" aria-labelledby="manual-invoice-title">
      <header className="panel-heading">
        <div><p className="eyebrow">{isEditing ? 'EDIT MANUAL INVOICE' : 'MANUAL INVOICE'}</p><h2 id="manual-invoice-title">{isEditing ? '請求を編集' : '請求登録'}</h2></div>
      </header>
      <div className="manual-invoice-form">
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="manual-invoice-customer">
          <label className="field"><span>請求先顧客（任意）</span><input value={customerId ? customerDisplay : customerSearch} placeholder="必要な場合のみ顧客を検索" onChange={(event) => { setCustomerId(undefined); setCustomerDisplay(''); setCustomerSearch(event.target.value); invalidateRequest(); }} /></label>
          {customerId && <button type="button" className="text-button" onClick={() => { setCustomerId(undefined); setCustomerDisplay(''); setCustomerSearch(''); invalidateRequest(); }}>選択解除</button>}
          {!customerId && customerSearch && <div className="customer-search-results">{customerResults.map((item) => <button key={item.id} type="button" onClick={() => { setCustomerId(item.id); setCustomerDisplay(`${item.customer_code} / ${item.name}`); setCustomerSearch(''); invalidateRequest(); }}><strong>{item.name}</strong><small>{item.customer_code} ／ {item.phone || item.mobile_phone || '電話番号未登録'}</small></button>)}</div>}
        </div>
        <div className="manual-invoice-header-fields">
          <label className="field"><span>件名</span><input value={subject} maxLength={200} placeholder="例：8月分整備代" onChange={(event) => { setSubject(event.target.value); invalidateRequest(); }} /></label>
          <label className="field"><span>請求月（任意）</span><input type="month" value={billingMonth} onChange={(event) => { setBillingMonth(event.target.value); invalidateRequest(); }} /></label>
          <label className="field"><span>支払期限（任意）</span><input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); invalidateRequest(); }} /></label>
        </div>
        <div className="manual-invoice-lines">
          <div className="manual-invoice-line-label"><span>商品（任意）</span><span>内容</span><span>数量</span><span>単価</span><span>割引</span><span>税率</span><span>金額</span><span aria-hidden="true" /></div>
          {lines.map((line, index) => {
            const calculated = totals.lines[index];
            const selectedProductIsUnavailable = !!line.productId && !products.some((product) => product.id === line.productId);
            return (
              <div className="manual-invoice-line" key={line.id}>
                <select aria-label={`明細${index + 1}の商品`} value={line.productId} onChange={(event) => chooseProduct(line, event.target.value)}>
                  <option value="">商品を選択（任意）</option>
                  {selectedProductIsUnavailable && <option value={line.productId}>選択済み：{line.itemName}（現在は利用不可）</option>}
                  {products.map((product) => <option value={product.id} key={product.id}>{categoryPath(product.category_id, categories) || '未分類'} ／ {product.product_code} ／ {product.name}</option>)}
                </select>
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
        <button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? '保存中…' : isEditing ? '請求データを保存' : '請求データを作成'}</button>
      </div>
    </section>
  );
}
