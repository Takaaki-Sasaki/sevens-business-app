import { documentMarkup, documentPreviewStyles } from './documentPrint';
import type { DocumentData } from './types';

export function DocumentPreview({ data }: { data: DocumentData }) {
  return <section className="document-preview" aria-label={`${data.documentTitle}プレビュー`}><style>{documentPreviewStyles()}</style><div className="doc-preview-area" dangerouslySetInnerHTML={{ __html: documentMarkup(data) }} /></section>;
}
