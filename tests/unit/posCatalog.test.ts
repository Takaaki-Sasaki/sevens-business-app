import { describe, expect, it } from 'vitest';
import { childrenOf, productsForCategory, rootCategories, searchProducts } from '../../src/features/pos/posCatalog';
import type { Product, ProductCategory } from '../../src/features/products/types';

const categories: ProductCategory[] = [
  { id: 'tire', organization_id: 'org', parent_id: null, name: 'タイヤ', depth: 1, sort_order: 10, active: true, deleted_at: null, created_at: '', updated_at: '' },
  { id: '17', organization_id: 'org', parent_id: 'tire', name: '17インチ', depth: 2, sort_order: 10, active: true, deleted_at: null, created_at: '', updated_at: '' },
  { id: 'inactive-root', organization_id: 'org', parent_id: null, name: '停止カテゴリ', depth: 1, sort_order: 20, active: false, deleted_at: null, created_at: '', updated_at: '' },
  { id: 'hidden-child', organization_id: 'org', parent_id: 'inactive-root', name: '子カテゴリ', depth: 2, sort_order: 10, active: true, deleted_at: null, created_at: '', updated_at: '' },
];

const tireProduct: Product = {
  id: 'p1', organization_id: 'org', product_code: 'P001', name: 'SEVENS タイヤ 17', category_id: '17', tax_rate_id: 'tax', price_yen: 12800, active: true, sort_order: 10, deleted_at: null, created_at: '', updated_at: '',
};
const hiddenProduct: Product = { ...tireProduct, id: 'p2', product_code: 'P002', name: '非表示商品', category_id: 'hidden-child' };

describe('レジ用の商品カタログ', () => {
  it('種別から子カテゴリへたどり、末端商品のみ表示する', () => {
    expect(rootCategories(categories).map((category) => category.id)).toEqual(['tire', 'inactive-root']);
    expect(childrenOf('tire', categories).map((category) => category.id)).toEqual(['17']);
    expect(productsForCategory('17', [tireProduct, hiddenProduct], categories)).toEqual([tireProduct]);
  });

  it('停止した親カテゴリ配下の商品は検索対象にしない', () => {
    expect(searchProducts('商品', [tireProduct, hiddenProduct], categories).map((product) => product.id)).toEqual([]);
    expect(searchProducts('タイヤ', [tireProduct, hiddenProduct], categories).map((product) => product.id)).toEqual(['p1']);
  });
});
