import { describe, expect, it } from 'vitest';
import { documentMarkup } from '../../src/features/documents/documentPrint';
import type { DocumentData } from '../../src/features/documents/types';

const data: DocumentData = {
  sourceKind: 'invoice', sourceId: 'invoice-1', sourceNumber: 'INV-000001', documentType: 'invoice', documentTitle: '御請求書',
  customerName: '株式会社 <テスト>', vehicleName: '横浜 300 あ 12-34 / セブンズカー', issueDate: '2026-08-11', paymentDueDate: '2026-08-31', bankInformation: 'SEVENS銀行 本店',
  notes: '作業後に空気圧を再確認\nお客様へ説明済み',
  issuer: { organization_id: 'org', issuer_name: '株式会社SEVENS', postal_code: '221-0864', address1: '横浜市', address2: '神奈川区', phone: '045-000-0000', fax: null, bank_information: 'SEVENS銀行 本店', invoice_number_prefix: 'INV-', sale_number_prefix: 'SAL-', tax_rounding_mode: 'round', updated_at: '' },
  lines: [{ name: 'タイヤ交換', quantity: 2, unitPriceYen: 5000, amountYen: 11000 }],
  subtotalYen: 10000, taxAmountYen: 1000, preOrderDiscountTotalYen: 11000,
  orderDiscountAmountYen: 1000, orderDiscountRateBasisPoints: 1000, totalAmountYen: 10000,
};

describe('A4帳票マークアップ', () => {
  it('9明細行、透かし、下部ロゴ、割引、名称なしの独立した備考枠を出力する', () => {
    const markup = documentMarkup(data);
    expect(markup.match(/<tbody>/)?.length).toBe(1);
    expect(markup.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g)).toHaveLength(9);
    expect(markup).toContain('doc-watermark');
    expect(markup).toContain('doc-footer-logo');
    expect(markup).toContain('割引（10%）');
    expect(markup).toContain('−¥1,000');
    expect(markup).toContain('¥10,000');
    expect(markup).toContain('<div class="doc-notes">作業後に空気圧を再確認\nお客様へ説明済み</div>');
    expect(markup).not.toContain('>備考<');
    const totals = markup.match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0] || '';
    expect(totals.indexOf('小計')).toBeLessThan(totals.indexOf('消費税'));
    expect(totals.indexOf('消費税')).toBeLessThan(totals.indexOf('割引（10%）'));
    expect(totals.indexOf('割引（10%）')).toBeLessThan(totals.indexOf('合計'));
  });

  it('割引なしでも割引行を0円で確保し、振込先を複数行の要素として出力する', () => {
    const markup = documentMarkup({ ...data, bankInformation: 'SEVENS銀行 本店\n普通 1234567', orderDiscountAmountYen: 0, orderDiscountRateBasisPoints: null, totalAmountYen: 11000 });
    expect(markup).toContain('class="doc-bank"');
    expect(markup).toContain('SEVENS銀行 本店\n普通 1234567');
    expect(markup).toMatch(/<th>割引<\/th><td>0<\/td>/);
  });

  it('帳票に差し込む文字列をHTMLエスケープする', () => {
    const markup = documentMarkup({ ...data, notes: '<script>alert("notes")</script>' });
    expect(markup).toContain('株式会社 &lt;テスト&gt;');
    expect(markup).not.toContain('株式会社 <テスト>');
    expect(markup).toContain('&lt;script&gt;alert(&quot;notes&quot;)&lt;/script&gt;');
    expect(markup).not.toContain('<script>alert("notes")</script>');
  });

  it('備考未入力でも空の長方形枠を確保する', () => {
    const markup = documentMarkup({ ...data, notes: '' });
    expect(markup).toContain('<div class="doc-notes"></div>');
  });

  it('件名ではなくレジで選択した車両を出力する', () => {
    const markup = documentMarkup(data);
    expect(markup).toContain('<dt>車両：</dt>');
    expect(markup).toContain('横浜 300 あ 12-34 / セブンズカー');
    expect(markup).not.toContain('<dt>件名：</dt>');
  });

  it('車両未選択の請求でも車両欄を空欄で出力する', () => {
    const markup = documentMarkup({ ...data, vehicleName: '' });
    expect(markup).toContain('<dt>車両：</dt><dd></dd>');
  });

  it('顧客未設定の請求では宛名と敬称を空欄にする', () => {
    const markup = documentMarkup({ ...data, customerName: '' });
    expect(markup).toContain('<section class="doc-recipient"><span></span><span></span></section>');
    expect(markup).not.toContain('顧客未設定');
  });
});
