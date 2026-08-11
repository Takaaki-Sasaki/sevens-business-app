# SEVENS 統合業務Webアプリ：公開手順

## 公開後の利用イメージ

このシステムはネイティブのデスクトップアプリ／スマートフォンアプリではありません。

- PC：Chrome、Edge、Safariなどで公開URLを開く
- iPhone／Android：SafariまたはChromeで同じ公開URLを開く
- 顧客・商品・売上・請求はSupabaseの同じデータベースを参照する

アプリを端末へインストールする必要はありません。Web manifestはブラウザ表示モードとしており、ホーム画面ショートカットを作成する場合もブラウザ利用が基本です。

## 推奨構成

|役割|サービス|内容|
|---|---|---|
|Web配信|Vercel|React/Viteの静的ファイルをHTTPSで配信|
|認証・DB|Supabase|既存のAuth、PostgreSQL、RLS、RPCを継続利用|
|独自ドメイン（任意）|利用中のDNS事業者|例：`app.example.jp` をVercelに接続|

Vercel向けの `vercel.json` は追加済みです。ViteのSPAを公開した際も、任意URLへのアクセスを `index.html` に返す設定と、基本的なレスポンスヘッダーを含めています。

## 公開前の確認

1. `supabase/migrations/0001_foundation.sql` から `0007_document_issuance.sql` までを実行済みであることを確認します。
2. Supabase Authに利用者を作成し、対応する `profiles` レコードが有効であることを確認します。
3. 管理者の `profiles.role` が `admin` であることを確認します。
4. ローカルで次を実行し、成功することを確認します。

```sh
npm test
npm run build
```

## Vercelで公開する手順

### 1. ソースコードをGitリポジトリへ登録

GitHub、GitLab、Bitbucket、Azure DevOpsのいずれかにリポジトリを作成し、この `sevens_business_app` フォルダの内容を登録します。

`.env.local` はGitへ登録しません。`.gitignore` に含まれています。

### 2. Vercelプロジェクトを作成

1. Vercelにログインし、**Add New → Project** を選択します。
2. 上記のGitリポジトリをImportします。
3. リポジトリのルートが親フォルダの場合は、**Root Directory** に `sevens_business_app` を指定します。
4. Framework Presetは **Vite** を選択、または自動検出結果を利用します。
5. Build Commandは `npm run build`、Output Directoryは `dist` です。通常は自動設定されます。

### 3. 環境変数を設定

Vercelの **Project Settings → Environment Variables** に、以下をProductionとPreviewの両方へ設定します。

|変数名|値|
|---|---|
|`VITE_SUPABASE_URL`|Supabase Project URL|
|`VITE_SUPABASE_PUBLISHABLE_KEY`|Supabase Publishable key|

`VITE_` で始まる値はブラウザ用JavaScriptに埋め込まれます。Publishable keyは使用できますが、以下は絶対に設定しないでください。

- `service_role key`
- Supabaseのsecret key
- データベースパスワード
- 管理者用の個人情報や外部サービスの秘密鍵

環境変数を変更した場合は再デプロイが必要です。

### 4. DeployしてURLを確認

**Deploy** を実行すると、`https://...vercel.app` のURLが発行されます。

1. そのURLをPCとスマートフォンで開きます。
2. 管理者・スタッフでログインします。
3. レジでテスト会計を行い、別端末の売上履歴で同じ売上を確認します。
4. 帳票発行でPDF保存を確認します。

### 5. Supabase Authに公開URLを登録

Supabase Dashboardの **Authentication → URL Configuration** を開きます。

- **Site URL**：本番URL（例：`https://sevens-business.vercel.app`）
- **Redirect URLs**：少なくとも次を登録
  - `https://sevens-business.vercel.app/**`
  - 独自ドメインを使用する場合は `https://app.example.jp/**`
  - 開発用に `http://localhost:5173/**`

メール招待、パスワード再設定、将来のGoogleログインなどで正しいURLへ戻るために必要です。

### 6. 独自ドメインを使う場合（任意）

Vercelの **Project Settings → Domains** でドメインを追加し、画面に表示されるDNSレコードをDNS事業者側へ設定します。接続後は、Supabase AuthのSite URL・Redirect URLsにも独自ドメインを追加します。

## 公開後の更新運用

- Git連携の場合：mainブランチへの反映で本番へ自動デプロイされます。変更の確認には、まずPreview Deploymentを使用します。
- 重要なDB変更：本番デプロイ前にSQLをレビューし、Supabase SQL Editorで実行します。
- 変更後：管理者とスタッフ両方でログイン、レジ会計、請求、帳票PDFを確認します。
- ロールバック：問題があればVercelのDeployments画面から直前の正常なデプロイを再公開します。

## セキュリティと制約

- 公開URLは誰でも開けますが、データを読む・書くにはSupabaseログインが必要です。
- 利用者の追加・停止とadmin/staff権限はSupabaseの`profiles`で管理します。
- RLSとRPCが最終的に組織・利用者・ロールを検証するため、画面だけで権限を回避してデータを操作することはできません。
- 本リリースはオンライン利用が前提です。通信断時は入力を画面に残して再試行を案内しますが、完全オフライン会計は実装していません。
- Vercelの公開URLを社内利用者だけに限定する機能やIP制限は、契約プラン・運用ポリシーにより別途検討してください。
