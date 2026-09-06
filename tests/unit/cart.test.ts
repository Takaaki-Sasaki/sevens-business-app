import { describe, expect, it } from 'vitest';
import { addProductToCart, calculateCart, calculateCashSettlement, calculateLine, calculateOrderDiscount, createCartLine, formatQuantity, parseDiscountRateBasisPoints, parseQuantity, type CartLine } from '../../src/features/pos/cart';
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

  it('会計全体の金額割引を税計算後合計から差し引く', () => {
    const discounted = calculateOrderDiscount(10_000, '1,000', '', 'round');
    expect(discounted).toMatchObject({
      type: 'amount', input_amount_yen: 1000, rate_basis_points: null,
      discount_amount_yen: 1000, total_amount_yen: 9000, error: null,
    });
    expect(calculateCashSettlement(discounted.total_amount_yen, 10_000)).toEqual({ change_yen: 1000, shortfall_yen: 0 });
  });

  it('会計全体の割合割引を既存の端数設定で整数円に丸める', () => {
    expect(calculateOrderDiscount(10_000, '', '10', 'round')).toMatchObject({ type: 'rate', rate_basis_points: 1000, discount_amount_yen: 1000, total_amount_yen: 9000 });
    expect(calculateOrderDiscount(105, '', '5.5', 'floor').discount_amount_yen).toBe(5);
    expect(calculateOrderDiscount(105, '', '5.5', 'round').discount_amount_yen).toBe(6);
    expect(calculateOrderDiscount(105, '', '5.5', 'ceil').discount_amount_yen).toBe(6);
  });

  it('割引なし、100%割引、割引入力エラーを区別する', () => {
    expect(calculateOrderDiscount(10_000, '', '', 'round')).toMatchObject({ type: 'none', discount_amount_yen: 0, total_amount_yen: 10_000, error: null });
    expect(calculateOrderDiscount(10_000, '', '100', 'round')).toMatchObject({ discount_amount_yen: 10_000, total_amount_yen: 0, error: null });
    expect(calculateOrderDiscount(10_000, '1000', '10', 'round').error).toContain('同時');
    expect(calculateOrderDiscount(10_000, '15000', '', 'round').error).toContain('以下');
    expect(calculateOrderDiscount(10_000, '', '101', 'round').error).toContain('0〜100');
    expect(parseDiscountRateBasisPoints('5.5')).toBe(550);
  });

  it('同じ商品を続けて追加すると数量を加算する', () => {
    const first = addProductToCart([], product, taxRate);
    const second = addProductToCart(first, product, taxRate);
    expect(second).toHaveLength(1);
    expect(second[0].quantity_milli).toBe(2000);
  });
});
