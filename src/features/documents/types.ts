export const documentTypes = [
  { code: 'estimate', label: '見積書', title: '御見積書' },
  { code: 'invoice', label: '請求書', title: '御請求書' },
  { code: 'receipt', label: '領収書', title: '領収書' },
  { code: 'payment_notice', label: '支払通知書', title: '支払通知書' },
  { code: 'order', label: '発注書', title: '発注書' },
  { code: 'delivery', label: '納品書', title: '納品書' },
] as const;

export type DocumentType = typeof documentTypes[number]['code'];
export type DocumentSourceKind = 'invoice' | 'sale';

export type OrganizationSettings = {
  organization_id: string;
  issuer_name: string | null;
  postal_code: string | null;
  address1: string | null;
  address2: string | null;
  phone: string | null;
  fax: string | null;
  bank_information: string | null;
  invoice_number_prefix: string;
  sale_number_prefix: string;
  tax_rounding_mode: 'floor' | 'round' | 'ceil';
  updated_at: string;
};

export type DocumentSource = {
  id: string;
  number: string;
  customerName: string;
  subject: string;
  totalAmountYen: number;
  date: string;
};

export type DocumentLine = {
  name: string;
  quantity: number;
  unitPriceYen: number;
  amountYen: number;
};

export type DocumentData = {
  sourceKind: DocumentSourceKind;
  sourceId: string;
  sourceNumber: string;
  documentType: DocumentType;
  documentTitle: string;
  customerName: string;
  subject: string;
  issueDate: string;
  paymentDueDate: string | null;
  bankInformation: string | null;
  issuer: OrganizationSettings;
  lines: DocumentLine[];
  subtotalYen: number;
  taxAmountYen: number;
  totalAmountYen: number;
};
