import type { CategoryNode, ProductCategory } from './types';

type CategoryTreeProps = {
  roots: CategoryNode[];
  selectedId?: string;
  onSelect: (category: ProductCategory) => void;
  onCreateRoot: () => void;
  onCreateChild: (category: ProductCategory) => void;
};

export function CategoryTree({ roots, selectedId, onSelect, onCreateRoot, onCreateChild }: CategoryTreeProps) {
  return (
    <section className="panel category-tree-panel" aria-labelledby="category-tree-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CATEGORY TREE</p>
          <h2 id="category-tree-title">商品カテゴリ</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onCreateRoot}>＋ 種別を追加</button>
      </div>
      <p className="panel-description">種別・サイズ・メーカーなど、必要な階層を自由に追加できます。</p>
      <div className="category-tree" role="tree" aria-label="商品カテゴリツリー">
        {roots.length === 0 && <p className="list-message">カテゴリがありません。「種別を追加」から作成してください。</p>}
        {roots.map((node) => (
          <CategoryBranch
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
          />
        ))}
      </div>
    </section>
  );
}

function CategoryBranch({ node, selectedId, onSelect, onCreateChild }: {
  node: CategoryNode;
  selectedId?: string;
  onSelect: (category: ProductCategory) => void;
  onCreateChild: (category: ProductCategory) => void;
}) {
  return (
    <div className="category-branch" role="treeitem" aria-expanded={node.children.length > 0}>
      <div className={node.id === selectedId ? 'category-node selected' : 'category-node'}>
        <button type="button" className="category-select" onClick={() => onSelect(node)}>
          <span className="category-node-name">{node.name}</span>
          {!node.active && <span className="status-chip muted">停止中</span>}
          <small>第{node.depth}階層</small>
        </button>
        <button type="button" className="category-add-child" onClick={() => onCreateChild(node)} aria-label={`${node.name}の下にカテゴリを追加`}>＋</button>
      </div>
      {node.children.length > 0 && (
        <div className="category-children" role="group">
          {node.children.map((child) => (
            <CategoryBranch key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} onCreateChild={onCreateChild} />
          ))}
        </div>
      )}
    </div>
  );
}

