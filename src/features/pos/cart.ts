import type { Product, TaxRate } from '../products/types';

export type TaxRoundingMode = 'floor' | 'round' | 'ceil';

export type CartLine = {
  id: string;
  line_kind: 'catalog' | 'custom';
  product: Product;
  quantity_milli: number;
  unit_price_yen: number;
  discount_yen: number;
  tax_rate_id: string;
  tax_rate_name: string;
  tax_rate_basis_points: number;
};

export type CalculatedCartLine = CartLine & {
  base_amount_yen: number;
  taxable_amount_yen: number;
  tax_amount_yen: number;
  total_amount_yen: number;
};

export type CartTotals = {
  lines: CalculatedCartLine[];
  subtotal_yen: number;
  discount_yen: number;
  taxable_amount_yen: number;
  tax_amount_yen: number;
  total_amount_yen: number;
};

export type OrderDiscountType = 'none' | 'amount' | 'rate';

export type OrderDiscountCalculation = {
  type: OrderDiscountType;
  input_amount_yen: number | null;
  rate_basis_points: number | null;
  pre_discount_total_yen: number;
  discount_amount_yen: number;
  total_amount_yen: number;
  error: string | null;
};

const QUANTITY_SCALE = 1000;
const MAX_QUANTITY_MILLI = 9_999_999;
const MAX_MONEY_YEN = 99_999_999;

function assertSafeYen(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_YEN) {
    throw new Error('金額は0〜99,999,999円で入力してください。');
  }
  return value;
}

function toSafeYen(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('計算結果が扱える金額の上限を超えています。');
  }
  return Number(value);
}

function roundDivision(numerator: bigint, denominator: bigint, mode: TaxRoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === 'floor' || remainder === 0n) return quotient;
  if (mode === 'ceil') return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function parseDiscountRateBasisPoints(value: string): number | null {
  const normalized = value.replace(/[%％\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [integerPart, decimalPart = ''] = normalized.split('.');
  const basisPoints = Number(integerPart) * 100 + Number((decimalPart + '00').slice(0, 2));
  return Number.isSafeInteger(basisPoints) && basisPoints >= 0 && basisPoints <= 10_000 ? basisPoints : null;
}

export function formatDiscountRate(rateBasisPoints: number): string {
  const integerPart = Math.floor(rateBasisPoints / 100);
  const decimalPart = String(rateBasisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : String(integerPart);
}

/** 税計算後の会計合計に、金額または割合のどちらか一方の割引を適用する。 */
export function calculateOrderDiscount(
  preDiscountTotalYen: number,
  amountInput: string,
  rateInput: string,
  roundingMode: TaxRoundingMode,
): OrderDiscountCalculation {
  const amountText = amountInput.trim();
  const rateText = rateInput.trim();
  const base = assertSafeYen(preDiscountTotalYen);
  const none = (error: string | null = null): OrderDiscountCalculation => ({
    type: 'none', input_amount_yen: null, rate_basis_points: null,
    pre_discount_total_yen: base, discount_amount_yen: 0, total_amount_yen: base, error,
  });

  if (amountText && rateText) return none('割引金額と割引率は同時に入力できません。');
  if (!amountText && !rateText) return none();

  if (amountText) {
    const amountYen = parseYen(amountText);
    if (amountYen === null) return none('割引金額は0〜99,999,999円の整数で入力してください。');
    if (amountYen > base) return none('割引金額は割引前合計以下で入力してください。');
    return {
      type: 'amount', input_amount_yen: amountYen, rate_basis_points: null,
      pre_discount_total_yen: base, discount_amount_yen: amountYen,
      total_amount_yen: base - amountYen, error: null,
    };
  }

  const rateBasisPoints = parseDiscountRateBasisPoints(rateText);
  if (rateBasisPoints === null) return none('割引率は0〜100%（小数第2位まで）で入力してください。');
  const discountAmountYen = toSafeYen(roundDivision(BigInt(base) * BigInt(rateBasisPoints), 10_000n, roundingMode));
  return {
    type: 'rate', input_amount_yen: null, rate_basis_points: rateBasisPoints,
    pre_discount_total_yen: base, discount_amount_yen: discountAmountYen,
    total_amount_yen: base - discountAmountYen, error: null,
  };
}

export function parseQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{0,3})?$/.test(trimmed)) return null;
  const [integerPart, decimalPart = ''] = trimmed.split('.');
  const milli = Number(integerPart) * QUANTITY_SCALE + Number((decimalPart + '000').slice(0, 3));
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > MAX_QUANTITY_MILLI) return null;
  return milli;
}

export function formatQuantity(quantityMilli: number): string {
  const integerPart = Math.floor(quantityMilli / QUANTITY_SCALE);
  const decimalPart = String(quantityMilli % QUANTITY_SCALE).padStart(3, '0').replace(/0+$/, '');
  return decimalPart ? `${integerPart}.${decimalPart}` : String(integerPart);
}

