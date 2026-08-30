import { describe, expect, it } from 'vitest';
import { createInvoicePayload, createManualInvoicePayload, updateManualInvoicePayload } from '../../src/features/invoices/invoiceApi';
import { createCheckoutPayload } from '../../src/features/sales/saleApi';
import type { CartLine } from '../../src/features/pos/cart';
import type { Product } from '../../src/features/products/types';

const product: Product = {
  id: '0af7b6d8-3d91-4a45-a55b-270c1d48f599', organization_id: 'org', product_code: 'P001', name: 'タイヤ交換', category_id: 'tire', tax_rate_id: 'tax', price_yen: 1800, active: true, sort_order: 10, deleted_at: null, created_at: '', updated_at: '',
};

const line: CartLine = {
  id: product.id, line_kind: 'catalog', product, quantity_milli: 1000, unit_price_yen: 1800, discount_yen: 0,
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

  it('支払方法にかかわらず会計時の請求自動作成を指定する', () => {
    const base = { idempotencyKey: '34d4bd6c-747f-43ef-a1c5-12e146326aff', paymentMethodId: '4f9d5ac3-976c-4b10-a97c-0d0f60e351f8', lines: [line] };
    expect(createCheckoutPayload(base).p_create_invoice).toBe(true);
  });

  it('手動請求は請求月未入力をNULLとして送り、商品選択は任意で保存する', () => {
    const input = {
      idempotencyKey: 'cc9f9d4b-75c5-4f35-a6d7-67b2e35b5c1d',
      customerId: '49dc4a3b-67ae-4b1b-9ce7-88d7a46cf6f7',
      subject: '  臨時作業費  ',
      billingMonth: '',
      dueDate: '',
      lines: [{ id: 'line-1', productId: product.id, itemName: '任意の摘要', quantity: '1', unitPriceYen: '2500', discountYen: '100', taxRateId: 'tax' }],
    };
    expect(createManualInvoicePayload(input)).toMatchObject({
      p_billing_month: null,
      p_due_date: null,
      p_subject: '臨時作業費',
      p_lines: [{ product_id: product.id, item_name: '任意の摘要', quantity_milli: 1000, unit_price_yen: 2500, discount_yen: 100, tax_rate_id: 'tax' }],
    });
    expect(updateManualInvoicePayload({ ...input, invoiceId: 'f8ad958d-7c61-43ea-aaf3-b0881ef7fc9e' })).toMatchObject({
      p_invoice_id: 'f8ad958d-7c61-43ea-aaf3-b0881ef7fc9e',
      p_billing_month: null,
      p_lines: [{ product_id: product.id, item_name: '任意の摘要' }],
    });
  });

  it('手動請求は顧客未選択をNULLとして送信する', () => {
    const input = {
      idempotencyKey: 'af13e7b8-aee7-48ac-b4da-3dca36ad29ec',
      customerId: undefined,
      subject: '一般請求',
      billingMonth: '',
      dueDate: '',
      lines: [{ id: 'line-1', productId: '', itemName: '臨時作業', quantity: '1', unitPriceYen: '1000', discountYen: '0', taxRateId: 'tax' }],
    };
    expect(createManualInvoicePayload(input).p_customer_id).toBeNull();
    expect(updateManualInvoicePayload({ ...input, invoiceId: 'f8ad958d-7c61-43ea-aaf3-b0881ef7fc9e' }).p_customer_id).toBeNull();
  });
});
