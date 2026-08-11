import { useEffect, useMemo, useState } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import { createDocumentData, getOrganizationSettings, listDocumentSources, recordDocumentIssue, saveOrganizationSettings } from './documentApi';
import { DocumentPreview } from './DocumentPreview';
import { openDocumentPrintWindow } from './documentPrint';
import { documentTypes, type DocumentData, type DocumentSource, type DocumentSourceKind, type DocumentType, type OrganizationSettings } from './types';
import { toUserMessage } from '../../shared/lib/userError';

export function DocumentsPage({ profile }: { profile: Profile }) {
  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [issuer, setIssuer] = useState<OrganizationSettings>();
  const [sourceData, setSourceData] = useState<DocumentData>();
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sourceKind: DocumentSourceKind = documentType === 'receipt' ? 'sale' : 'invoice';
  const canSaveSettings = hasPermission(profile.role, 'settings.write');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getOrganizationSettings(profile.organization_id)
      .then((settings) => { if (!cancelled) setIssuer(settings); })
      .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '発行元設定を取得できませんでした。' })); });
    return () => { cancelled = true; };
  }, [profile.organization_id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSources(true);
    setSourceId('');
    setSourceData(undefined);
    setError(null);
    void listDocumentSources(profile.organization_id, sourceKind)
      .then((items) => { if (!cancelled) setSources(items); })
      .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '帳票元の一覧を取得できませんでした。' })); })
      .finally(() => { if (!cancelled) setLoadingSources(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, sourceKind]);

  useEffect(() => {
    let cancelled = false;
    if (!sourceId || !issuer) { setSourceData(undefined); return undefined; }
    setLoadingPreview(true);
    setError(null);
    void createDocumentData({ organizationId: profile.organization_id, kind: sourceKind, sourceId, documentType, issuer })
      .then((data) => { if (!cancelled) setSourceData(data); })
      .catch((caught: unknown) => { if (!cancelled) { setSourceData(undefined); setError(toUserMessage(caught, { fallback: '帳票データを作成できませんでした。' })); } })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, sourceKind, sourceId, documentType, issuer?.organization_id]);

  const previewData = useMemo(() => sourceData && issuer ? { ...sourceData, issuer, bankInformation: sourceData.sourceKind === 'invoice' ? issuer.bank_information : null } : undefined, [sourceData, issuer]);

  async function saveIssuer() {
    if (!issuer) return;
    setSavingSettings(true);
    setError(null);
    try {
      await saveOrganizationSettings(issuer);
      setNotice('発行元設定を保存しました。');
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '発行元設定を保存できませんでした。', retryAction: '発行元設定を保存' }));
    } finally {
      setSavingSettings(false);
    }
  }

  function printAsPdf() {
    if (!previewData) return;
    setNotice(null);
    if (!openDocumentPrintWindow(previewData)) {
      setError('帳票ウィンドウを開けませんでした。ブラウザでポップアップを許可してください。');
      return;
    }
    void recordDocumentIssue(previewData)
      .then(() => setNotice('印刷画面を開きました。印刷ダイアログで「PDFとして保存」を選択してください。'))
      .catch((caught: unknown) => setError(toUserMessage(caught, { fallback: '帳票発行履歴を保存できませんでした。', retryAction: 'PDFとして保存' })));
  }

  return (
    <section className="page-view documents-page" aria-labelledby="documents-page-title">
      <header className="page-header"><div><p className="eyebrow">PDF DOCUMENTS</p><h1 id="documents-page-title">帳票発行</h1><p className="page-description">A4帳票をプレビューし、ブラウザの印刷画面からPDFとして保存します。</p></div></header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}
      {notice && <p className="document-notice" role="status">{notice}</p>}
      <section className="panel document-controls">
        <div className="document-control-grid">
          <label className="field"><span>帳票種別</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>{documentTypes.map((type) => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
          <label className="field"><span>{sourceKind === 'invoice' ? '請求データ' : '売上データ'}</span><select value={sourceId} disabled={loadingSources} onChange={(event) => setSourceId(event.target.value)}><option value="">{loadingSources ? '読み込み中…' : '選択してください'}</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.number} ｜ {source.customerName} ｜ ¥{source.totalAmountYen.toLocaleString()}</option>)}</select></label>
          <div className="document-print-action"><button type="button" className="primary-button" disabled={!previewData || loadingPreview} onClick={printAsPdf}>{loadingPreview ? 'プレビューを作成中…' : 'PDFとして保存'}</button></div>
        </div>
        <p className="document-source-note">{sourceKind === 'sale' ? '領収書は確定済みの売上データを元に作成します。' : '請求書・見積書・支払通知書・発注書・納品書は請求データを元に作成します。'}</p>
      </section>

      {issuer && <details className="panel issuer-settings"><summary>発行元設定（帳票に表示する会社情報）</summary><div className="issuer-settings-form"><label className="field"><span>会社名</span><input disabled={!canSaveSettings} value={issuer.issuer_name || ''} onChange={(event) => setIssuer({ ...issuer, issuer_name: event.target.value })} /></label><label className="field"><span>郵便番号</span><input disabled={!canSaveSettings} value={issuer.postal_code || ''} onChange={(event) => setIssuer({ ...issuer, postal_code: event.target.value })} /></label><label className="field"><span>住所1</span><input disabled={!canSaveSettings} value={issuer.address1 || ''} onChange={(event) => setIssuer({ ...issuer, address1: event.target.value })} /></label><label className="field"><span>住所2</span><input disabled={!canSaveSettings} value={issuer.address2 || ''} onChange={(event) => setIssuer({ ...issuer, address2: event.target.value })} /></label><label className="field"><span>TEL</span><input disabled={!canSaveSettings} value={issuer.phone || ''} onChange={(event) => setIssuer({ ...issuer, phone: event.target.value })} /></label><label className="field"><span>FAX</span><input disabled={!canSaveSettings} value={issuer.fax || ''} onChange={(event) => setIssuer({ ...issuer, fax: event.target.value })} /></label><label className="field issuer-bank-field"><span>振込先</span><textarea disabled={!canSaveSettings} value={issuer.bank_information || ''} onChange={(event) => setIssuer({ ...issuer, bank_information: event.target.value })} /></label>{canSaveSettings && <button type="button" className="secondary-button" disabled={savingSettings} onClick={() => void saveIssuer()}>{savingSettings ? '保存中…' : '発行元設定を保存'}</button>}</div></details>}

      {previewData ? <DocumentPreview data={previewData} /> : <section className="document-preview-placeholder">{loadingPreview ? '帳票を作成しています…' : '帳票種別と元データを選択すると、ここにA4プレビューを表示します。'}</section>}
    </section>
  );
}
