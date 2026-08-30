import type { DocumentData } from './types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function formatYen(value: number): string {
  return value === 0 ? '0' : `¥${value.toLocaleString('ja-JP')}`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('ja-JP') : value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });
}

function formatDate(value: string | null): string {
  return value ? value.replaceAll('-', '/') : '';
}

function messageFor(type: DocumentData['documentType']): string {
  return ({
    estimate: '下記の通り、お見積り申し上げます。',
    invoice: '下記の通り、御請求申し上げます。',
    receipt: '下記の通り、領収いたしました。',
    payment_notice: '下記の通り、支払通知申し上げます。',
    order: '下記の通り、発注いたします。',
    delivery: '下記の通り、納品いたしました。',
  })[type];
}

function amountLabelFor(type: DocumentData['documentType']): string {
  return type === 'receipt' ? '領収金額' : type === 'estimate' ? '見積金額' : '合計金額';
}

function logoUrl(): string {
  return typeof window === 'undefined' ? '/icons/sevens-logo.png' : new URL('/icons/sevens-logo.png', window.location.origin).href;
}

function issuerAddress(data: DocumentData): string {
  return [data.issuer.address1, data.issuer.address2].filter(Boolean).map((value) => escapeHtml(value || '')).join('<br>');
}

export function documentMarkup(data: DocumentData): string {
  const rows = Array.from({ length: 8 }, (_, index) => data.lines[index]);
  const logo = escapeHtml(logoUrl());
  const recipient = escapeHtml(data.customerName || '');
  const recipientSuffix = recipient ? '御中' : '';
  const issuer = escapeHtml(data.issuer.issuer_name || 'SEVENS');
  const postal = escapeHtml(data.issuer.postal_code ? `〒${data.issuer.postal_code}` : '');
  const address = issuerAddress(data);
  const subject = escapeHtml(data.subject || '');
  const due = escapeHtml(formatDate(data.paymentDueDate));
  const bank = escapeHtml(data.bankInformation || '');
  const showBank = data.documentType === 'invoice' || data.documentType === 'payment_notice';
  const itemRows = rows.map((line) => `<tr><td>${line ? escapeHtml(line.name) : ''}</td><td>${line ? formatQuantity(line.quantity) : ''}</td><td>${line ? escapeHtml(formatYen(line.unitPriceYen)) : ''}</td><td>${line ? escapeHtml(formatYen(line.amountYen)) : ''}</td></tr>`).join('');
  return `<article class="doc-paper">
    <h1 class="doc-title">${escapeHtml(data.documentTitle)}</h1>
    <section class="doc-recipient"><span>${recipient}</span><span>${recipientSuffix}</span></section>
    <section class="doc-issuer"><strong>${issuer}</strong><span>${postal}</span><span>${address}</span><span>${data.issuer.phone ? `TEL：${escapeHtml(data.issuer.phone)}` : ''}</span><span>${data.issuer.fax ? `FAX：${escapeHtml(data.issuer.fax)}` : ''}</span></section>
    <p class="doc-message">${messageFor(data.documentType)}</p>
    <dl class="doc-meta"><div><dt>件名：</dt><dd>${subject}</dd></div><div><dt>${data.documentType === 'receipt' ? '領収日：' : '支払期限：'}</dt><dd>${data.documentType === 'receipt' ? escapeHtml(formatDate(data.issueDate)) : due}</dd></div>${showBank ? `<div><dt>振込先：</dt><dd>${bank}</dd></div>` : ''}</dl>
    <section class="doc-total"><span>${amountLabelFor(data.documentType)}</span><strong>${escapeHtml(formatYen(data.totalAmountYen))}</strong></section>
    <section class="doc-items"><img class="doc-watermark" src="${logo}" alt=""><table><thead><tr><th>内容</th><th>数量</th><th>単価</th><th>金額</th></tr></thead><tbody>${itemRows}</tbody><tfoot><tr><td class="doc-spacer" colspan="2" rowspan="3"></td><th>小計</th><td>${escapeHtml(formatYen(data.subtotalYen))}</td></tr><tr><th>消費税</th><td>${escapeHtml(formatYen(data.taxAmountYen))}</td></tr><tr><th>合計</th><td>${escapeHtml(formatYen(data.totalAmountYen))}</td></tr></tfoot></table></section>
    <section class="doc-notes"><h2>備考</h2><div></div></section>
    <img class="doc-footer-logo" src="${logo}" alt="SEVENS">
  </article>`;
}

export function documentPreviewStyles(): string {
  return `
    .doc-preview-area { overflow: auto; padding: 28px; border: 1px solid #39352a; border-radius: 12px; background: #0d0d0c; }
    .doc-paper { position: relative; width: 794px; height: 1123px; margin: auto; overflow: hidden; color: #111; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.38); font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; }
    ${documentPaperStyles('px')}
  `;
}

