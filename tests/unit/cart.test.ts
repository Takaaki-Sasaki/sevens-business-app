import { describe, expect, it } from 'vitest';
import { addProductToCart, calculateCart, calculateCashSettlement, calculateLine, createCartLine, formatQuantity, parseQuantity, type CartLine } from '../../src/features/pos/cart';
import type { Product, TaxRate } from '../../src/features/products/types';

const product: Product = {
  id: 'product-1', organization_id: 'org', product_code: 'P001', name: 'オイル交換', category_id: 'oil', tax_rate_id: 'tax-10', price_yen: 1000, active: true, sort_order: 10, deleted_at: null, created_at: '', updated_at: '',
};
const taxRate: TaxRate = { id: 'tax-10', name: '標準税率', rate_basis_points: 1000, active: true, sort_order: 10 };

describe('レジ金額計算', () => {
  it('数量・割引・消費税から小計と合計を整数円で計算する', () => {
    const line: CartLine = { ...createCartLine(product, taxRate), quantity_milli: 2000, discount_yen: 100 };
    const totals = calculateCart([line], 'round');
    expect(totals).toMatchObject({ subtotal_yen: 2000, discount_yen: 100, taxable_amount_yen: 1900, tax_amount_yen: 190, total_amount_yen: 2090 });
  });

  it('小数数量を1000分の1単位として扱う', () => {
    expect(parseQuantity('1.5')).toBe(1500);
    expect(formatQuantity(1250)).toBe('1.25');
    const line: CartLine = { ...createCartLine(product, taxRate), quantity_milli: 1500 };
    expect(calculateLine(line, 'round')).toMatchObject({ base_amount_yen: 1500, tax_amount_yen: 150, total_amount_yen: 1650 });
  });

  it('税の端数処理を設定値に従って計算する', () => {
    const line: CartLine = { ...createCartLine({ ...product, price_yen: 15 }, taxRate), quantity_milli: 1000 };
    expect(calculateLine(line, 'floor').tax_amount_yen).toBe(1);
    expect(calculateLine(line, 'round').tax_amount_yen).toBe(2);
    expect(calculateLine(line, 'ceil').tax_amount_yen).toBe(2);
  });

  it('現金の預かり金からお釣りと不足額を算出する', () => {
    expect(calculateCashSettlement(1200, 2000)).toEqual({ change_yen: 800, shortfall_yen: 0 });
    expect(calculateCashSettlement(1200, 1000)).toEqual({ change_yen: 0, shortfall_yen: 200 });
  });

  it('同じ商品を続けて追加すると数量を加算する', () => {
    const first = addProductToCart([], product, taxRate);
    const second = addProductToCart(first, product, taxRate);
    expect(second).toHaveLength(1);
    expect(second[0].quantity_milli).toBe(2000);
  });
});
