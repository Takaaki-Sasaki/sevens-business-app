import { useEffect, useState } from 'react';
import { formatQuantity, parseQuantity, parseYen, type CartLine, type CartTotals } from './cart';

type CartPanelProps = {
  totals: CartTotals;
  allowPriceOverride: boolean;
  onUpdate: (lineId: string, patch: Partial<Pick<CartLine, 'quantity_milli' | 'unit_price_yen' | 'discount_yen'>>) => void;
  onRemove: (lineId: string) => void;
  onClear: () => void;
};

export function CartPanel({ totals, allowPriceOverride, onUpdate, onRemove, onClear }: CartPanelProps) {
  return (
    <section className="pos-cart" id="selected-items" aria-labelledby="cart-title">
      <div className="pos-section-heading">
        <div>
          <p className="eyebrow">CART</p>
          <h2 id="cart-title">会計内容</h2>
        </div>
        {totals.lines.length > 0 && <button type="button" className="text-button" onClick={onClear}>すべて削除</button>}
      </div>
      {totals.lines.length === 0 ? <p className="customer-hint">中央の商品を押すと、ここへ追加されます。</p> : (
        <div className="cart-line-list">
          {totals.lines.map((line) => (
            <article className="cart-line" key={line.id}>
              <div className="cart-line-heading">
                <div>
                  <strong>{line.product.name}</strong>
                  <p>{line.product.product_code} ・ {line.tax_rate_name}（{line.tax_rate_basis_points / 100}%）</p>
                </div>
                <button type="button" className="danger-button" onClick={() => onRemove(line.id)}>削除</button>
              </div>
              <div className="cart-line-inputs">
                <label>
                  <span>数量</span>
                  <QuantityInput value={line.quantity_milli} onCommit={(value) => onUpdate(line.id, { quantity_milli: value })} />
                </label>
                <label>
                  <span>単価（円）</span>
                  <YenInput value={line.unit_price_yen} disabled={!allowPriceOverride} title={allowPriceOverride ? '単価を変更できます' : '単価変更は管理者のみ可能です'} onCommit={(value) => onUpdate(line.id, { unit_price_yen: value })} />
                </label>
                <label>
                  <span>割引（円）</span>
                  <YenInput value={line.discount_yen} onCommit={(value) => onUpdate(line.id, { discount_yen: value })} />
                </label>
              </div>
              <div className="cart-line-calculation">
                <span>小計 ¥{line.base_amount_yen.toLocaleString()}</span>
                <span>税 ¥{line.tax_amount_yen.toLocaleString()}</span>
                <strong>¥{line.total_amount_yen.toLocaleString()}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="cart-totals">
        <div><span>小計</span><strong>¥{totals.subtotal_yen.toLocaleString()}</strong></div>
        <div><span>割引</span><strong>− ¥{totals.discount_yen.toLocaleString()}</strong></div>
        <div><span>消費税</span><strong>¥{totals.tax_amount_yen.toLocaleString()}</strong></div>
        <div className="cart-grand-total"><span>合計</span><strong>¥{totals.total_amount_yen.toLocaleString()}</strong></div>
      </div>
      {!allowPriceOverride && totals.lines.length > 0 && <p className="permission-note">単価変更は管理者のみ可能です。</p>}
    </section>
  );
}

function QuantityInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const formatted = formatQuantity(value);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  function commit() {
    const parsed = parseQuantity(draft);
    if (parsed === null) setDraft(formatted);
    else onCommit(parsed);
  }
  return <input inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} />;
}

function YenInput({ value, onCommit, disabled = false, title }: { value: number; onCommit: (value: number) => void; disabled?: boolean; title?: string }) {
  const formatted = String(value);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  function commit() {
    const parsed = parseYen(draft);
    if (parsed === null) setDraft(formatted);
    else onCommit(parsed);
  }
  return <input inputMode="numeric" value={draft} disabled={disabled} title={title} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} />;
}
