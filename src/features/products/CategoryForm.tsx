import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { descendantsOf } from './categoryTree';
import { createCategory, updateCategory } from './productApi';
import { normalizeCategoryInput, validateCategoryInput } from './productValidation';
import type { CategoryInput, ProductCategory } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type CategoryFormProps = {
  organizationId: string;
  categories: ProductCategory[];
  category?: ProductCategory;
  initialParentId?: string;
  onSaved: (category: ProductCategory) => void;
  onArchived?: () => Promise<void>;
};

const blankCategory: CategoryInput = { name: '', parent_id: '', sort_order: '0', active: true };

function toInput(category?: ProductCategory, initialParentId?: string): CategoryInput {
  if (!category) return { ...blankCategory, parent_id: initialParentId || '' };
  return {
    name: category.name,
    parent_id: category.parent_id || '',
    sort_order: String(category.sort_order),
    active: category.active,
  };
}

export function CategoryForm({ organizationId, categories, category, initialParentId, onSaved, onArchived }: CategoryFormProps) {
  const [input, setInput] = useState<CategoryInput>(() => toInput(category, initialParentId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const forbiddenParentIds = useMemo(() => category ? new Set([category.id, ...descendantsOf(category.id, categories)]) : new Set<string>(), [category, categories]);

  useEffect(() => {
    setInput(toInput(category, initialParentId));
    setError(null);
  }, [category, initialParentId]);

  function updateField(field: keyof CategoryInput, value: string | boolean) {
    setInput((current) => ({ ...current, [field]: value } as CategoryInput));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeCategoryInput(input);
    const validationError = validateCategoryInput(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = category
        ? await updateCategory(category.id, normalized)
        : await createCategory(organizationId, normalized);
      onSaved(saved);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'カテゴリを保存できませんでした。', retryAction: 'カテゴリを保存' }));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!category || !onArchived) return;
    const message = `カテゴリ「${category.name}」と、その配下のカテゴリ・商品を削除します。過去の売上や請求書は変更されません。よろしいですか？`;
    if (!window.confirm(message)) return;
    setArchiving(true);
    setError(null);
    try {
      await onArchived();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'カテゴリを削除できませんでした。', retryAction: 'カテゴリを削除' }));
    } finally {
      setArchiving(false);
    }
  }

  return (
    <form className="master-form" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{category ? `LEVEL ${category.depth}` : 'NEW CATEGORY'}</p>
          <h2>{category ? 'カテゴリを編集' : 'カテゴリを追加'}</h2>
        </div>
      </div>
      <div className="form-grid">
        <label className="field full">
          <span>カテゴリ名 <b>必須</b></span>
          <input value={input.name} onChange={(event) => updateField('name', event.target.value)} autoFocus required />
        </label>
        <label className="field full">
          <span>親カテゴリ</span>
          <select value={input.parent_id} onChange={(event) => updateField('parent_id', event.target.value)}>
            <option value="">親なし（第1階層）</option>
            {categories.filter((candidate) => !forbiddenParentIds.has(candidate.id)).map((candidate) => (
              <option value={candidate.id} key={candidate.id}>{'　'.repeat(Math.max(0, candidate.depth - 1))}{candidate.name}{!candidate.active ? '（停止中）' : ''}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>並び順</span>
          <input inputMode="numeric" value={input.sort_order} onChange={(event) => updateField('sort_order', event.target.value)} />
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={input.active} onChange={(event) => updateField('active', event.target.checked)} />
          <span><b>有効</b><small>停止するとレジの商品選択から除外されます。</small></span>
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <p>削除すると、このカテゴリ配下のカテゴリ・商品をレジから除外します。過去の売上・請求データは変わりません。</p>
        <div className="master-form-button-group">
          {category && onArchived && <button className="danger-button" type="button" disabled={saving || archiving} onClick={() => void handleArchive()}>{archiving ? '削除中…' : 'カテゴリツリーを削除'}</button>}
          <button className="primary-button" type="submit" disabled={saving || archiving}>{saving ? '保存中…' : 'カテゴリを保存'}</button>
        </div>
      </div>
    </form>
  );
}
