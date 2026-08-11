-- Phase 4 初期カテゴリ。0003_product_master.sql の適用後に実行する。
-- 商品そのものは会社ごとの取扱品目に応じて商品管理画面から登録する。

with org as (
  select id from public.organizations where slug = 'sevens'
)
insert into public.product_categories (organization_id, name, sort_order)
select org.id, category.name, category.sort_order
from org
cross join (
  values
    ('タイヤ', 10),
    ('オイル', 20),
    ('バッテリー', 30),
    ('部品', 40),
    ('作業', 50)
) as category(name, sort_order)
on conflict do nothing;

with org as (
  select id from public.organizations where slug = 'sevens'
), categories as (
  select category.id, category.name, category.organization_id
  from public.product_categories category
  join org on org.id = category.organization_id
  where category.parent_id is null
)
insert into public.product_categories (organization_id, parent_id, name, sort_order)
select categories.organization_id, categories.id, child.name, child.sort_order
from categories
join (
  values
    ('タイヤ', '13インチ', 10),
    ('タイヤ', '14インチ', 20),
    ('タイヤ', '15インチ', 30),
    ('タイヤ', '16インチ', 40),
    ('タイヤ', '17インチ', 50),
    ('タイヤ', '18インチ', 60),
    ('タイヤ', '19インチ', 70),
    ('タイヤ', '20インチ以上', 80),
    ('オイル', 'エンジンオイル', 10),
    ('オイル', 'ATF/CVTF', 20),
    ('オイル', 'デフオイル', 30),
    ('オイル', 'ブレーキフルード', 40),
    ('バッテリー', '規格別', 10),
    ('部品', 'ワイパー', 10),
    ('部品', 'エアコンフィルター', 20),
    ('部品', 'ランプ類', 30),
    ('部品', 'その他', 90),
    ('作業', 'タイヤ交換', 10),
    ('作業', 'オイル交換', 20),
    ('作業', 'バッテリー交換', 30),
    ('作業', '点検', 40),
    ('作業', '整備', 50),
    ('作業', 'その他', 90)
) as child(parent_name, name, sort_order) on categories.name = child.parent_name
on conflict do nothing;
