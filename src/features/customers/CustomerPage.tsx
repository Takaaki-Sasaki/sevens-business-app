import { useEffect, useState } from 'react';
import type { Profile } from '../auth/types';
import { archiveCustomer, listCustomers } from './customerApi';
import { CustomerForm } from './CustomerForm';
import { CustomerList } from './CustomerList';
import type { Customer } from './types';
import { VehicleManager } from './VehicleManager';
import { toUserMessage } from '../../shared/lib/userError';

type CustomerPageProps = {
  profile: Profile;
  onCustomersChanged: () => void;
};

type Editor =
  | { kind: 'create' }
  | { kind: 'edit'; customer: Customer };

export function CustomerPage({ profile, onCustomersChanged }: CustomerPageProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor>({ kind: 'create' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void listCustomers(profile.organization_id, search)
        .then((data) => {
          if (!cancelled) setCustomers(data);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(toUserMessage(caught, { fallback: '顧客一覧を取得できませんでした。' }));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [profile.organization_id, search, refreshKey]);

  function refresh() {
    setRefreshKey((value) => value + 1);
    onCustomersChanged();
  }

  function handleSaved(customer: Customer) {
    setEditor({ kind: 'edit', customer });
    refresh();
  }

  async function handleArchive(customer: Customer) {
    if (!window.confirm(`顧客「${customer.name}」を一覧から停止しますか？\n過去の売上・請求データは削除されません。`)) return;
    setError(null);
    try {
      await archiveCustomer(customer.id);
      setEditor({ kind: 'create' });
      refresh();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: '顧客を停止できませんでした。', retryAction: '顧客を停止' }));
    }
  }

  const selectedCustomer = editor.kind === 'edit' ? editor.customer : undefined;

  return (
    <section className="page-view customers-page" aria-labelledby="customers-page-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">CUSTOMERS / VEHICLES</p>
          <h1 id="customers-page-title">顧客管理</h1>
          <p className="page-description">顧客と所有車両を一元管理します。停止しても過去のデータは保持されます。</p>
        </div>
      </header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}

      <div className="customer-workspace">
        <CustomerList
          customers={customers}
          loading={loading}
          search={search}
          selectedId={selectedCustomer?.id}
          onSearchChange={setSearch}
          onSelect={(customer) => setEditor({ kind: 'edit', customer })}
          onCreate={() => setEditor({ kind: 'create' })}
        />

        <section className="panel customer-editor-panel">
          <CustomerForm
            organizationId={profile.organization_id}
            customer={selectedCustomer}
            onSaved={handleSaved}
          />
          {selectedCustomer && (
            <>
              <VehicleManager organizationId={profile.organization_id} customerId={selectedCustomer.id} />
              <div className="archive-customer-row">
                <div>
                  <strong>顧客を停止</strong>
                  <p>顧客一覧やレジの選択候補から除外します。物理削除は行いません。</p>
                </div>
                <button type="button" className="danger-button" onClick={() => void handleArchive(selectedCustomer)}>顧客を停止</button>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
