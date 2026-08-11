import { describe, expect, it } from 'vitest';
import { createCheckoutPayload } from '../../src/features/sales/saleApi';
import type { CartLine } from '../../src/features/pos/cart';
import type { Product } from '../../src/features/products/types';

const product: Product = {
  id: '0af7b6d8-3d91-4a45-a55b-270c1d48f599', organization_id: 'org', product_code: 'P001', name: 'タイヤ交換', category_id: 'tire', tax_rate_id: 'tax', price_yen: 1800, active: true, sort_order: 10, deleted_at: null, created_at: '', updated_at: '',
};

const line: CartLine = {
  id: product.id, product, quantity_milli: 2500, unit_price_yen: 1800, discount_yen: 100,
  tax_rate_id: 'tax', tax_rate_name: '標準税率', tax_rate_basis_points: 1000,
};

describe('売上確定リクエスト', () => {
  it('会計用の再送キーと、金額計算に必要な最小の明細だけを送信する', () => {
    const payload = createCheckoutPayload({
      idempotencyKey: '34d4bd6c-747f-43ef-a1c5-12e146326aff',
      customerId: '4acbd841-ddc1-4b53-a724-00b515646605',
      vehicleId: '955a9bfa-b777-4ebc-889a-f17fb508e5c4',
      paymentMethodId: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8',
      amountReceivedYen: 5000,
      lines: [line],
    });

    expect(payload).toMatchObject({
      p_idempotency_key: '34d4bd6c-747f-43ef-a1c5-12e146326aff',
      p_customer_id: '4acbd841-ddc1-4b53-a724-00b515646605',
      p_vehicle_id: '955a9bfa-b777-4ebc-889a-f17fb508e5c4',
      p_payment_method_id: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8',
      p_amount_received_yen: 5000,
      p_lines: [{ product_id: product.id, quantity_milli: 2500, unit_price_yen: 1800, discount_yen: 100 }],
    });
    expect(payload.p_sale_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.p_lines[0]).not.toHaveProperty('product_name');
    expect(payload.p_lines[0]).not.toHaveProperty('tax_rate_basis_points');
  });

  it('未指定の顧客・車両・預かり金をnullで明示する', () => {
    const payload = createCheckoutPayload({
      idempotencyKey: '06e9f9f5-9f4b-4caf-b77d-4bf671eae57e',
      paymentMethodId: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8',
      lines: [line],
    });
    expect(payload.p_customer_id).toBeNull();
    expect(payload.p_vehicle_id).toBeNull();
    expect(payload.p_amount_received_yen).toBeNull();
  });

  it('通信を再試行しても同じ会計キーを維持する', () => {
    const input = {
      idempotencyKey: 'a167dd1d-cd3d-438a-87c2-2d07cf1388b4',
      paymentMethodId: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8',
      lines: [line],
    };
    const first = createCheckoutPayload(input);
    const retry = createCheckoutPayload(input);
    expect(retry.p_idempotency_key).toBe(first.p_idempotency_key);
    expect(retry.p_lines).toEqual(first.p_lines);
  });
});
