import type { ProductCategory } from '../products/types';

type PosCategoryPanelProps = {
  roots: ProductCategory[];
  selectedId?: string;
  onSelect: (categoryId: string) => void;
  onChooseOther: () => void;
};

export function PosCategoryPanel({ roots, selectedId, onSelect, onChooseOther }: PosCategoryPanelProps) {
  return (
    <section className="panel pos-category-panel" aria-labelledby="pos-category-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">STEP 1</p>
          <h2 id="pos-category-title">種別を選択</h2>
        </div>
      </div>
      <div className="pos-root-categories">
        {roots.length === 0 && <p className="list-message">有効なカテゴリがありません。</p>}
        {roots.map((category) => (
          <button
            className={selectedId === category.id ? 'pos-category-button selected' : 'pos-category-button'}
            type="button"
            key={category.id}
            onClick={() => onSelect(category.id)}
          >
            {category.name}
          </button>
        ))}
        <button className="pos-category-button other" type="button" onClick={onChooseOther}>＋ その他</button>
      </div>
    </section>
  );
}
