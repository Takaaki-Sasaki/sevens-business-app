-- Phase 3: 顧客・車両管理
-- 0001_foundation.sql の適用後に実行する。

begin;

create sequence public.customer_code_sequence start with 1 increment by 1;

create or replace function public.assign_customer_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_code is null or btrim(new.customer_code) = '' then
    new.customer_code := 'C' || lpad(nextval('public.customer_code_sequence')::text, 6, '0');
  end if;
  return new;
end;
$$;

create or replace function public.protect_customer_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_code is distinct from old.customer_code then
    raise exception '顧客番号は変更できません。';
  end if;
  return new;
end;
$$;

create trigger customers_assign_code
  before insert on public.customers
  for each row execute procedure public.assign_customer_code();

create trigger customers_protect_code
  before update on public.customers
  for each row execute procedure public.protect_customer_code();

-- 顧客番号・氏名・電話番号での一覧検索を補助する。
create index customers_phone_active_idx on public.customers (organization_id, phone)
  where deleted_at is null;
create index customers_mobile_phone_active_idx on public.customers (organization_id, mobile_phone)
  where deleted_at is null;

commit;
