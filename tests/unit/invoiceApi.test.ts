import { describe, expect, it } from 'vitest';
import { createInvoicePayload } from '../../src/features/invoices/invoiceApi';
import { createCheckoutPayload } from '../../src/features/sales/saleApi';
import type { CartLine } from '../../src/features/pos/cart';
import type { Product } from '../../src/features/products/types';

const product: Product = {
  id: '0af7b6d8-3d91-4a45-a55b-270c1d48f599', organization_id: 'org', product_code: 'P001', name: 'タイヤ交換', category_id: 'tire', tax_rate_id: 'tax', price_yen: 1800, active: true, sort_order: 10, deleted_at: null, created_at: '', updated_at: '',
};

const line: CartLine = {
  id: product.id, product, quantity_milli: 1000, unit_price_yen: 1800, discount_yen: 0,
  tax_rate_id: 'tax', tax_rate_name: '標準税率', tax_rate_basis_points: 1000,
};

describe('売上から請求への変換リクエスト', () => {
  it('売上IDと請求条件をRPC用の形式にする', () => {
    expect(createInvoicePayload({
      saleId: '2ef600e2-1869-46f4-8cbf-e413e570e769',
      subject: '  8月分整備代  ', billingMonth: '2026-08-01', dueDate: '2026-08-31',
    })).toEqual({
      p_sale_id: '2ef600e2-1869-46f4-8cbf-e413e570e769',
      p_subject: '8月分整備代', p_billing_month: '2026-08-01', p_due_date: '2026-08-31',
    });
  });

  it('会計時に請求作成を指定でき、未指定時は作成しない', () => {
    const base = { idempotencyKey: '34d4bd6c-747f-43ef-a1c5-12e146326aff', paymentMethodId: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8', lines: [line] };
    expect(createCheckoutPayload(base).p_create_invoice).toBe(false);
    expect(createCheckoutPayload({ ...base, createInvoice: true }).p_create_invoice).toBe(true);
  });
});
