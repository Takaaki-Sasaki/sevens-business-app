-- SEVENS 統合業務アプリ Phase 2: 組織・認証・共通マスタの基盤
-- Supabase SQL Editor または Supabase CLI で、トランザクション全体を一度だけ実行する。
-- auth.users は Supabase Auth が管理するため、アプリ側では public.profiles を利用する。

begin;

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'staff');
create type public.sale_status as enum ('draft', 'confirmed', 'cancelled');
create type public.invoice_status as enum ('draft', 'issued', 'paid', 'overdue', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 現在はSEVENS一社運用。全テーブルを organization_id で分離しているため、将来の複数組織化にも対応する。
insert into public.organizations (id, name, slug)
values ('d3a1e9c1-7501-4f50-8abe-72f48c0ce701', 'SEVENS', 'sevens')
on conflict (slug) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  email text not null,
  display_name text,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id),
  issuer_name text,
  postal_code text,
  address1 text,
  address2 text,
  phone text,
  fax text,
  bank_information text,
  invoice_number_prefix text not null default 'INV-',
  sale_number_prefix text not null default 'SAL-',
  tax_rounding_mode text not null default 'round' check (tax_rounding_mode in ('floor', 'round', 'ceil')),
  updated_at timestamptz not null default now()
);

insert into public.organization_settings (organization_id, issuer_name)
select id, name from public.organizations where slug = 'sevens'
on conflict (organization_id) do nothing;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_code text not null,
  name text not null,
  phone text,
  mobile_phone text,
  postal_code text,
  address1 text,
  address2 text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_code)
);

