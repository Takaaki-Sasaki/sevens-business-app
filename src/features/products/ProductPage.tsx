import { useEffect, useState } from 'react';
import type { Profile } from '../auth/types';
import { hasPermission } from '../auth/permissions';
import { buildCategoryTree, categoryPath, descendantsOf } from './categoryTree';
import { CategoryForm } from './CategoryForm';
import { CategoryTree } from './ProductCategoryTree';
import { archiveCategoryTree, archiveProduct, listCategories, listProducts, listTaxRates } from './productApi';
import { ProductForm } from './ProductForm';
import { ProductList } from './ProductList';
import type { Product, ProductCategory, TaxRate } from './types';
import { toUserMessage } from '../../shared/lib/userError';

type MasterTab = 'categories' | 'products';
type CategoryEditor =
  | { kind: 'create'; parentId?: string }
  | { kind: 'edit'; category: ProductCategory };
type ProductEditor =
  | { kind: 'create' }
  | { kind: 'edit'; product: Product };

export function ProductPage({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<MasterTab>('categories');
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [categoryEditor, setCategoryEditor] = useState<CategoryEditor>({ kind: 'create' });
  const [productEditor, setProductEditor] = useState<ProductEditor>({ kind: 'create' });
  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      listCategories(profile.organization_id),
      listProducts(profile.organization_id),
      listTaxRates(profile.organization_id),
    ])
      .then(([nextCategories, nextProducts, nextTaxRates]) => {
        if (cancelled) return;
        setCategories(nextCategories);
        setProducts(nextProducts);
        setTaxRates(nextTaxRates);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toUserMessage(caught, { fallback: '商品マスタを取得できませんでした。' }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile.organization_id, reloadKey]);

  if (!hasPermission(profile.role, 'products.write')) {
    return <section className="panel restricted-panel"><h1>アクセスできません</h1><p>商品マスタの編集は管理者のみが行えます。</p></section>;
  }

  const categoryTree = buildCategoryTree(categories);
  const selectedCategory = categoryEditor.kind === 'edit' ? categoryEditor.category : undefined;
  const selectedProduct = productEditor.kind === 'edit' ? productEditor.product : undefined;
  const normalizedSearch = productSearch.trim().toLocaleLowerCase('ja');
  const categoryFilterIds = categoryFilter ? new Set([categoryFilter, ...descendantsOf(categoryFilter, categories)]) : undefined;
  const visibleProducts = products.filter((product) => {
    if (categoryFilterIds && !categoryFilterIds.has(product.category_id)) return false;
    if (!normalizedSearch) return true;
    const haystack = [product.product_code, product.name, categoryPath(product.category_id, categories)].join(' ').toLocaleLowerCase('ja');
    return haystack.includes(normalizedSearch);
  });

  function reload() { setReloadKey((value) => value + 1); }

  async function handleCategoryArchived() {
    if (!selectedCategory) return;
    const result = await archiveCategoryTree(selectedCategory.id);
    setCategoryEditor({ kind: 'create' });
    setProductEditor({ kind: 'create' });
    setNotice(`「${result.category_name}」以下のカテゴリ ${result.archived_category_count} 件、商品 ${result.archived_product_count} 件を削除しました。`);
    reload();
  }

  async function handleProductArchived() {
    if (!selectedProduct) return;
    const result = await archiveProduct(selectedProduct.id);
    setProductEditor({ kind: 'create' });
    setNotice(`商品「${result.product_name}」を削除しました。`);
    reload();
  }

  return (
    <section className="page-view products-page" aria-labelledby="products-page-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">PRODUCT MASTER</p>
          <h1 id="products-page-title">商品管理</h1>
          <p className="page-description">レジで使用するカテゴリ階層・商品・価格・税率を管理します。</p>
        </div>
      </header>
      <div className="master-tabs" role="tablist" aria-label="商品マスタの表示内容">
        <button type="button" role="tab" aria-selected={tab === 'categories'} className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>カテゴリツリー</button>
        <button type="button" role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>商品マスタ</button>
      </div>
      {error && <p className="form-error page-error" role="alert">{error}</p>}
      {notice && <p className="document-notice" role="status">{notice}</p>}

      {tab === 'categories' ? (
        <div className="master-workspace">
          <CategoryTree
            roots={categoryTree}
            selectedId={selectedCategory?.id}
            onSelect={(category) => setCategoryEditor({ kind: 'edit', category })}
            onCreateRoot={() => setCategoryEditor({ kind: 'create' })}
            onCreateChild={(category) => setCategoryEditor({ kind: 'create', parentId: category.id })}
          />
          <section className="panel master-editor-panel">
            {loading ? <p className="list-message">カテゴリを読み込んでいます…</p> : (
              <CategoryForm
                organizationId={profile.organization_id}
                categories={categories}
                category={selectedCategory}
                initialParentId={categoryEditor.kind === 'create' ? categoryEditor.parentId : undefined}
                onSaved={(saved) => {
                  setCategoryEditor({ kind: 'edit', category: saved });
                  setNotice(null);
                  reload();
                }}
                onArchived={handleCategoryArchived}
              />
            )}
          </section>
        </div>
      ) : (
        <div className="master-workspace">
          <ProductList
            products={visibleProducts}
            categories={categories}
            search={productSearch}
            categoryFilter={categoryFilter}
            loading={loading}
            selectedId={selectedProduct?.id}
            onSearchChange={setProductSearch}
            onCategoryFilterChange={setCategoryFilter}
            onSelect={(product) => setProductEditor({ kind: 'edit', product })}
            onCreate={() => setProductEditor({ kind: 'create' })}
          />
          <section className="panel master-editor-panel">
            {loading ? <p className="list-message">商品を読み込んでいます…</p> : (
              <ProductForm
                organizationId={profile.organization_id}
                categories={categories}
                taxRates={taxRates}
                product={selectedProduct}
                onSaved={(saved) => {
                  setProductEditor({ kind: 'edit', product: saved });
                  setNotice(null);
                  reload();
                }}
                onArchived={handleProductArchived}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}
