import { useEffect, useState } from 'react';
import { listCustomers } from '../customers/customerApi';
import type { Customer } from '../customers/types';
import { toUserMessage } from '../../shared/lib/userError';

type CustomerSelectorProps = {
  organizationId: string;
  selectedCustomer?: Customer;
  onSelect: (customer: Customer) => void;
  onClear: () => void;
  onCreateCustomer: () => void;
};

export function CustomerSelector({ organizationId, selectedCustomer, onSelect, onClear, onCreateCustomer }: CustomerSelectorProps) {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setCustomers([]);
      setError(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void listCustomers(organizationId, query)
        .then((data) => { if (!cancelled) setCustomers(data.slice(0, 8)); })
        .catch((caught: unknown) => { if (!cancelled) setError(toUserMessage(caught, { fallback: '顧客を検索できませんでした。' })); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [organizationId, query]);

  function chooseCustomer(customer: Customer) {
    onSelect(customer);
    setQuery('');
    setCustomers([]);
  }

  return (
    <section className="pos-customer" aria-labelledby="pos-customer-title">
      <div className="pos-section-heading">
        <div>
          <p className="eyebrow">CUSTOMER</p>
          <h2 id="pos-customer-title">顧客</h2>
        </div>
        <button type="button" className="text-button" onClick={onCreateCustomer}>＋ 新規登録</button>
      </div>

      {selectedCustomer ? (
        <div className="selected-customer-card">
          <div>
            <strong>{selectedCustomer.name}</strong>
            <p>{selectedCustomer.customer_code} ・ {selectedCustomer.mobile_phone || selectedCustomer.phone || '電話番号未登録'}</p>
          </div>
          <button type="button" className="text-button" onClick={onClear}>変更</button>
        </div>
      ) : (
        <p className="customer-hint">必要に応じて会計する顧客を選択してください。</p>
      )}

      <label className="pos-customer-search">
        <span className="visually-hidden">顧客を検索</span>
        <input
          type="search"
          value={query}
          placeholder="顧客番号・氏名・電話番号"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {loading && <p className="compact-message">検索中…</p>}
      {error && <p className="form-error">{error}</p>}
      {!loading && query.trim() && customers.length === 0 && !error && <p className="compact-message">該当する顧客はいません。</p>}
      {customers.length > 0 && (
        <div className="customer-search-results">
          {customers.map((customer) => (
            <button type="button" key={customer.id} onClick={() => chooseCustomer(customer)}>
              <strong>{customer.name}</strong>
              <small>{customer.customer_code} ・ {customer.mobile_phone || customer.phone || '電話番号未登録'}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
