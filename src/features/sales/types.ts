export type SaleStatus = 'draft' | 'confirmed' | 'cancelled';

export type Sale = {
  id: string;
  organization_id: string;
  sale_number: string;
  customer_id: string | null;
  customer_name_snapshot: string | null;
  vehicle_id: string | null;
  sale_date: string;
  subtotal_yen: number;
  tax_amount_yen: number;
  total_amount_yen: number;
  primary_payment_method_id: string | null;
  amount_received_yen: number | null;
  change_amount_yen: number;
  status: SaleStatus;
  operator_id: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_code_snapshot: string | null;
  product_name_snapshot: string;
  quantity: number;
  unit_price_yen: number;
  discount_yen: number;
  tax_rate_basis_points: number;
  line_subtotal_yen: number;
  tax_amount_yen: number;
  line_total_yen: number;
  sort_order: number;
};

export type SalePayment = {
  id: string;
  sale_id: string;
  payment_method_id: string;
  payment_method_name_snapshot: string;
  amount_yen: number;
  amount_received_yen: number | null;
  change_amount_yen: number;
  created_at: string;
};

export type SaleCheckoutResult = {
  sale_id: string;
  sale_number: string;
  subtotal_yen: number;
  discount_yen: number;
  tax_amount_yen: number;
  total_amount_yen: number;
  change_amount_yen: number;
  status: 'confirmed';
  invoice?: InvoiceLink | null;
};

export type SaleFilters = {
  from: string;
  to: string;
  query: string;
  payment_method_id: string;
  operator_id: string;
};

export type SaleVehicleSnapshot = {
  id: string;
  registration_number: string | null;
  manufacturer: string | null;
  model_name: string | null;
  model_code: string | null;
};

export type SaleOperator = {
  id: string;
  display_name: string | null;
  email: string;
  active: boolean;
};

export type SaleDetail = {
  sale: Sale;
  items: SaleItem[];
  payments: SalePayment[];
  vehicle: SaleVehicleSnapshot | null;
  invoice: InvoiceLink | null;
};
import type { InvoiceLink } from '../invoices/types';
