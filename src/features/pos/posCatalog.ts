import { categoryPath } from '../products/categoryTree';
import type { Product, ProductCategory } from '../products/types';

export function rootCategories(categories: ProductCategory[]): ProductCategory[] {
  return sortCategories(categories.filter((category) => !category.parent_id));
}

export function childrenOf(categoryId: string | undefined, categories: ProductCategory[]): ProductCategory[] {
  return sortCategories(categories.filter((category) => category.parent_id === categoryId));
}

function sortCategories(categories: ProductCategory[]): ProductCategory[] {
  return [...categories].sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, 'ja'));
}

export function categoryIsReachable(categoryId: string, categories: ProductCategory[]): boolean {
  const byId = new Map(categories.map((category) => [category.id, category]));
  let current = byId.get(categoryId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (!current.active || current.deleted_at) return false;
    visited.add(current.id);
    if (!current.parent_id) return true;
    current = byId.get(current.parent_id);
  }
  return false;
}

export function productsForCategory(categoryId: string | undefined, products: Product[], categories: ProductCategory[]): Product[] {
  if (!categoryId) return [];
  return products
    .filter((product) => product.category_id === categoryId && categoryIsReachable(product.category_id, categories))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, 'ja'));
}

export function searchProducts(query: string, products: Product[], categories: ProductCategory[]): Product[] {
  const term = query.trim().toLocaleLowerCase('ja');
  if (!term) return [];
  return products.filter((product) => {
    if (!categoryIsReachable(product.category_id, categories)) return false;
    return [product.product_code, product.name, categoryPath(product.category_id, categories)]
      .join(' ')
      .toLocaleLowerCase('ja')
      .includes(term);
  });
}
