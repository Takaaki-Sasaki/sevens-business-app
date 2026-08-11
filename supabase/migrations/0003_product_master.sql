-- Phase 4: 商品カテゴリ・商品マスタ
-- 0001_foundation.sql の適用後に実行する。

begin;

create sequence public.product_code_sequence start with 1 increment by 1;

create or replace function public.assign_product_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 商品コードを空欄にした場合のみ自動採番する。管理者は任意のコードを入力できる。
  if new.product_code is null or btrim(new.product_code) = '' then
    new.product_code := 'P' || lpad(nextval('public.product_code_sequence')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public.validate_product_category_has_no_active_products()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 商品を持つ末端カテゴリの下へ子カテゴリを追加する場合、商品を先に移動または停止する。
  if new.parent_id is not null and exists (
    select 1
    from public.products
    where category_id = new.parent_id
      and active = true
      and deleted_at is null
  ) then
    raise exception '商品が登録されているカテゴリには子カテゴリを追加できません。先に商品を移動または停止してください。';
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
  category_active boolean;
  category_deleted_at timestamptz;
  rate_org_id uuid;
begin
  select organization_id, active, deleted_at
    into category_org_id, category_active, category_deleted_at
  from public.product_categories
  where id = new.category_id;

  if category_org_id is null or category_org_id <> new.organization_id then
    raise exception '商品のカテゴリは同じ組織内に存在する必要があります。';
  end if;

  if new.active and (not category_active or category_deleted_at is not null) then
    raise exception '有効な商品は有効なカテゴリに紐付ける必要があります。';
  end if;

  if new.active and exists (
    select 1
    from public.product_categories
    where parent_id = new.category_id
      and deleted_at is null
  ) then
    raise exception '商品は末端カテゴリに紐付ける必要があります。';
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

create trigger products_assign_code
  before insert on public.products
  for each row execute procedure public.assign_product_code();

create trigger product_categories_leaf_check
  before insert or update of parent_id on public.product_categories
  for each row execute procedure public.validate_product_category_has_no_active_products();

create index products_category_active_idx on public.products (organization_id, category_id, sort_order, name)
  where deleted_at is null;

commit;
