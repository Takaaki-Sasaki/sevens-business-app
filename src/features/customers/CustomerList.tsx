import type { Customer } from './types';

type CustomerListProps = {
  customers: Customer[];
  search: string;
  loading: boolean;
  selectedId?: string;
  onSearchChange: (value: string) => void;
  onSelect: (customer: Customer) => void;
  onCreate: () => void;
};

export function CustomerList({ customers, search, loading, selectedId, onSearchChange, onSelect, onCreate }: CustomerListProps) {
  return (
    <section className="panel customer-list-panel" aria-labelledby="customer-list-title">
      <div className="panel-heading customer-list-heading">
        <div>
          <p className="eyebrow">CUSTOMERS</p>
          <h2 id="customer-list-title">顧客一覧</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onCreate}>＋ 顧客登録</button>
      </div>

      <label className="search-field">
        <span className="visually-hidden">顧客を検索</span>
        <input
          type="search"
          value={search}
          placeholder="顧客番号・氏名・電話番号で検索"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      <div className="customer-list" aria-live="polite">
        {loading && <p className="list-message">顧客を読み込んでいます…</p>}
        {!loading && customers.length === 0 && <p className="list-message">該当する顧客はいません。</p>}
        {!loading && customers.map((customer) => (
          <button
            type="button"
            className={selectedId === customer.id ? 'customer-row selected' : 'customer-row'}
            key={customer.id}
            onClick={() => onSelect(customer)}
          >
            <span className="customer-row-main">
              <strong>{customer.name}</strong>
              <small>{customer.customer_code}</small>
            </span>
            <span className="customer-row-contact">{customer.mobile_phone || customer.phone || '電話番号未登録'}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

