import { calculateCashSettlement, formatDiscountRate, parseYen, type OrderDiscountCalculation } from './cart';
import type { PaymentMethod } from '../products/types';

type PaymentPanelProps = {
  methods: PaymentMethod[];
  selectedMethodId: string;
  onMethodChange: (methodId: string) => void;
  amountReceivedInput: string;
  onAmountReceivedChange: (value: string) => void;
  discountAmountInput: string;
  discountRateInput: string;
  onDiscountAmountChange: (value: string) => void;
  onDiscountRateChange: (value: string) => void;
  orderDiscount: OrderDiscountCalculation;
  onCheckout: () => void;
  checkoutPending: boolean;
  checkoutDisabled: boolean;
};

export function PaymentPanel({
  methods, selectedMethodId, onMethodChange, amountReceivedInput, onAmountReceivedChange,
  discountAmountInput, discountRateInput, onDiscountAmountChange, onDiscountRateChange, orderDiscount,
  onCheckout, checkoutPending, checkoutDisabled,
}: PaymentPanelProps) {
  const selectedMethod = methods.find((method) => method.id === selectedMethodId);
  const isCash = selectedMethod?.code === 'cash';
  const amountReceivedYen = parseYen(amountReceivedInput) ?? 0;
  const settlement = calculateCashSettlement(orderDiscount.total_amount_yen, amountReceivedYen);

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
      <section className="order-discount" aria-labelledby="order-discount-title">
        <div className="order-discount-heading">
          <strong id="order-discount-title">会計全体の割引</strong>
          <small>金額・率のどちらか一方を入力</small>
        </div>
        <div className="order-discount-fields">
          <label className="field">
            <span>割引金額（円）</span>
            <input
              inputMode="numeric"
              maxLength={15}
              placeholder="例：1000"
              value={discountAmountInput}
              disabled={discountRateInput.trim() !== ''}
              aria-invalid={!!orderDiscount.error}
              aria-describedby={orderDiscount.error ? 'order-discount-error' : undefined}
              onChange={(event) => onDiscountAmountChange(event.target.value)}
            />
          </label>
          <label className="field">
            <span>割引率（%）</span>
            <input
              inputMode="decimal"
              maxLength={6}
              placeholder="例：10"
              value={discountRateInput}
              disabled={discountAmountInput.trim() !== ''}
              aria-invalid={!!orderDiscount.error}
              aria-describedby={orderDiscount.error ? 'order-discount-error' : undefined}
              onChange={(event) => onDiscountRateChange(event.target.value)}
            />
          </label>
        </div>
        {orderDiscount.error ? <p className="field-error" id="order-discount-error" role="alert">{orderDiscount.error}</p> : (
          <p className="order-discount-result">
            {orderDiscount.type === 'rate' && orderDiscount.rate_basis_points !== null
              ? `割引率 ${formatDiscountRate(orderDiscount.rate_basis_points)}%：`
              : '適用する割引：'}
            <strong>{orderDiscount.discount_amount_yen ? `−¥${orderDiscount.discount_amount_yen.toLocaleString()}` : '¥0'}</strong>
          </p>
        )}
      </section>
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
        <strong>¥{orderDiscount.total_amount_yen.toLocaleString()}</strong>
        <button type="button" className="checkout-button" onClick={onCheckout} disabled={checkoutDisabled || checkoutPending}>
          {checkoutPending ? '会計を確定中…' : '会計を確定'}
        </button>
        {checkoutDisabled && !checkoutPending && <small>商品・支払方法{isCash ? '・不足のない預かり金' : ''}を確認してください。</small>}
      </div>
    </section>
  );
}
