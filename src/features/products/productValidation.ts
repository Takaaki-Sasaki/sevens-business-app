import type { CategoryInput, ProductInput } from './types';

export function normalizeCategoryInput(input: CategoryInput): CategoryInput {
  return {
    name: input.name.trim(),
    parent_id: input.parent_id,
    sort_order: input.sort_order.trim(),
    active: input.active,
  };
}

export function validateCategoryInput(input: CategoryInput): string | null {
  if (!input.name) return 'カテゴリ名を入力してください。';
  if (input.sort_order && !/^-?\d+$/.test(input.sort_order)) return '並び順は整数で入力してください。';
  return null;
}

export function normalizeProductInput(input: ProductInput): ProductInput {
  return {
    product_code: input.product_code.trim(),
    name: input.name.trim(),
    category_id: input.category_id,
    tax_rate_id: input.tax_rate_id,
    price_yen: input.price_yen.replace(/[,，\s円]/g, ''),
    sort_order: input.sort_order.trim(),
    active: input.active,
  };
}

export function validateProductInput(input: ProductInput): string | null {
  if (!input.name) return '商品名を入力してください。';
  if (!input.category_id) return '末端カテゴリを選択してください。';
  if (!input.tax_rate_id) return '税率を選択してください。';
  if (!/^\d+$/.test(input.price_yen)) return '単価は0以上の整数（円）で入力してください。';
  if (input.sort_order && !/^-?\d+$/.test(input.sort_order)) return '並び順は整数で入力してください。';
  return null;
}
