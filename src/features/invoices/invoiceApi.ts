import { requireSupabase } from '../../shared/lib/supabase';
import { parseQuantity, parseYen } from '../pos/cart';
import type { CreateInvoiceFromSaleInput, CreateManualInvoiceInput, Invoice, InvoiceDetail, InvoiceFilters, InvoiceItem, InvoiceLink, ManualInvoiceLineInput, UpdateManualInvoiceInput } from './types';

const invoiceFields = 'id, organization_id, invoice_number, source_sale_id, customer_id, customer_name_snapshot, payment_method_id, payment_method_name_snapshot, subject, billing_month, due_date, subtotal_yen, tax_amount_yen, total_amount_yen, status, issued_at, issued_by, paid_at, cancelled_at, cancelled_by, cancellation_reason, deleted_at, created_by, created_at, updated_at';
const invoiceItemFields = 'id, invoice_id, source_sale_item_id, product_id, tax_rate_id, item_name_snapshot, quantity, unit_price_yen, discount_yen, tax_rate_basis_points, line_subtotal_yen, tax_amount_yen, line_total_yen, sort_order';

function safeSearchTerm(value: string): string {
  return value.replace(/[,%()]/g, ' ').trim();
}

function localDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * 日付入力（YYYY-MM-DD）の午前0時を、操作端末のタイムゾーン付きのISO文字列にする。
 * 発行日時は timestamptz のため、日付の終端は翌日の午前0時未満で検索する。
 */
function localDayBoundary(dateText: string, daysToAdd = 0): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(year, month - 1, day + daysToAdd);
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00${offset}`;
}

export function createInvoicePayload(input: CreateInvoiceFromSaleInput) {
  return {
    p_sale_id: input.saleId,
    p_subject: input.subject?.trim() || null,
    p_billing_month: input.billingMonth || null,
    p_due_date: input.dueDate || null,
  };
}

export async function createInvoiceFromSale(input: CreateInvoiceFromSaleInput): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('invoice_from_sale', createInvoicePayload(input));
  if (error) throw error;
  return data as InvoiceLink;
}

function manualInvoiceLinesPayload(lines: ManualInvoiceLineInput[]) {
  return lines.map((line) => ({
    product_id: line.productId || null,
    item_name: line.itemName.trim(),
    quantity_milli: parseQuantity(line.quantity),
    unit_price_yen: parseYen(line.unitPriceYen),
    discount_yen: parseYen(line.discountYen) ?? 0,
    tax_rate_id: line.taxRateId || null,
  }));
}

export function createManualInvoicePayload(input: CreateManualInvoiceInput) {
  return {
    p_idempotency_key: input.idempotencyKey,
    p_customer_id: input.customerId || null,
    p_subject: input.subject.trim() || null,
    p_billing_month: input.billingMonth ? `${input.billingMonth}-01` : null,
    p_due_date: input.dueDate || null,
    p_lines: manualInvoiceLinesPayload(input.lines),
  };
}

export async function createManualInvoice(input: CreateManualInvoiceInput): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('create_manual_invoice', createManualInvoicePayload(input));
  if (error) throw error;
  return data as InvoiceLink;
}

export function updateManualInvoicePayload(input: UpdateManualInvoiceInput) {
  return {
    p_idempotency_key: input.idempotencyKey,
    p_invoice_id: input.invoiceId,
    p_customer_id: input.customerId || null,
    p_subject: input.subject.trim() || null,
    p_billing_month: input.billingMonth ? `${input.billingMonth}-01` : null,
    p_due_date: input.dueDate || null,
    p_lines: manualInvoiceLinesPayload(input.lines),
  };
}

export async function updateManualInvoice(input: UpdateManualInvoiceInput): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('update_manual_invoice', updateManualInvoicePayload(input));
  if (error) throw error;
  return data as InvoiceLink;
}

export async function listInvoices(organizationId: string, filters: InvoiceFilters): Promise<Invoice[]> {
  let query = requireSupabase()
    .from('invoices')
    .select(invoiceFields)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('issued_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (filters.issuedFrom) query = query.gte('issued_at', localDayBoundary(filters.issuedFrom));
  if (filters.issuedTo) query = query.lt('issued_at', localDayBoundary(filters.issuedTo, 1));
  if (filters.customerId) query = query.eq('customer_id', filters.customerId);
  if (filters.status === 'overdue') {
    const today = localDate();
    query = query.eq('status', 'issued').lt('due_date', today);
  } else if (filters.status) {
    query = query.eq('status', filters.status);
  }
  const term = safeSearchTerm(filters.query);
  if (term) query = query.or(`invoice_number.ilike.%${term}%,customer_name_snapshot.ilike.%${term}%,subject.ilike.%${term}%`);
  const { data, error } = await query.returns<Invoice[]>();
  if (error) throw error;
  return data;
}

export async function getInvoiceDetail(organizationId: string, invoiceId: string): Promise<InvoiceDetail> {
  const client = requireSupabase();
  const [{ data: invoice, error: invoiceError }, { data: items, error: itemsError }] = await Promise.all([
    client.from('invoices').select(invoiceFields).eq('organization_id', organizationId).eq('id', invoiceId).is('deleted_at', null).single<Invoice>(),
    client.from('invoice_items').select(invoiceItemFields).eq('organization_id', organizationId).eq('invoice_id', invoiceId).order('sort_order', { ascending: true }).returns<InvoiceItem[]>(),
  ]);
  if (invoiceError) throw invoiceError;
  if (itemsError) throw itemsError;
  return { invoice, items };
}

export async function issueInvoice(invoiceId: string): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('issue_invoice', { p_invoice_id: invoiceId });
  if (error) throw error;
  return data as InvoiceLink;
}

export async function markInvoicePaid(invoiceId: string): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('mark_invoice_paid', { p_invoice_id: invoiceId });
  if (error) throw error;
  return data as InvoiceLink;
}

export async function cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceLink> {
  const { data, error } = await requireSupabase().rpc('cancel_invoice', { p_invoice_id: invoiceId, p_reason: reason.trim() || null });
  if (error) throw error;
  return data as InvoiceLink;
}