export function parseYen(value: string): number | null {
  const normalized = value.replace(/[,，\s円]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  try {
    return assertSafeYen(parsed);
  } catch {
    return null;
  }
}

export function createCartLine(product: Product, taxRate: TaxRate): CartLine {
  return {
    id: product.id,
    line_kind: 'catalog',
    product,
    quantity_milli: QUANTITY_SCALE,
    unit_price_yen: product.price_yen,
    discount_yen: 0,
    tax_rate_id: taxRate.id,
    tax_rate_name: taxRate.name,
    tax_rate_basis_points: taxRate.rate_basis_points,
  };
}

export function createCustomCartLine(input: {
  id: string;
  name: string;
  unit_price_yen: number;
  taxRate: TaxRate;
}): CartLine {
  const name = input.name.trim();
  if (!name || name.length > 250) {
    throw new Error('その他の内容は1〜250文字で入力してください。');
  }
  const unitPriceYen = assertSafeYen(input.unit_price_yen);
  return {
    id: input.id,
    line_kind: 'custom',
    product: {
      id: input.id,
      organization_id: '',
      product_code: 'OTHER',
      name,
      category_id: '',
      tax_rate_id: input.taxRate.id,
      price_yen: unitPriceYen,
      active: true,
      sort_order: 0,
      deleted_at: null,
      created_at: '',
      updated_at: '',
    },
    quantity_milli: QUANTITY_SCALE,
    unit_price_yen: unitPriceYen,
    discount_yen: 0,
    tax_rate_id: input.taxRate.id,
    tax_rate_name: input.taxRate.name,
    tax_rate_basis_points: input.taxRate.rate_basis_points,
  };
}

export function addProductToCart(lines: CartLine[], product: Product, taxRate: TaxRate): CartLine[] {
  const current = lines.find((line) => line.line_kind === 'catalog' && line.product.id === product.id);
  if (!current) return [...lines, createCartLine(product, taxRate)];
  return lines.map((line) => line.id === current.id
    ? { ...line, quantity_milli: Math.min(MAX_QUANTITY_MILLI, line.quantity_milli + QUANTITY_SCALE) }
    : line);
}

export function updateCartLine(lines: CartLine[], lineId: string, patch: Partial<Pick<CartLine, 'quantity_milli' | 'unit_price_yen' | 'discount_yen'>>): CartLine[] {
  return lines.map((line) => {
    if (line.id !== lineId) return line;
    const next = { ...line, ...patch };
    return {
      ...next,
      quantity_milli: Math.max(1, Math.min(MAX_QUANTITY_MILLI, next.quantity_milli)),
      unit_price_yen: assertSafeYen(next.unit_price_yen),
      discount_yen: assertSafeYen(next.discount_yen),
    };
  });
}

export function calculateLine(line: CartLine, roundingMode: TaxRoundingMode): CalculatedCartLine {
  const baseAmount = toSafeYen(roundDivision(BigInt(line.unit_price_yen) * BigInt(line.quantity_milli), BigInt(QUANTITY_SCALE), roundingMode));
  const discount = Math.min(line.discount_yen, baseAmount);
  const taxableAmount = baseAmount - discount;
  const taxAmount = toSafeYen(roundDivision(BigInt(taxableAmount) * BigInt(line.tax_rate_basis_points), 10_000n, roundingMode));
  return {
    ...line,
    discount_yen: discount,
    base_amount_yen: baseAmount,
    taxable_amount_yen: taxableAmount,
    tax_amount_yen: taxAmount,
    total_amount_yen: taxableAmount + taxAmount,
  };
}

export function calculateCart(lines: CartLine[], roundingMode: TaxRoundingMode): CartTotals {
  const calculatedLines = lines.map((line) => calculateLine(line, roundingMode));
  return calculatedLines.reduce<CartTotals>((totals, line) => ({
    lines: [...totals.lines, line],
    subtotal_yen: totals.subtotal_yen + line.base_amount_yen,
    discount_yen: totals.discount_yen + line.discount_yen,
    taxable_amount_yen: totals.taxable_amount_yen + line.taxable_amount_yen,
    tax_amount_yen: totals.tax_amount_yen + line.tax_amount_yen,
    total_amount_yen: totals.total_amount_yen + line.total_amount_yen,
  }), { lines: [], subtotal_yen: 0, discount_yen: 0, taxable_amount_yen: 0, tax_amount_yen: 0, total_amount_yen: 0 });
}

export function calculateCashSettlement(totalAmountYen: number, amountReceivedYen: number): { change_yen: number; shortfall_yen: number } {
  return {
    change_yen: Math.max(0, amountReceivedYen - totalAmountYen),
    shortfall_yen: Math.max(0, totalAmountYen - amountReceivedYen),
  };
}
