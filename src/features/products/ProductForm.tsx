import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { leafCategories } from './categoryTree';
import { createProduct, updateProduct } from './productApi';
import { normalizeProductInput, validateProductInput } from './productValidation';
import type { Product, ProductCategory, ProductInput, TaxRate } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type ProductFormProps = {
  organizationId: string;
  categories: ProductCategory[];
  taxRates: TaxRate[];
  product?: Product;
  onSaved: (product: Product) => void;
  onArchived?: () => Promise<void>;
};

function toInput(product: Product | undefined, defaultTaxRateId: string): ProductInput {
  if (!product) {
    return { product_code: '', name: '', category_id: '', tax_rate_id: defaultTaxRateId, price_yen: '', sort_order: '0', active: true };
  }
  return {
    product_code: product.product_code,
    name: product.name,
    category_id: product.category_id,
    tax_rate_id: product.tax_rate_id || defaultTaxRateId,
    price_yen: String(product.price_yen),
    sort_order: String(product.sort_order),
    active: product.active,
  };
}

export function ProductForm({ organizationId, categories, taxRates, product, onSaved, onArchived }: ProductFormProps) {
  const selectableCategories = useMemo(() => leafCategories(categories).filter((category) => category.active), [categories]);
  const defaultTaxRateId = taxRates[0]?.id || '';
  const [input, setInput] = useState<ProductInput>(() => toInput(product, defaultTaxRateId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const isNew = !product;

  useEffect(() => {
    setInput(toInput(product, defaultTaxRateId));
    setError(null);
  }, [product, defaultTaxRateId]);

  function updateField(field: keyof ProductInput, value: string | boolean) {
    setInput((current) => ({ ...current, [field]: value } as ProductInput));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeProductInput(input);
    const validationError = validateProductInput(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = product
        ? await updateProduct(product.id, normalized)
        : await createProduct(organizationId, normalized);
      onSaved(saved);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '商品を保存できませんでした。', retryAction: '商品を保存' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!product || !onArchived) return;
    if (!window.confirm(`商品「${product.name}」を削除します。過去の売上や請求書は変更されません。よろしいですか？`)) return;
    setArchiving(true);
    setError(null);
    try {
      await onArchived();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '商品を削除できませんでした。', retryAction: '商品を削除' }));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <form className="master-form" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{isNew ? 'NEW PRODUCT' : product.product_code}</p>
          <h2>{isNew ? '商品登録' : '商品を編集'}</h2>
        </div>
        {!isNew && <span className={product.active ? 'status-chip' : 'status-chip muted'}>{product.active ? '有効' : '停止中'}</span>}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>商品コード</span>
          <input value={input.product_code} placeholder="空欄なら自動採番" onChange={(event) => updateField('product_code', event.target.value)} />
        </label>
        <label className="field">
          <span>並び順</span>
          <input inputMode="numeric" value={input.sort_order} onChange={(event) => updateField('sort_order', event.target.value)} />
        </label>
        <label className="field full">
          <span>商品名 <b>必須</b></span>
          <input value={input.name} onChange={(event) => updateField('name', event.target.value)} autoFocus={isNew} required />
        </label>
        <label className="field full">
          <span>カテゴリ <b>必須</b></span>
          <select value={input.category_id} onChange={(event) => updateField('category_id', event.target.value)} required>
            <option value="">末端カテゴリを選択</option>
            {selectableCategories.map((category) => (
              <option key={category.id} value={category.id}>{'　'.repeat(Math.max(0, category.depth - 1))}{category.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>単価（円） <b>必須</b></span>
          <input inputMode="numeric" placeholder="0" value={input.price_yen} onChange={(event) => updateField('price_yen', event.target.value)} required />
        </label>
        <label className="field">
          <span>税率 <b>必須</b></span>
          <select value={input.tax_rate_id} onChange={(event) => updateField('tax_rate_id', event.target.value)} required>
            <option value="">税率を選択</option>
            {taxRates.map((rate) => <option key={rate.id} value={rate.id}>{rate.name}（{rate.rate_basis_points / 100}%）</option>)}
          </select>
        </label>
        <label className="toggle-field full">
          <input type="checkbox" checked={input.active} onChange={(event) => updateField('active', event.target.checked)} />
          <span><b>有効</b><small>停止するとレジ検索・商品ツリーから除外されます。過去の売上明細は変わりません。</small></span>
        </label>
      </div>
      {selectableCategories.length === 0 && <p className="form-error">先に、商品を登録する末端カテゴリを作成してください。</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <p>商品コードは手入力または自動採番です。削除しても、過去の売上・請求データは変わりません。</p>
        <div className="master-form-button-group">
          {product && onArchived && <button className="danger-button" type="button" disabled={saving || archiving} onClick={() => void handleArchive()}>{archiving ? '削除中…' : '商品を削除'}</button>}
          <button className="primary-button" type="submit" disabled={saving || archiving || selectableCategories.length === 0}>{saving ? '保存中…' : isNew ? '商品を登録' : '変更を保存'}</button>
        </div>
      </div>
    </form>
  );
}
