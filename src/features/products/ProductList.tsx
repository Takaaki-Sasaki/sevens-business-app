import type { Product, ProductCategory } from './types';

type ProductListProps = {
  products: Product[];
  categories: ProductCategory[];
  search: string;
  categoryFilter: string;
  loading: boolean;
  selectedId?: string;
  onSearchChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onSelect: (product: Product) => void;
  onCreate: () => void;
};

export function ProductList({ products, categories, search, categoryFilter, loading, selectedId, onSearchChange, onCategoryFilterChange, onSelect, onCreate }: ProductListProps) {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return (
    <section className="panel product-list-panel" aria-labelledby="product-list-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">PRODUCTS</p>
          <h2 id="product-list-title">商品一覧</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onCreate}>＋ 商品登録</button>
      </div>
      <div className="product-filters">
        <label className="search-field">
          <span className="visually-hidden">商品を検索</span>
          <input type="search" value={search} placeholder="商品名・商品コード・カテゴリで検索" onChange={(event) => onSearchChange(event.target.value)} />
        </label>
        <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)} aria-label="カテゴリで絞り込み">
          <option value="">すべてのカテゴリ</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{'　'.repeat(Math.max(0, category.depth - 1))}{category.name}</option>)}
        </select>
      </div>
      <div className="product-list" aria-live="polite">
        {loading && <p className="list-message">商品を読み込んでいます…</p>}
        {!loading && products.length === 0 && <p className="list-message">該当する商品はありません。</p>}
        {!loading && products.map((product) => (
          <button className={selectedId === product.id ? 'product-row selected' : 'product-row'} type="button" key={product.id} onClick={() => onSelect(product)}>
            <span className="product-row-main">
              <strong>{product.name}</strong>
              <small>{product.product_code} ・ {categoryById.get(product.category_id)?.name || 'カテゴリ未設定'}</small>
            </span>
            <span className="product-row-price">¥{product.price_yen.toLocaleString()} {!product.active && <em>停止中</em>}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

