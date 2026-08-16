import { useState, type FormEvent } from 'react';
import { parseYen } from './cart';
import type { TaxRate } from '../products/types';

type OtherItemFormProps = {
  taxRates: TaxRate[];
  onAdd: (input: { name: string; unitPriceYen: number; taxRate: TaxRate }) => void;
  onClose: () => void;
};

export function OtherItemForm({ taxRates, onAdd, onClose }: OtherItemFormProps) {
  const [name, setName] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [taxRateId, setTaxRateId] = useState(taxRates[0]?.id || '');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    const unitPriceYen = parseYen(unitPrice);
    const taxRate = taxRates.find((item) => item.id === taxRateId);
    if (!normalizedName) {
      setError('内容（商品名・作業名）を入力してください。');
      return;
    }
    if (normalizedName.length > 250) {
      setError('内容は250文字以内で入力してください。');
      return;
    }
    if (unitPriceYen === null || unitPriceYen <= 0) {
      setError('単価は1〜99,999,999円で入力してください。');
      return;
    }
    if (!taxRate) {
      setError('税率を選択してください。');
      return;
    }
    onAdd({ name: normalizedName, unitPriceYen, taxRate });
  }

  return (
    <form className="other-item-form" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">OTHER ITEM</p>
          <h2 id="other-item-title">その他を追加</h2>
        </div>
        <button type="button" className="modal-close" onClick={onClose} aria-label="その他の入力を閉じる">×</button>
      </div>
      <p className="other-item-description">商品マスタにない作業・商品を、その会計だけに追加します。</p>
      <div className="form-grid">
        <label className="field full">
          <span>内容（商品名・作業名） <b>必須</b></span>
          <input value={name} maxLength={250} autoFocus placeholder="例：緊急対応作業" onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>単価（税抜・円） <b>必須</b></span>
          <input inputMode="numeric" value={unitPrice} placeholder="0" onChange={(event) => setUnitPrice(event.target.value)} />
        </label>
        <label className="field">
          <span>税率 <b>必須</b></span>
          <select value={taxRateId} onChange={(event) => setTaxRateId(event.target.value)}>
            <option value="">税率を選択</option>
            {taxRates.map((taxRate) => <option key={taxRate.id} value={taxRate.id}>{taxRate.name}（{taxRate.rate_basis_points / 100}%）</option>)}
          </select>
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="other-item-note">追加後、カートで数量・割引を変更できます。売上履歴と請求には「その他」と内容を残します。</p>
      <div className="form-actions">
        <button type="button" className="text-button" onClick={onClose}>キャンセル</button>
        <button type="submit" className="primary-button" disabled={taxRates.length === 0}>カートに追加</button>
      </div>
    </form>
  );
}
