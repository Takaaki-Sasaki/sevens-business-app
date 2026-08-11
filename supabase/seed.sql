-- Phase 2の初期マスタ。アプリのソースコードには埋め込まない。
-- 0001_foundation.sql の実行後に適用する。

insert into public.tax_rates (organization_id, name, rate_basis_points, effective_from, sort_order)
select id, '標準税率', 1000, current_date, 10
from public.organizations where slug = 'sevens'
on conflict (organization_id, name, effective_from) do nothing;

insert into public.payment_methods (organization_id, code, name, sort_order)
select id, method.code, method.name, method.sort_order
from public.organizations
cross join (
  values
    ('cash', '現金', 10),
    ('credit_card', 'クレジットカード', 20),
    ('qr', 'QR／電子決済', 30),
    ('accounts_receivable', '掛売', 40),
    ('other', 'その他', 90)
) as method(code, name, sort_order)
where organizations.slug = 'sevens'
on conflict (organization_id, code) do nothing;
