import type { CategoryNode, ProductCategory } from './types';

export function buildCategoryTree(categories: ProductCategory[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];

  categories.forEach((category) => nodes.set(category.id, { ...category, children: [] }));
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortNodes = (items: CategoryNode[]) => {
    items.sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, 'ja'));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

export function categoryPath(categoryId: string, categories: ProductCategory[]): string {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const path: string[] = [];
  let cursor = byId.get(categoryId);
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    path.unshift(cursor.name);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return path.join(' ＞ ');
}

export function leafCategories(categories: ProductCategory[]): ProductCategory[] {
  const parentIds = new Set(categories.filter((category) => category.parent_id).map((category) => category.parent_id));
  return categories.filter((category) => !parentIds.has(category.id));
}

export function descendantsOf(categoryId: string, categories: ProductCategory[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  categories.forEach((category) => {
    if (!category.parent_id) return;
    childrenByParent.set(category.parent_id, [...(childrenByParent.get(category.parent_id) || []), category.id]);
  });
  const descendants = new Set<string>();
  const collect = (id: string) => {
    (childrenByParent.get(id) || []).forEach((childId) => {
      descendants.add(childId);
      collect(childId);
    });
  };
  collect(categoryId);
  return descendants;
}
