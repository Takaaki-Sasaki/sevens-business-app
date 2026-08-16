import type { Profile } from '../auth/types';
import { hasPermission, type Permission } from '../auth/permissions';
import { useEffect, useState } from 'react';
import { CustomerPage } from '../customers/CustomerPage';
import { countCustomers } from '../customers/customerApi';
import { ProductPage } from '../products/ProductPage';
import { PosPage } from '../pos/PosPage';
import { SalesHistoryPage } from '../sales/SalesHistoryPage';
import { getTodaySalesSummary } from '../sales/saleApi';
import { InvoicePage } from '../invoices/InvoicePage';
import { DocumentsPage } from '../documents/DocumentsPage';
import { UserManagementPage } from '../users/UserManagementPage';

export type AppRoute = 'home' | 'pos' | 'sales' | 'customers' | 'products' | 'invoices' | 'documents' | 'users';

type DashboardProps = {
  profile: Profile;
  onSignOut: () => Promise<void>;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  customerDataVersion: number;
  onCustomersChanged: () => void;
};

type NavigationItem = {
  label: string;
  description: string;
  permission: Permission;
  route?: AppRoute;
};

const navigation: NavigationItem[] = [
  { label: 'ホーム', description: '本日の状況を確認', permission: 'dashboard.read', route: 'home' },
  { label: 'レジ', description: '会計を開始', permission: 'pos.use', route: 'pos' },
  { label: '売上履歴', description: '売上・取消を確認', permission: 'sales.read', route: 'sales' },
  { label: '顧客管理', description: '顧客・車両を管理', permission: 'customers.read', route: 'customers' },
  { label: '商品管理', description: '商品・カテゴリを管理', permission: 'products.read', route: 'products' },
  { label: '請求管理', description: '請求書を管理', permission: 'invoices.read', route: 'invoices' },
  { label: '帳票発行', description: 'PDFを発行', permission: 'documents.create', route: 'documents' },
  { label: '設定', description: '発行元・税率・支払方法', permission: 'settings.write' },
];

const adminNavigation: NavigationItem[] = [
  { label: 'マスタ管理', description: '共通マスタを管理', permission: 'settings.write' },
  { label: 'ユーザー管理', description: '利用者を管理', permission: 'users.manage', route: 'users' },
];

export function Dashboard({ profile, onSignOut, route, onNavigate, customerDataVersion, onCustomersChanged }: DashboardProps) {
  const isAdmin = profile.role === 'admin';
  const [customerCount, setCustomerCount] = useState<string>('—');
  const [todaySales, setTodaySales] = useState<{ totalYen: number; count: number }>();
  const visibleNavigation: NavigationItem[] = [
    ...navigation.filter((item) => hasPermission(profile.role, item.permission)),
    ...(hasPermission(profile.role, 'users.manage') ? adminNavigation : []),
  ];

  useEffect(() => {
    let cancelled = false;
    void countCustomers(profile.organization_id)
      .then((count) => { if (!cancelled) setCustomerCount(count.toLocaleString()); })
      .catch(() => { if (!cancelled) setCustomerCount('—'); });
    return () => { cancelled = true; };
  }, [profile.organization_id, customerDataVersion]);

  useEffect(() => {
    let cancelled = false;
    if (route !== 'home') return undefined;
    void getTodaySalesSummary(profile.organization_id)
      .then((summary) => { if (!cancelled) setTodaySales(summary); })
      .catch(() => { if (!cancelled) setTodaySales(undefined); });
    return () => { cancelled = true; };
  }, [profile.organization_id, route]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <img className="sidebar-logo" src="/icons/sevens-logo.png" alt="SEVENS" />
        <nav aria-label="メインメニュー">
          {visibleNavigation.map((item) => (
            <button
              className={item.route === route ? 'nav-item active' : 'nav-item'}
              key={item.label}
              type="button"
              disabled={!item.route}
              title={item.route ? item.description : '今後のPhaseで実装予定です'}
              onClick={() => item.route && onNavigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="sign-out-button" type="button" onClick={() => void onSignOut()}>ログアウト</button>
      </aside>

      <main className="main-content">
        {route === 'customers' ? <CustomerPage profile={profile} onCustomersChanged={onCustomersChanged} /> : route === 'products' ? <ProductPage profile={profile} /> : route === 'pos' ? <PosPage profile={profile} /> : route === 'sales' ? <SalesHistoryPage profile={profile} /> : route === 'invoices' ? <InvoicePage profile={profile} /> : route === 'documents' ? <DocumentsPage profile={profile} /> : route === 'users' ? <UserManagementPage profile={profile} /> : (
          <>
        <header className="page-header">
          <div>
            <p className="eyebrow">SEVENS / HOME</p>
            <h1>おはようございます、{profile.display_name || profile.email} さん</h1>
          </div>
          <span className={`role-badge ${profile.role}`}>{isAdmin ? '管理者' : 'スタッフ'}</span>
        </header>

        <section className="summary-grid" aria-label="本日の状況">
          <SummaryCard label="本日の売上" value={todaySales ? `¥${todaySales.totalYen.toLocaleString()}` : '—'} note="確定済みの売上合計" />
          <SummaryCard label="本日の会計件数" value={todaySales ? `${todaySales.count}件` : '—'} note="確定済みの会計件数" />
          <SummaryCard label="未請求" value="—" note="請求連携はPhase 8で実装" />
          <SummaryCard label="登録顧客数" value={customerCount === '—' ? '—' : `${customerCount}件`} note="有効な顧客の登録数" />
        </section>

        <section className="phase-notice">
          <p className="eyebrow">PHASE 7</p>
          <h2>売上確定・履歴・取消を追加しました</h2>
          <p>会計確定時に売上・明細・支払情報を一括保存し、売上番号から後日明細を確認できます。</p>
        </section>
          </>
        )}
      </main>

      <nav className={isAdmin ? 'mobile-navigation with-admin' : 'mobile-navigation'} aria-label="モバイルメニュー">
        {[
          { label: 'ホーム', route: 'home' as AppRoute },
          { label: 'レジ', route: 'pos' as AppRoute },
          { label: '顧客', route: 'customers' as AppRoute },
          { label: '売上', route: 'sales' as AppRoute },
          { label: '請求', route: 'invoices' as AppRoute },
          ...(hasPermission(profile.role, 'products.read') ? [{ label: '商品', route: 'products' as AppRoute }] : []),
          ...(hasPermission(profile.role, 'users.manage') ? [{ label: '管理', route: 'users' as AppRoute }] : []),
        ].map((item) => (
          <button key={item.label} type="button" className={item.route === route ? 'active' : ''} disabled={!item.route} onClick={() => item.route && onNavigate(item.route)}>{item.label}</button>
        ))}
      </nav>
    </div>
  );
}

function SummaryCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="summary-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
