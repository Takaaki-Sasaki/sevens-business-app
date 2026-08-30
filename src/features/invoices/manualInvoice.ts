import { parseQuantity, parseYen, type TaxRoundingMode } from '../pos/cart';
import type { TaxRate } from '../products/types';
import type { ManualInvoiceLineInput } from './types';

export type CalculatedManualInvoiceLine = {
  line: ManualInvoiceLineInput;
  baseAmountYen: number;
  discountYen: number;
  taxAmountYen: number;
  totalAmountYen: number;
};

export type ManualInvoiceTotals = {
  lines: CalculatedManualInvoiceLine[];
  subtotalYen: number;
  discountYen: number;
  taxAmountYen: number;
  totalAmountYen: number;
};

function roundDivision(numerator: bigint, denominator: bigint, mode: TaxRoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === 'floor' || remainder === 0n) return quotient;
  if (mode === 'ceil') return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function createManualInvoiceLine(taxRateId = ''): ManualInvoiceLineInput {
  return { id: crypto.randomUUID(), productId: '', itemName: '', quantity: '1', unitPriceYen: '0', discountYen: '0', taxRateId };
}

export function calculateManualInvoice(lines: ManualInvoiceLineInput[], taxRates: TaxRate[], roundingMode: TaxRoundingMode): ManualInvoiceTotals {
  const calculated = lines.map((line) => {
    const quantityMilli = parseQuantity(line.quantity) || 0;
    const unitPriceYen = parseYen(line.unitPriceYen) || 0;
    const requestedDiscountYen = parseYen(line.discountYen) || 0;
    const taxRate = taxRates.find((rate) => rate.id === line.taxRateId);
    const baseAmountYen = Number(roundDivision(BigInt(unitPriceYen) * BigInt(quantityMilli), 1000n, roundingMode));
    const discountYen = Math.min(requestedDiscountYen, baseAmountYen);
    const taxableAmountYen = baseAmountYen - discountYen;
    const taxAmountYen = taxRate ? Number(roundDivision(BigInt(taxableAmountYen) * BigInt(taxRate.rate_basis_points), 10_000n, roundingMode)) : 0;
    return { line, baseAmountYen, discountYen, taxAmountYen, totalAmountYen: taxableAmountYen + taxAmountYen };
  });
  return calculated.reduce<ManualInvoiceTotals>((totals, line) => ({
    lines: [...totals.lines, line],
    subtotalYen: totals.subtotalYen + line.baseAmountYen,
    discountYen: totals.discountYen + line.discountYen,
    taxAmountYen: totals.taxAmountYen + line.taxAmountYen,
    totalAmountYen: totals.totalAmountYen + line.totalAmountYen,
  }), { lines: [], subtotalYen: 0, discountYen: 0, taxAmountYen: 0, totalAmountYen: 0 });
}

export function validateManualInvoice(input: { customerId?: string; billingMonth: string; dueDate: string; lines: ManualInvoiceLineInput[] }, taxRates: TaxRate[]): string | null {
  if (input.billingMonth && input.dueDate && input.dueDate < `${input.billingMonth}-01`) return '支払期限は請求月以降の日付を指定してください。';
  if (input.lines.length === 0) return '請求明細を1件以上入力してください。';
  for (const [index, line] of input.lines.entries()) {
    if (!line.itemName.trim()) return `明細${index + 1}の内容を入力してください。`;
    if (parseQuantity(line.quantity) === null) return `明細${index + 1}の数量を確認してください。`;
    if (parseYen(line.unitPriceYen) === null) return `明細${index + 1}の単価を確認してください。`;
    if (parseYen(line.discountYen) === null) return `明細${index + 1}の割引を確認してください。`;
    if (!taxRates.some((rate) => rate.id === line.taxRateId)) return `明細${index + 1}の税率を選択してください。`;
  }
  return null;
}
