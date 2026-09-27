# SEVENS 統合業務Webアプリ

自動車整備会社SEVENS向けの、顧客・商品・レジ・売上・請求・帳票発行を統合した**ブラウザ用Webアプリ**です。

PC、iPhone、Androidのブラウザから同じURLを開いて使用します。端末ごとのアプリ配布や起動ファイルは不要で、データはSupabaseで共有します。

## 主な機能

- 顧客・車両管理
- 商品カテゴリツリー・商品マスタ管理（論理削除対応）
- レジ、自由入力の「その他」、帳票へ引き継ぐ備考、会計全体の金額・率割引、現金のお釣り計算、全会計の請求自動作成
- 売上履歴・備考の参照／修正・取消・管理者限定の完全削除
- 請求作成・備考の参照／修正・発行・入金・取消・管理者限定の完全削除
- SEVENSロゴ、レジ選択車両、独立した備考枠を表示するA4帳票のPDF保存
- 管理者によるユーザー作成・権限変更・利用停止・パスワード再設定

## 公開

公開手順は [Web公開手順](docs/Web公開手順.md) を参照してください。推奨ホスティングはVercelです。

日常操作は、図入りの [操作説明書（PDF）](docs/SEVENS_業務アプリ_操作説明書.pdf) を参照してください。

公開先には `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` を環境変数として設定します。`service_role key`、データベースパスワード、Supabaseの秘密鍵をブラウザ用環境変数やリポジトリに入れてはいけません。

## ローカル開発

Node.js 22を使用します。

```sh
cp .env.example .env.local
npm install
npm run dev
```

`.env.local` にSupabaseのURLとPublishable keyを入力します。

```sh
npm test
npm run build
```

## Supabase

マイグレーションは `supabase/migrations/` を番号順にSupabase SQL Editorで実行します。公開前に、Supabase AuthのSite URLとRedirect URLsへ公開URLを追加してください。

ユーザー管理機能はSupabase Edge Functionを使用します。導入時は [ユーザー管理の導入手順](docs/ユーザー管理_導入手順.md) に従って `admin-users` 関数をデプロイしてください。

アプリの公開URL自体はインターネットから開けますが、データへのアクセスにはログインが必要です。データのアクセス制御はSupabase Auth、Row Level Security、RPCのロール検証で行います。
