export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'cancelled';

export type InvoiceLink = {
  invoice_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  source_sale_id?: string;
  already_exists?: boolean;
};

export type CreateInvoiceFromSaleInput = {
  saleId: string;
  subject?: string;
  billingMonth?: string;
  dueDate?: string;
};

export type Invoice = {
  id: string;
  organization_id: string;
  invoice_number: string;
  source_sale_id: string | null;
  customer_id: string;
  customer_name_snapshot: string;
  subject: string | null;
  billing_month: string | null;
  due_date: string | null;
  subtotal_yen: number;
  tax_amount_yen: number;
  total_amount_yen: number;
  status: InvoiceStatus;
  issued_at: string | null;
  issued_by: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  deleted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  source_sale_item_id: string | null;
  item_name_snapshot: string;
  quantity: number;
  unit_price_yen: number;
  discount_yen: number;
  tax_rate_basis_points: number;
  line_subtotal_yen: number;
  tax_amount_yen: number;
  line_total_yen: number;
  sort_order: number;
};

export type InvoiceFilters = {
  query: string;
  customerId: string;
  status: '' | InvoiceStatus;
};

export type InvoiceDetail = {
  invoice: Invoice;
  items: InvoiceItem[];
};

export type ManualInvoiceLineInput = {
  id: string;
  itemName: string;
  quantity: string;
  unitPriceYen: string;
  discountYen: string;
  taxRateId: string;
};

export type CreateManualInvoiceInput = {
  idempotencyKey: string;
  customerId: string;
  subject: string;
  billingMonth: string;
  dueDate: string;
  lines: ManualInvoiceLineInput[];
};
