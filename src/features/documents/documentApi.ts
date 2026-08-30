import { requireSupabase } from '../../shared/lib/supabase';
import { getInvoiceDetail } from '../invoices/invoiceApi';
import { getSaleDetail } from '../sales/saleApi';
import { documentTypes, type DocumentData, type DocumentSource, type DocumentSourceKind, type DocumentType, type OrganizationSettings } from './types';

const settingsFields = 'organization_id, issuer_name, postal_code, address1, address2, phone, fax, bank_information, invoice_number_prefix, sale_number_prefix, tax_rounding_mode, updated_at';

function localDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  const { data, error } = await requireSupabase()
    .from('organization_settings')
    .select(settingsFields)
    .eq('organization_id', organizationId)
    .single<OrganizationSettings>();
  if (error) throw error;
  return data;
}

export async function saveOrganizationSettings(settings: OrganizationSettings): Promise<void> {
  const { error } = await requireSupabase()
    .from('organization_settings')
    .upsert({
      organization_id: settings.organization_id,
      issuer_name: settings.issuer_name || null,
      postal_code: settings.postal_code || null,
      address1: settings.address1 || null,
      address2: settings.address2 || null,
      phone: settings.phone || null,
      fax: settings.fax || null,
      bank_information: settings.bank_information || null,
      invoice_number_prefix: settings.invoice_number_prefix,
      sale_number_prefix: settings.sale_number_prefix,
      tax_rounding_mode: settings.tax_rounding_mode,
    });
  if (error) throw error;
}

export async function listDocumentSources(organizationId: string, kind: DocumentSourceKind): Promise<DocumentSource[]> {
  if (kind === 'invoice') {
    const { data, error } = await requireSupabase()
      .from('invoices')
      .select('id, invoice_number, customer_name_snapshot, subject, total_amount_yen, billing_month, created_at')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .returns<Array<{ id: string; invoice_number: string; customer_name_snapshot: string | null; subject: string | null; total_amount_yen: number; billing_month: string | null; created_at: string }>>();
    if (error) throw error;
    return data.map((row) => ({ id: row.id, number: row.invoice_number, customerName: row.customer_name_snapshot || '顧客未設定', subject: row.subject || '', totalAmountYen: row.total_amount_yen, date: row.billing_month || row.created_at.slice(0, 10) }));
  }

  const { data, error } = await requireSupabase()
    .from('sales')
    .select('id, sale_number, customer_name_snapshot, total_amount_yen, sale_date')
    .eq('organization_id', organizationId)
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .order('sale_date', { ascending: false })
    .returns<Array<{ id: string; sale_number: string; customer_name_snapshot: string | null; total_amount_yen: number; sale_date: string }>>();
  if (error) throw error;
  return data.map((row) => ({ id: row.id, number: row.sale_number, customerName: row.customer_name_snapshot || '一般客', subject: '', totalAmountYen: row.total_amount_yen, date: row.sale_date }));
}

export async function createDocumentData(input: { organizationId: string; kind: DocumentSourceKind; sourceId: string; documentType: DocumentType; issuer: OrganizationSettings }): Promise<DocumentData> {
  const meta = documentTypes.find((type) => type.code === input.documentType);
  if (!meta) throw new Error('帳票種別が不正です。');
  if (input.kind === 'invoice') {
    const detail = await getInvoiceDetail(input.organizationId, input.sourceId);
    return {
      sourceKind: 'invoice', sourceId: detail.invoice.id, sourceNumber: detail.invoice.invoice_number,
      documentType: input.documentType, documentTitle: meta.title,
      customerName: detail.invoice.customer_name_snapshot || '',
      subject: detail.invoice.subject || '', issueDate: localDate(), paymentDueDate: detail.invoice.due_date,
      bankInformation: input.issuer.bank_information,
      issuer: input.issuer,
      lines: detail.items.map((item) => ({ name: item.item_name_snapshot, quantity: item.quantity, unitPriceYen: item.unit_price_yen, amountYen: item.line_total_yen })),
      subtotalYen: detail.invoice.subtotal_yen, taxAmountYen: detail.invoice.tax_amount_yen, totalAmountYen: detail.invoice.total_amount_yen,
    };
  }

  const detail = await getSaleDetail(input.organizationId, input.sourceId);
  return {
    sourceKind: 'sale', sourceId: detail.sale.id, sourceNumber: detail.sale.sale_number,
    documentType: input.documentType, documentTitle: meta.title,
    customerName: detail.sale.customer_name_snapshot || '一般客',
    subject: `売上 ${detail.sale.sale_number} 分`, issueDate: localDate(), paymentDueDate: null,
    bankInformation: null,
    issuer: input.issuer,
    lines: detail.items.map((item) => ({ name: item.product_name_snapshot, quantity: item.quantity, unitPriceYen: item.unit_price_yen, amountYen: item.line_total_yen })),
    subtotalYen: detail.sale.subtotal_yen, taxAmountYen: detail.sale.tax_amount_yen, totalAmountYen: detail.sale.total_amount_yen,
  };
}

export async function recordDocumentIssue(data: DocumentData): Promise<void> {
  const fileName = `${data.documentTitle}_${data.sourceNumber}_${data.issueDate.replaceAll('-', '')}.pdf`;
  const { error } = await requireSupabase().rpc('record_document_issue', {
    p_document_type: data.documentType,
    p_source_invoice_id: data.sourceKind === 'invoice' ? data.sourceId : null,
    p_source_sale_id: data.sourceKind === 'sale' ? data.sourceId : null,
    p_file_name: fileName,
  });
  if (error) throw error;
}
