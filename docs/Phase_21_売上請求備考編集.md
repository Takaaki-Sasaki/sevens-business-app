# Phase 21 売上・請求の備考編集

## 実装前

### 今回実装する内容

- 売上履歴の詳細画面でレジ備考を参照・修正する
- 請求管理の詳細画面で備考を参照・修正する
- 売上由来の請求では、どちらから修正しても売上・請求の備考を同期する
- 管理者とスタッフの双方が、閲覧可能な売上・請求の備考を修正できるようにする

### DB変更

- `update_sale_notes` RPCを追加
- `update_invoice_notes` RPCを追加
- 組織境界、有効ユーザー、5,000文字制限をDB側でも検証
- 備考変更前後と同期件数を監査ログへ保存

### 変更予定ファイル

- 権限定義
- 売上・請求API
- 売上履歴・請求管理の詳細画面
- 共通スタイル
- Supabaseマイグレーション
- 権限・APIペイロードの単体テスト

### 注意点

- 売上と売上由来請求の備考は常に同じ内容へ同期する
- 手動請求の備考は請求だけを更新する
- 空欄で保存した場合は `NULL` として扱う
- 帳票は請求または売上の最新備考をそのまま使用する

## 実装後

### 実装した内容

- 両詳細画面に5,000文字対応の備考編集欄と保存ボタンを追加
- スタッフ・管理者の双方へ備考更新権限を追加
- 売上側の更新を紐づく請求へ、請求側の更新を元売上へ同期
- 更新内容を再取得し、詳細画面と帳票へ反映するようにした
- モバイルでは文字数・補足表示と保存ボタンを縦並びにした

### 作成・変更したファイル

- `supabase/migrations/0014_transaction_notes_edit.sql`
- `src/features/auth/permissions.ts`
- `src/features/sales/saleApi.ts`
- `src/features/sales/SalesHistoryPage.tsx`
- `src/features/sales/SaleDetailPanel.tsx`
- `src/features/invoices/invoiceApi.ts`
- `src/features/invoices/InvoicePage.tsx`
- `src/features/invoices/InvoiceDetailPanel.tsx`
- `src/shared/styles/global.css`
- `tests/unit/saleApi.test.ts`
- `tests/unit/invoiceApi.test.ts`
- `tests/unit/permissions.test.ts`
- `README.md`

### DB変更

Supabase SQL Editorで `0014_transaction_notes_edit.sql` を実行する。

### 動作確認方法

1. レジで備考付きの会計を登録する。
2. 売上履歴で該当売上を開き、備考を変更して保存する。
3. 請求管理で紐づく請求を開き、同じ備考が表示されることを確認する。
4. 請求側で備考を再変更し、売上履歴側にも反映されることを確認する。
5. 帳票プレビューで更新後の備考が出力されることを確認する。
6. 備考を空欄にして保存し、帳票の枠だけが残ることを確認する。

### テスト結果

- `npm test`：12ファイル、50テストすべて成功
- `npm run build`：成功
- Viteの単一チャンクサイズ警告は継続しているが、今回の機能・型・ビルドにはエラーなし

### 次Phase

実機で管理者・スタッフ双方の保存操作と帳票への反映を確認する。