function documentPaperStyles(unit: 'px' | 'mm'): string {
  if (unit === 'px') return `
    .doc-title { position:absolute; top:54px; right:0; left:0; margin:0; color:#111; font-size:29px; font-weight:500; letter-spacing:.12em; text-align:center; }
    .doc-recipient { position:absolute; top:142px; left:42px; display:flex; align-items:baseline; gap:92px; font-size:18px; }.doc-recipient span:first-child { min-width:190px; }
    .doc-issuer { position:absolute; top:140px; right:68px; display:grid; gap:13px; font-size:15px; line-height:1.25; }.doc-issuer strong { font-size:17px; font-weight:500; }.doc-issuer span:empty { display:none; }
    .doc-message { position:absolute; top:255px; left:42px; margin:0; font-size:16px; }
    .doc-meta { position:absolute; top:294px; left:80px; display:grid; gap:11px; width:340px; margin:0; font-size:14px; line-height:1.2; }.doc-meta div { display:grid; grid-template-columns:82px 1fr; }.doc-meta dt,.doc-meta dd { margin:0; }.doc-meta dd { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .doc-total { position:absolute; top:394px; left:42px; display:grid; grid-template-columns:174px 1fr; width:305px; height:65px; border:1px solid #999; font-size:20px; }.doc-total span,.doc-total strong { display:grid; place-items:center; }.doc-total span { border-right:1px solid #999; font-weight:400; }.doc-total strong { font-size:22px; font-weight:500; }
    .doc-items { position:absolute; top:470px; right:42px; left:42px; }.doc-watermark { position:absolute; z-index:0; top:52px; left:22%; width:56%; opacity:.12; }.doc-items table { position:relative; z-index:1; width:100%; border-collapse:collapse; table-layout:fixed; }.doc-items th,.doc-items td { height:36px; padding:6px 8px; border:1px solid #999; color:#111; font-size:15px; font-weight:400; }.doc-items th { text-align:center; }.doc-items th:nth-child(1),.doc-items td:nth-child(1) { width:44.8%; text-align:left; }.doc-items th:nth-child(2),.doc-items td:nth-child(2) { width:12.2%; text-align:right; }.doc-items th:nth-child(3),.doc-items td:nth-child(3) { width:15.4%; text-align:right; }.doc-items th:nth-child(4),.doc-items td:nth-child(4) { width:27.6%; text-align:right; }.doc-items td { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.doc-items tfoot th,.doc-items tfoot td { height:34px; }.doc-items .doc-spacer { border:0; }
    .doc-notes { position:absolute; top:923px; right:42px; left:42px; border:1px solid #999; }.doc-notes h2 { height:27px; margin:0; border-bottom:1px solid #999; font-size:14px; font-weight:400; line-height:27px; text-align:center; }.doc-notes div { height:64px; }.doc-footer-logo { position:absolute; top:1028px; left:50%; width:205px; height:auto; transform:translateX(-50%); }
  `;
  return `
    .doc-title { position:absolute; top:8mm; right:0; left:0; margin:0; font-size:23pt; font-weight:500; letter-spacing:.12em; text-align:center; }.doc-recipient { position:absolute; top:31mm; left:2mm; display:flex; align-items:baseline; gap:36mm; font-size:14pt; }.doc-recipient span:first-child { min-width:53mm; }
    .doc-issuer { position:absolute; top:31mm; right:18mm; display:grid; gap:4mm; font-size:11.5pt; line-height:1.25; }.doc-issuer strong { font-size:13pt; font-weight:500; }.doc-issuer span:empty { display:none; }.doc-message { position:absolute; top:65mm; left:2mm; margin:0; font-size:12pt; }
    .doc-meta { position:absolute; top:76mm; left:12mm; display:grid; gap:3mm; width:110mm; margin:0; font-size:10.5pt; line-height:1.2; }.doc-meta div { display:grid; grid-template-columns:25mm 1fr; }.doc-meta dt,.doc-meta dd { margin:0; }.doc-meta dd { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .doc-total { position:absolute; top:102mm; left:0; display:grid; grid-template-columns:31mm 1fr; width:94mm; height:24mm; border:1px solid #999; font-size:15pt; }.doc-total span,.doc-total strong { display:grid; place-items:center; }.doc-total span { border-right:1px solid #999; font-weight:400; }.doc-total strong { font-size:17pt; font-weight:500; }
    .doc-items { position:absolute; top:128mm; right:0; left:0; }.doc-watermark { position:absolute; z-index:0; top:13mm; left:24%; width:52%; opacity:.12; }.doc-items table { position:relative; z-index:1; width:100%; border-collapse:collapse; table-layout:fixed; }.doc-items th,.doc-items td { height:8.2mm; padding:1.1mm 2.5mm; border:1px solid #999; font-size:10.5pt; font-weight:400; }.doc-items th { text-align:center; }.doc-items th:nth-child(1),.doc-items td:nth-child(1) { width:44.8%; text-align:left; }.doc-items th:nth-child(2),.doc-items td:nth-child(2) { width:12.2%; text-align:right; }.doc-items th:nth-child(3),.doc-items td:nth-child(3) { width:15.4%; text-align:right; }.doc-items th:nth-child(4),.doc-items td:nth-child(4) { width:27.6%; text-align:right; }.doc-items td { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.doc-items tfoot th,.doc-items tfoot td { height:8.2mm; }.doc-items .doc-spacer { border:0; }
    .doc-notes { position:absolute; top:235mm; right:0; left:0; border:1px solid #999; }.doc-notes h2 { height:7mm; margin:0; border-bottom:1px solid #999; font-size:10.5pt; font-weight:400; line-height:7mm; text-align:center; }.doc-notes div { height:19mm; }.doc-footer-logo { position:absolute; top:262mm; left:50%; width:70mm; height:auto; transform:translateX(-50%); }
  `;
}

export function openDocumentPrintWindow(data: DocumentData): boolean {
  const popup = window.open('', '_blank', 'width=900,height=1120');
  if (!popup) return false;
  const printStyles = `@page { size:A4; margin:10mm 12mm; } * { box-sizing:border-box; } html,body { margin:0; color:#111; background:#fff; font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif; } .doc-paper { position:relative; width:186mm; height:277mm; overflow:hidden; color:#111; background:#fff; } ${documentPaperStyles('mm')}`;
  popup.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${escapeHtml(`${data.documentTitle}_${data.sourceNumber}`)}</title><style>${printStyles}</style></head><body>${documentMarkup(data)}<script>window.onload=function(){ window.focus(); window.print(); };</script></body></html>`);
  popup.document.close();
  return true;
}