create index customers_active_search_idx on public.customers (organization_id, name, customer_code)
  where deleted_at is null;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  customer_id uuid not null references public.customers(id),
  registration_number text,
  manufacturer text,
  model_name text,
  model_code text,
  model_year integer check (model_year between 1900 and 2200),
  mileage integer check (mileage is null or mileage >= 0),
  vin text,
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vehicles_customer_idx on public.vehicles (organization_id, customer_id)
  where deleted_at is null;

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (organization_id, name, effective_from)
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  parent_id uuid references public.product_categories(id),
  name text not null,
  depth smallint not null default 1 check (depth > 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_categories_tree_idx on public.product_categories (organization_id, parent_id, sort_order, name)
  where deleted_at is null;
create unique index product_categories_sibling_name_idx
  on public.product_categories (organization_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_code text not null,
  name text not null,
  category_id uuid not null references public.product_categories(id),
  tax_rate_id uuid references public.tax_rates(id),
  price_yen bigint not null check (price_yen >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create index products_active_search_idx on public.products (organization_id, name, product_code)
  where deleted_at is null and active = true;

-- 商品コードとバーコードは別管理。JAN/EANなど複数のコードを後から追加できる。
create table public.product_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  product_id uuid not null references public.products(id),
  barcode text not null,
  barcode_type text not null default 'unknown',
  created_at timestamptz not null default now(),
  unique (organization_id, barcode)
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sale_number text not null,
  customer_id uuid references public.customers(id),
  customer_name_snapshot text,
  vehicle_id uuid references public.vehicles(id),
  sale_date date not null default current_date,
  subtotal_yen bigint not null default 0 check (subtotal_yen >= 0),
  tax_amount_yen bigint not null default 0 check (tax_amount_yen >= 0),
  total_amount_yen bigint not null default 0 check (total_amount_yen >= 0),
  primary_payment_method_id uuid references public.payment_methods(id),
  amount_received_yen bigint check (amount_received_yen is null or amount_received_yen >= 0),
  change_amount_yen bigint not null default 0 check (change_amount_yen >= 0),
  status public.sale_status not null default 'draft',
  operator_id uuid not null references public.profiles(id),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancellation_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sale_number),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create index sales_history_idx on public.sales (organization_id, sale_date desc, created_at desc)
  where deleted_at is null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sale_id uuid not null references public.sales(id),
  product_id uuid references public.products(id),
  product_code_snapshot text,
  product_name_snapshot text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price_yen bigint not null check (unit_price_yen >= 0),
  discount_yen bigint not null default 0 check (discount_yen >= 0),
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  line_subtotal_yen bigint not null check (line_subtotal_yen >= 0),
  tax_amount_yen bigint not null check (tax_amount_yen >= 0),
  line_total_yen bigint not null check (line_total_yen >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (discount_yen <= line_subtotal_yen)
);

create index sale_items_sale_idx on public.sale_items (organization_id, sale_id, sort_order);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  sale_id uuid not null references public.sales(id),
  payment_method_id uuid not null references public.payment_methods(id),
  payment_method_name_snapshot text not null,
  amount_yen bigint not null check (amount_yen >= 0),
  amount_received_yen bigint check (amount_received_yen is null or amount_received_yen >= 0),
  change_amount_yen bigint not null default 0 check (change_amount_yen >= 0),
  created_at timestamptz not null default now()
);

create index payments_sale_idx on public.payments (organization_id, sale_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  invoice_number text not null,
  source_sale_id uuid references public.sales(id),
  customer_id uuid not null references public.customers(id),
  customer_name_snapshot text not null,
  subject text,
  billing_month date,
  due_date date,
  subtotal_yen bigint not null default 0 check (subtotal_yen >= 0),
  tax_amount_yen bigint not null default 0 check (tax_amount_yen >= 0),
  total_amount_yen bigint not null default 0 check (total_amount_yen >= 0),
  status public.invoice_status not null default 'draft',
  issued_at timestamptz,
  paid_at timestamptz,
  deleted_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

-- MVPでは「売上全額から作る有効な請求」は一売上につき一件だけとする。
-- 分割請求は将来 invoice_sale_links を追加して拡張する。
create unique index invoices_one_active_source_sale_idx on public.invoices (source_sale_id)
  where source_sale_id is not null and status <> 'cancelled' and deleted_at is null;

create index invoices_history_idx on public.invoices (organization_id, status, due_date)
  where deleted_at is null;

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.invoices(id),
  source_sale_item_id uuid references public.sale_items(id),
  item_name_snapshot text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price_yen bigint not null check (unit_price_yen >= 0),
  discount_yen bigint not null default 0 check (discount_yen >= 0),
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  line_subtotal_yen bigint not null check (line_subtotal_yen >= 0),
  tax_amount_yen bigint not null check (tax_amount_yen >= 0),
  line_total_yen bigint not null check (line_total_yen >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index invoice_items_invoice_idx on public.invoice_items (organization_id, invoice_id, sort_order);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  document_type text not null check (document_type in ('estimate', 'invoice', 'receipt', 'payment_notice', 'order', 'delivery')),
  source_sale_id uuid references public.sales(id),
  source_invoice_id uuid references public.invoices(id),
  storage_path text,
  file_name text not null,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (source_sale_id is not null or source_invoice_id is not null)
);

create table public.idempotency_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  operation text not null,
  idempotency_key uuid not null,
  request_hash text,
  response_json jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, operation, idempotency_key)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_json jsonb,
  after_json jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (organization_id, entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.validate_product_category_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_org_id uuid;
  parent_depth smallint;
  creates_cycle boolean;
begin
  if new.parent_id is null then
    new.depth = 1;
    return new;
  end if;

  select organization_id, depth into parent_org_id, parent_depth
  from public.product_categories
  where id = new.parent_id;

  if parent_org_id is null or parent_org_id <> new.organization_id then
    raise exception '親カテゴリは同じ組織内の有効なカテゴリである必要があります。';
  end if;

  with recursive ancestors as (
    select id, parent_id from public.product_categories where id = new.parent_id
    union all
    select category.id, category.parent_id
    from public.product_categories category
    join ancestors on category.id = ancestors.parent_id
  )
  select exists (select 1 from ancestors where id = new.id) into creates_cycle;

  if creates_cycle then
    raise exception 'カテゴリを自分自身または子孫の下には移動できません。';
  end if;

  new.depth = parent_depth + 1;
  return new;
end;
$$;

create or replace function public.validate_vehicle_customer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  customer_org_id uuid;
begin
  select organization_id into customer_org_id from public.customers where id = new.customer_id;
  if customer_org_id is null or customer_org_id <> new.organization_id then
    raise exception '車両の顧客は同じ組織内に存在する必要があります。';
  end if;
  return new;
end;
$$;

create or replace function public.validate_product_references()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  category_org_id uuid;
  rate_org_id uuid;
begin
  select organization_id into category_org_id from public.product_categories where id = new.category_id;
  if category_org_id is null or category_org_id <> new.organization_id then
    raise exception '商品のカテゴリは同じ組織内に存在する必要があります。';
  end if;

  if new.tax_rate_id is not null then
    select organization_id into rate_org_id from public.tax_rates where id = new.tax_rate_id;
    if rate_org_id is null or rate_org_id <> new.organization_id then
      raise exception '商品の税率は同じ組織内に存在する必要があります。';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid() and active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and active = true and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sevens_organization_id uuid;
begin
  select id into sevens_organization_id from public.organizations where slug = 'sevens';
  if sevens_organization_id is null then
    raise exception 'SEVENS組織が初期化されていません。';
  end if;

  insert into public.profiles (id, organization_id, email, display_name)
  values (
    new.id,
    sevens_organization_id,
    coalesce(lower(new.email), new.id::text || '@unknown.local'),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute procedure public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
  for each row execute procedure public.set_updated_at();
create trigger vehicles_customer_check before insert or update on public.vehicles
  for each row execute procedure public.validate_vehicle_customer();
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute procedure public.set_updated_at();
create trigger tax_rates_set_updated_at before update on public.tax_rates
  for each row execute procedure public.set_updated_at();
create trigger payment_methods_set_updated_at before update on public.payment_methods
  for each row execute procedure public.set_updated_at();
create trigger product_categories_parent_check before insert or update on public.product_categories
  for each row execute procedure public.validate_product_category_parent();
create trigger product_categories_set_updated_at before update on public.product_categories
  for each row execute procedure public.set_updated_at();
create trigger products_reference_check before insert or update on public.products
  for each row execute procedure public.validate_product_references();
create trigger products_set_updated_at before update on public.products
  for each row execute procedure public.set_updated_at();
create trigger sales_set_updated_at before update on public.sales
  for each row execute procedure public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices
  for each row execute procedure public.set_updated_at();
create trigger settings_set_updated_at before update on public.organization_settings
  for each row execute procedure public.set_updated_at();

revoke all on function public.current_organization_id() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_settings enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.tax_rates enable row level security;
alter table public.payment_methods enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_barcodes enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.documents enable row level security;
alter table public.idempotency_requests enable row level security;
alter table public.audit_logs enable row level security;

create policy organization_read on public.organizations
  for select to authenticated
  using (id = public.current_organization_id());

create policy profiles_read_organization on public.profiles
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy settings_read_organization on public.organization_settings
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy settings_insert_admin on public.organization_settings
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy settings_update_admin on public.organization_settings
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy customers_read_organization on public.customers
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy customers_insert_organization on public.customers
  for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy customers_update_organization on public.customers
  for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy vehicles_read_organization on public.vehicles
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy vehicles_insert_organization on public.vehicles
  for insert to authenticated
  with check (organization_id = public.current_organization_id());
create policy vehicles_update_organization on public.vehicles
  for update to authenticated
  using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy tax_rates_read_organization on public.tax_rates
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy tax_rates_insert_admin on public.tax_rates
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy tax_rates_update_admin on public.tax_rates
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy payment_methods_read_organization on public.payment_methods
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy payment_methods_insert_admin on public.payment_methods
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy payment_methods_update_admin on public.payment_methods
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy categories_read_organization on public.product_categories
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy categories_insert_admin on public.product_categories
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy categories_update_admin on public.product_categories
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy products_read_organization on public.products
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy products_insert_admin on public.products
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy products_update_admin on public.products
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy barcodes_read_organization on public.product_barcodes
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy barcodes_insert_admin on public.product_barcodes
  for insert to authenticated
  with check (organization_id = public.current_organization_id() and public.is_admin());
create policy barcodes_update_admin on public.product_barcodes
  for update to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin())
  with check (organization_id = public.current_organization_id() and public.is_admin());

create policy sales_read_organization on public.sales
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy sale_items_read_organization on public.sale_items
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy payments_read_organization on public.payments
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy invoices_read_organization on public.invoices
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy invoice_items_read_organization on public.invoice_items
  for select to authenticated
  using (organization_id = public.current_organization_id());
create policy documents_read_organization on public.documents
  for select to authenticated
  using (organization_id = public.current_organization_id());

create policy audit_logs_read_admin on public.audit_logs
  for select to authenticated
  using (organization_id = public.current_organization_id() and public.is_admin());

commit;
