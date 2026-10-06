# 整体院 予約・店舗管理システム V1

Next.js App Router と Supabase/PostgreSQL で作る、単店舗から開始できる予約基盤です。予約データは PostgreSQL が唯一の正本であり、Web・電話・店頭・管理画面の予約はいずれも同じ原子的な DB 関数を通します。

## 起動

1. `.env.example` を `.env.local` にコピーし、Supabase Project URL、anon key、**server 専用** service-role key を設定する。
2. Supabase SQL Editor または CLI で `supabase/migrations/0001_initial.sql`、`supabase/migrations/0002_validate_reservation_schedule.sql`、`supabase/migrations/0003_grant_service_role_table_access.sql`、`supabase/migrations/0004_reschedule_reservation_atomic.sql`、続いて `supabase/seed.sql` を順に実行する。
3. `npm install`、`npm run dev` を実行して `http://localhost:3000` を開く。

`/` はお客様用の予約フロー、`/admin` はメールアドレス・パスワードでログインするスタッフ向け予約一覧です。予約データはHTMLへ埋め込まず、認証済みユーザーの `app_metadata.store_id` と `role: staff | admin` をサーバーで検証した後に、その店舗の最新100件だけを取得します。ログイン情報はメモリ内だけに保持するため、ページ再読み込み時は再ログインします。

公開用 `POST /api/reservations` は `web` のみを受け付けます。手動登録用 `POST /api/admin/reservations` にも同じ認証を適用し、`phone` / `walk_in` / `admin` を受け付けます。

ログイン後の `/admin` で電話・店頭・管理予約を登録できます。所属店舗の有効なメニュー・対応施術者・予約日を選び、開始時間は日本時間の30分刻みの空き枠から選択します。施術時間・前後バッファー・既存予約・休業ブロックを考慮して表示し、日付や担当者等を変えると時間の選択をリセットします。APIも30分刻みでない開始時刻を拒否します。確認画面から確定すると、Web予約と同じDB関数が営業時間と予約競合を再検証します。登録後は一覧と空き枠が更新されます。管理画面はオンライン予約不可のメニューも選択できます。

予約一覧の確定済み予約には「キャンセル」ボタンがあります。対象のお客様・日時を確認して確定すると、`PATCH /api/admin/reservations` が認証ユーザーの店舗かつ `confirmed` の予約だけを原子的に `cancelled` に変更し、`updated_at` を更新します。予約・顧客は削除しません。完了済み・キャンセル済み等への上書きや、別店舗の操作は受け付けません。既存の空き枠APIと予約確定関数は `confirmed` だけを占有扱いするため、キャンセル後はページ更新・再取得で枠が再び予約可能になります。追加のDBマイグレーションは不要です。

確定済み予約の「変更」から日時・担当者を変更できます。空き枠取得時は、所属店舗内の対象予約を検証したうえで、その予約だけを競合対象から除外します。お客様・メニュー・受付経路・予約IDは変えません。更新には表示時点の `updated_at` が必須で、別操作により状態が変わっていた場合は409を返します。

変更機能には **`0004_reschedule_reservation_atomic.sql` の追加適用が必要** です。既存の0001〜0003やseedは再実行しないでください。DB関数は新旧スタッフの予約作成と同じadvisory lockを取得してから元の予約行をロックし、待機中の変更と営業時間・バッファー込みの競合を再検証した後、一つのトランザクションで更新します。エラー時は元の予約を維持します。関数が未適用の場合、APIは503を返し、予約をキャンセルして作り直す等の代替処理は行いません。

## 初期管理者の登録

1. Supabase Dashboard の Authentication → Users → Add user → Create new user で管理者のメールアドレス・パスワードを登録します。Auto Confirm を選択するか、メール確認を完了してください。
2. 作成したユーザーの UUID をコピーします。Supabaseアカウント自体のログインとは別のアプリ用ユーザーです。
3. SQL Editor で以下の `管理者のユーザーUUID` を置き換えて実行します。権限は本人が編集可能な `user_metadata` ではなく、管理者専用の `app_metadata` に設定します。

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'role', 'admin',
    'store_id', '11111111-1111-1111-1111-111111111111'
  )
where id = '管理者のユーザーUUID'::uuid;
```

4. 更新版がデプロイされたURLの `/admin` を開き、登録したメールアドレスとパスワードでログインします。
5. ログアウト後、予約一覧が消えることを確認します。未ログインで `/api/admin/reservations` にアクセスすると401を返します。

Vercelが `main` をProductionブランチにしている場合、`work` ブランチへのpushはPreviewだけを更新します。本番URLを保護するにはこの変更を `main` に反映し、Productionデプロイの完了を確認してください。

## 検証

`npm run test`、`npm run typecheck`、`npm run build` を実行します。DB の競合・RLS は Supabase を接続した統合環境で追加検証します。

## 必要な実値

- Supabase Project URL / anon key / service-role key
- 本番店舗名、メニュー、施術者、営業時間
- 管理者のログイン方式と初期アカウント
- GitHub リポジトリと Vercel プロジェクト（公開時）
