import { describe, expect, it } from 'vitest';
import { calculateManualInvoice, createManualInvoiceLine, validateManualInvoice } from '../../src/features/invoices/manualInvoice';
import type { TaxRate } from '../../src/features/products/types';

const taxRate: TaxRate = { id: 'tax-10', name: '標準税率', rate_basis_points: 1000, active: true, sort_order: 10 };

describe('手動請求の金額計算', () => {
  it('数量・割引・税率から請求額を整数円で計算する', () => {
    const line = { ...createManualInvoiceLine(taxRate.id), itemName: 'オイル交換', quantity: '2.5', unitPriceYen: '1200', discountYen: '200' };
    const totals = calculateManualInvoice([line], [taxRate], 'round');
    expect(totals).toMatchObject({ subtotalYen: 3000, discountYen: 200, taxAmountYen: 280, totalAmountYen: 3080 });
  });

  it('税率・期限を検証し、顧客と請求月が未入力でも登録を許可する', () => {
    const line = { ...createManualInvoiceLine(taxRate.id), itemName: '整備作業', quantity: '1', unitPriceYen: '1000', discountYen: '0' };
    expect(validateManualInvoice({ customerId: '', billingMonth: '', dueDate: '', lines: [line] }, [taxRate])).toBeNull();
    expect(validateManualInvoice({ customerId: 'customer', billingMonth: '2026-08', dueDate: '2026-07-31', lines: [line] }, [taxRate])).toContain('支払期限');
    expect(validateManualInvoice({ customerId: 'customer', billingMonth: '', dueDate: '', lines: [line] }, [taxRate])).toBeNull();
    expect(validateManualInvoice({ customerId: 'customer', billingMonth: '2026-08', dueDate: '2026-08-31', lines: [line] }, [taxRate])).toBeNull();
  });
});
