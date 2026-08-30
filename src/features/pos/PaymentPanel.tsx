import { calculateCashSettlement, parseYen, type CartTotals } from './cart';
import type { PaymentMethod } from '../products/types';

type PaymentPanelProps = {
  methods: PaymentMethod[];
  selectedMethodId: string;
  onMethodChange: (methodId: string) => void;
  amountReceivedInput: string;
  onAmountReceivedChange: (value: string) => void;
  totals: CartTotals;
  onCheckout: () => void;
  checkoutPending: boolean;
  checkoutDisabled: boolean;
};

export function PaymentPanel({ methods, selectedMethodId, onMethodChange, amountReceivedInput, onAmountReceivedChange, totals, onCheckout, checkoutPending, checkoutDisabled }: PaymentPanelProps) {
  const selectedMethod = methods.find((method) => method.id === selectedMethodId);
  const isCash = selectedMethod?.code === 'cash';
  const amountReceivedYen = parseYen(amountReceivedInput) || 0;
  const settlement = calculateCashSettlement(totals.total_amount_yen, amountReceivedYen);

  return (
    <section className="pos-payment" aria-labelledby="payment-title">
      <div className="pos-section-heading">
        <div>
          <p className="eyebrow">PAYMENT</p>
          <h2 id="payment-title">支払方法</h2>
        </div>
      </div>
      <div className="payment-methods">
        {methods.length === 0 && <p className="compact-message">有効な支払方法がありません。</p>}
        {methods.map((method) => (
          <label key={method.id} className={method.id === selectedMethodId ? 'payment-method selected' : 'payment-method'}>
            <input type="radio" name="payment-method" value={method.id} checked={method.id === selectedMethodId} onChange={() => onMethodChange(method.id)} />
            <span>{method.name}</span>
          </label>
        ))}
      </div>
      {isCash && (
        <div className="cash-settlement">
          <label className="field">
            <span>預かり金（円）</span>
            <input inputMode="numeric" placeholder="0" value={amountReceivedInput} onChange={(event) => onAmountReceivedChange(event.target.value)} />
          </label>
          <div className="cash-result">
            <span>お釣り</span>
            <strong>¥{settlement.change_yen.toLocaleString()}</strong>
            {settlement.shortfall_yen > 0 && <small>不足 ¥{settlement.shortfall_yen.toLocaleString()}</small>}
          </div>
        </div>
      )}
      {selectedMethod && <p className="payment-note">会計確定と同時に請求データを自動作成します。顧客の選択は任意です。</p>}
      <div className="checkout-preview">
        <span>今回の会計金額</span>
        <strong>¥{totals.total_amount_yen.toLocaleString()}</strong>
        <button type="button" className="checkout-button" onClick={onCheckout} disabled={checkoutDisabled || checkoutPending}>
          {checkoutPending ? '会計を確定中…' : '会計を確定'}
        </button>
        {checkoutDisabled && !checkoutPending && <small>商品・支払方法{isCash ? '・不足のない預かり金' : ''}を確認してください。</small>}
      </div>
    </section>
  );
}
