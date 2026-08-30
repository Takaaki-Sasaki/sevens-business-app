# Phase 17 レジ請求自動作成・請求先顧客の任意化

## 実装内容

- 現金・カード・QR／電子決済・掛売・その他のすべてのレジ会計で、売上と請求を同時作成
- レジで顧客を選択していない場合も、売上と請求を登録可能
- 手動請求の顧客選択を任意化
- 顧客未設定の請求を、一覧・詳細・編集・帳票で安全に表示
- 売上由来の請求に、会計時の支払方法をスナップショット保存
- 顧客未設定の請求書PDFでは宛名と敬称を空欄表示

## DB変更

Supabase SQL Editorで、次のmigrationを実行します。

```text
supabase/migrations/0010_pos_auto_invoice_and_optional_customer.sql
```

変更内容は次のとおりです。

- `invoices.customer_id` の `NOT NULL` を解除
- `invoices.customer_name_snapshot` の `NOT NULL` を解除
- `invoices.payment_method_id` を追加
- `invoices.payment_method_name_snapshot` を追加
- `create_invoice_from_sale_internal()` を顧客未設定対応へ更新
- `checkout_sale_with_invoice()` を全支払方法の請求自動作成へ更新
- `create_manual_invoice()` と `update_manual_invoice()` を顧客任意へ更新

既存の請求データは更新・削除されません。RLSポリシーは組織単位の参照制御のままで要件を満たすため、変更していません。

## 登録処理

```text
レジで会計確定
  ↓
checkout_sale_with_invoice RPC
  ├─ 売上を作成
  ├─ 売上明細を作成
  ├─ 支払情報を作成
  └─ 売上を元に請求・請求明細を作成
```

すべてが1回のRPC呼び出しとDBトランザクション内で処理されます。請求作成に失敗した場合は、売上・売上明細・支払もロールバックされます。

## 二重登録防止

- 会計の `idempotency_key` により、ボタン連打や通信再送時の売上重複を防止
- 請求作成前に対象売上行をロック
- `invoices.source_sale_id` の既存一意インデックスにより、有効な請求は1売上につき1件に制限
- 掛売専用の分岐を廃止し、すべての会計を同じ請求作成処理へ統一

## テスト結果

```text
npm test
Test Files  11 passed
Tests       37 passed

npm run build
成功
```

## SQL適用後の手動確認

1. 顧客ありの現金会計を行い、完了画面に請求番号が表示されることを確認します。
2. 顧客なしの現金会計を行い、売上と請求が各1件作成されることを確認します。
3. 顧客あり・なしの掛売を行い、それぞれ請求が1件だけ作成されることを確認します。
4. 請求登録画面で顧客を選択せず、自由記述明細を登録します。
5. 顧客未設定の請求を一覧・詳細・編集画面で開きます。
6. 顧客未設定の請求から請求書を選び、PDFプレビューとPDF保存を確認します。
7. 顧客ありの従来請求で、発行・入金・取消が行えることを確認します。

## 適用順序

DBに新しい列とRPCが必要なため、公開時は次の順序で反映します。

1. Supabase SQL Editorで `0010_pos_auto_invoice_and_optional_customer.sql` を実行
2. GitHubへフロントエンド変更を反映
3. Vercelのデプロイ完了後に上記の手動確認を実施
