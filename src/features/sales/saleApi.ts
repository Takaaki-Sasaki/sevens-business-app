import type { CartLine } from '../pos/cart';
import { requireSupabase } from '../../shared/lib/supabase';
import type { Sale, SaleCheckoutResult, SaleDetail, SaleFilters, SaleItem, SaleOperator, SalePayment, SaleVehicleSnapshot } from './types';
import type { InvoiceLink } from '../invoices/types';

const saleFields = 'id, organization_id, sale_number, customer_id, customer_name_snapshot, vehicle_id, sale_date, subtotal_yen, tax_amount_yen, total_amount_yen, primary_payment_method_id, amount_received_yen, change_amount_yen, status, operator_id, confirmed_at, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at';
const saleItemFields = 'id, sale_id, product_id, product_code_snapshot, product_name_snapshot, quantity, unit_price_yen, discount_yen, tax_rate_basis_points, line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order';
const paymentFields = 'id, sale_id, payment_method_id, payment_method_name_snapshot, amount_yen, amount_received_yen, change_amount_yen, created_at';

function safeSearchTerm(value: string): string {
  return value.replace(/[,%()]/g, ' ').trim();
}

export function localSaleDate(): string {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export async function getTodaySalesSummary(organizationId: string): Promise<{ totalYen: number; count: number }> {
  const { data, error } = await requireSupabase()
    .from('sales')
    .select('total_amount_yen')
    .eq('organization_id', organizationId)
    .eq('sale_date', localSaleDate())
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .returns<Array<{ total_amount_yen: number }>>();
  if (error) throw error;
  return {
    totalYen: data.reduce((total, sale) => total + sale.total_amount_yen, 0),
    count: data.length,
  };
}

export function createCheckoutPayload(input: {
  idempotencyKey: string;
  customerId?: string;
  vehicleId?: string;
  paymentMethodId: string;
  amountReceivedYen?: number;
  invoiceSubject?: string;
  billingMonth?: string;
  dueDate?: string;
  lines: CartLine[];
}) {
  return {
    p_idempotency_key: input.idempotencyKey,
    p_customer_id: input.customerId || null,
    p_vehicle_id: input.vehicleId || null,
    p_sale_date: localSaleDate(),
    p_payment_method_id: input.paymentMethodId,
    p_amount_received_yen: input.amountReceivedYen ?? null,
    // RPCの後方互換用引数。現在はすべての会計で請求を自動作成する。
    p_create_invoice: true,
    p_invoice_subject: input.invoiceSubject?.trim() || null,
    p_billing_month: input.billingMonth || null,
    p_due_date: input.dueDate || null,
    p_lines: input.lines.map((line) => line.line_kind === 'custom'
      ? {
        product_id: null,
        custom_item_name: line.product.name,
        tax_rate_id: line.tax_rate_id,
        quantity_milli: line.quantity_milli,
        unit_price_yen: line.unit_price_yen,
        discount_yen: line.discount_yen,
      }
      : {
        product_id: line.product.id,
        quantity_milli: line.quantity_milli,
        unit_price_yen: line.unit_price_yen,
        discount_yen: line.discount_yen,
      }),
  };
}

export async function checkoutSale(input: Parameters<typeof createCheckoutPayload>[0]): Promise<SaleCheckoutResult> {
  const payload = createCheckoutPayload(input);
  const { data, error } = await requireSupabase().rpc('checkout_sale_with_invoice', payload);
  if (error) throw error;
  return data as SaleCheckoutResult;
}

export async function listSales(organizationId: string, filters: SaleFilters): Promise<Sale[]> {
  let query = requireSupabase()
    .from('sales')
    .select(saleFields)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('sale_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters.from) query = query.gte('sale_date', filters.from);
  if (filters.to) query = query.lte('sale_date', filters.to);
  if (filters.payment_method_id) query = query.eq('primary_payment_method_id', filters.payment_method_id);
  if (filters.operator_id) query = query.eq('operator_id', filters.operator_id);
  const term = safeSearchTerm(filters.query);
  if (term) query = query.or(`sale_number.ilike.%${term}%,customer_name_snapshot.ilike.%${term}%`);

  const { data, error } = await query.returns<Sale[]>();
  if (error) throw error;
  return data;
}

export async function getSaleDetail(organizationId: string, saleId: string): Promise<SaleDetail> {
  const client = requireSupabase();
  const [{ data: sale, error: saleError }, { data: items, error: itemsError }, { data: payments, error: paymentsError }, { data: invoices, error: invoicesError }] = await Promise.all([
    client.from('sales').select(saleFields).eq('organization_id', organizationId).eq('id', saleId).is('deleted_at', null).single<Sale>(),
    client.from('sale_items').select(saleItemFields).eq('organization_id', organizationId).eq('sale_id', saleId).order('sort_order', { ascending: true }).returns<SaleItem[]>(),
    client.from('payments').select(paymentFields).eq('organization_id', organizationId).eq('sale_id', saleId).order('created_at', { ascending: true }).returns<SalePayment[]>(),
    client.from('invoices').select('id, invoice_number, status, source_sale_id').eq('organization_id', organizationId).eq('source_sale_id', saleId).is('deleted_at', null).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).returns<Array<{ id: string; invoice_number: string; status: InvoiceLink['status']; source_sale_id: string }>>(),
  ]);
  if (saleError) throw saleError;
  if (itemsError) throw itemsError;
  if (paymentsError) throw paymentsError;
  if (invoicesError) throw invoicesError;
  let vehicle: SaleVehicleSnapshot | null = null;
  if (sale.vehicle_id) {
    const { data, error } = await client
      .from('vehicles')
      .select('id, registration_number, manufacturer, model_name, model_code')
      .eq('organization_id', organizationId)
      .eq('id', sale.vehicle_id)
      .maybeSingle<SaleVehicleSnapshot>();
    if (error) throw error;
    vehicle = data;
  }
  const invoice = invoices[0]
    ? { invoice_id: invoices[0].id, invoice_number: invoices[0].invoice_number, status: invoices[0].status, source_sale_id: invoices[0].source_sale_id }
    : null;
  return { sale, items, payments, vehicle, invoice };
}

export async function listSaleOperators(organizationId: string): Promise<SaleOperator[]> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('id, display_name, email, active')
    .eq('organization_id', organizationId)
    .order('display_name', { ascending: true })
    .returns<SaleOperator[]>();
  if (error) throw error;
  return data;
}

export async function cancelSale(saleId: string, reason: string): Promise<{ sale_id: string; sale_number: string; status: 'cancelled' }> {
  const { data, error } = await requireSupabase().rpc('cancel_sale', { p_sale_id: saleId, p_reason: reason || null });
  if (error) throw error;
  return data as { sale_id: string; sale_number: string; status: 'cancelled' };
}
