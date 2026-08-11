import { categoryPath } from '../products/categoryTree';
import type { Product, ProductCategory } from '../products/types';

type ProductBrowserProps = {
  categories: ProductCategory[];
  currentCategory?: ProductCategory;
  childCategories: ProductCategory[];
  products: Product[];
  search: string;
  onSearchChange: (value: string) => void;
  onChooseCategory: (id: string) => void;
  onGoBack: () => void;
  onChooseProduct: (product: Product) => void;
};

export function ProductBrowser({ categories, currentCategory, childCategories, products, search, onSearchChange, onChooseCategory, onGoBack, onChooseProduct }: ProductBrowserProps) {
  const searchMode = Boolean(search.trim());
  const title = searchMode ? '商品検索結果' : currentCategory ? currentCategory.name : '商品を選択してください';
  return (
    <section className="panel pos-product-browser" aria-labelledby="pos-products-title">
      <div className="pos-product-header">
        <div>
          <p className="eyebrow">{searchMode ? 'SEARCH' : 'STEP 2 / STEP 3'}</p>
          <h2 id="pos-products-title">{title}</h2>
        </div>
        {!searchMode && currentCategory?.parent_id && <button type="button" className="text-button" onClick={onGoBack}>← 戻る</button>}
      </div>
      {!searchMode && currentCategory && <p className="breadcrumb">{categoryPath(currentCategory.id, categories)}</p>}
      <label className="pos-product-search">
        <span className="visually-hidden">商品を検索</span>
        <input type="search" value={search} placeholder="商品名・商品コード・サイズで検索" onChange={(event) => onSearchChange(event.target.value)} />
      </label>

      {!searchMode && !currentCategory && <div className="pos-empty-state">左の「種別」から選択してください。</div>}
      {!searchMode && childCategories.length > 0 && (
        <div className="pos-child-categories">
          {childCategories.map((category) => (
            <button type="button" className="pos-child-category" key={category.id} onClick={() => onChooseCategory(category.id)}>
              <span>{category.name}</span><small>次へ →</small>
            </button>
          ))}
        </div>
      )}
      {(searchMode || childCategories.length === 0) && (
        <div className="pos-product-grid">
          {products.length === 0 && <p className="pos-empty-state">{searchMode ? '商品が見つかりません。' : 'このカテゴリには有効な商品がありません。'}</p>}
          {products.map((product) => (
            <button className="pos-product-card" type="button" key={product.id} onClick={() => onChooseProduct(product)}>
              <small>{product.product_code}</small>
              <strong>{product.name}</strong>
              {searchMode && <span>{categoryPath(product.category_id, categories)}</span>}
              <b>¥{product.price_yen.toLocaleString()}</b>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

