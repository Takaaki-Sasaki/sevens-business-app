import { describe, expect, it } from 'vitest';
import { buildCategoryTree, categoryPath, descendantsOf, leafCategories } from '../../src/features/products/categoryTree';
import { normalizeProductInput, validateProductInput } from '../../src/features/products/productValidation';
import type { ProductCategory } from '../../src/features/products/types';

const categories: ProductCategory[] = [
  { id: 'tire', organization_id: 'org', parent_id: null, name: 'タイヤ', depth: 1, sort_order: 10, active: true, deleted_at: null, created_at: '', updated_at: '' },
  { id: '17inch', organization_id: 'org', parent_id: 'tire', name: '17インチ', depth: 2, sort_order: 10, active: true, deleted_at: null, created_at: '', updated_at: '' },
  { id: 'oil', organization_id: 'org', parent_id: null, name: 'オイル', depth: 1, sort_order: 20, active: true, deleted_at: null, created_at: '', updated_at: '' },
];

describe('商品カテゴリツリー', () => {
  it('任意階層をツリーとパスへ変換する', () => {
    const tree = buildCategoryTree(categories);
    expect(tree).toHaveLength(2);
    expect(tree[0].children[0].name).toBe('17インチ');
    expect(categoryPath('17inch', categories)).toBe('タイヤ ＞ 17インチ');
  });

  it('末端カテゴリと子孫を正しく求める', () => {
    expect(leafCategories(categories).map((category) => category.id)).toEqual(['17inch', 'oil']);
    expect(descendantsOf('tire', categories)).toEqual(new Set(['17inch']));
  });
});

describe('商品マスタ入力', () => {
  it('単価の区切り文字を除去して整数円として扱う', () => {
    const input = normalizeProductInput({ product_code: ' P-001 ', name: ' タイヤ ', category_id: '17inch', tax_rate_id: 'tax', price_yen: '12,800 円', sort_order: ' 1 ', active: true });
    expect(input).toMatchObject({ product_code: 'P-001', name: 'タイヤ', price_yen: '12800', sort_order: '1' });
  });

  it('カテゴリ・税率・金額の必須条件を検証する', () => {
    expect(validateProductInput({ product_code: '', name: '商品', category_id: '', tax_rate_id: 'tax', price_yen: '100', sort_order: '0', active: true })).toContain('カテゴリ');
    expect(validateProductInput({ product_code: '', name: '商品', category_id: 'cat', tax_rate_id: '', price_yen: '100', sort_order: '0', active: true })).toContain('税率');
    expect(validateProductInput({ product_code: '', name: '商品', category_id: 'cat', tax_rate_id: 'tax', price_yen: '100.5', sort_order: '0', active: true })).toContain('単価');
  });
});
