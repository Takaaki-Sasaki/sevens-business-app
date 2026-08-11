# Phase 2 セットアップ手順

## 実装済みの範囲

- React + TypeScript + Vite によるPWAの土台
- Supabaseのメール・パスワードログイン画面
- `admin` / `staff` のクライアント側表示制御
- 組織、利用者、顧客、車両、商品、売上、請求、帳票、監査用テーブルの初期SQL
- RLSによる組織単位のデータ分離
- 税率・支払方法のSeed SQL

## Supabaseへ適用する手順

1. Supabase Dashboardで対象プロジェクトを開き、SQL Editorを開きます。
2. `supabase/migrations/0001_foundation.sql` の内容を実行します。
3. 続けて `supabase/seed.sql` の内容を実行します。
4. 顧客・車両管理も利用する場合は `supabase/migrations/0002_customers_and_vehicles.sql` を実行します。
5. 商品マスタも利用する場合は `supabase/migrations/0003_product_master.sql`、続けて `supabase/seed_product_categories.sql` を実行します。
6. Authenticationでメール・パスワードの利用を有効にします。社内運用では、一般の新規登録は無効にし、管理者からの招待のみを許可してください。
7. DashboardのAuthenticationから初期管理者のメールアドレスを招待または作成します。
8. 初期管理者が一度ログインした後、`supabase/bootstrap-admin.sql.example` のメールアドレスを置き換えて実行します。

初期ユーザーは安全側に倒して `staff` として作成されます。SQL実行による昇格前に、勝手に管理者になることはありません。

## ローカル起動

```bash
cd sevens_business_app
cp .env.example .env.local
# .env.local にSupabase URLとPublishable keyを設定
npm install
npm run dev
```

`npm run build` で本番用の静的ファイルを `dist/` に作成します。デプロイ先はPhase 11で確定します。

## 注意点

- Publishable keyはクライアントに配置可能ですが、`service_role` keyやDBパスワードは絶対に配置しません。
- 会計確定の書込みはPhase 7でRPCに限定します。現時点のRLSでは売上・請求への直接書込みを許可していません。
- PWAのオフライン対応は画面資産のキャッシュのみです。未送信会計のキューはPhase 12で扱います。
