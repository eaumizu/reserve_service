# 整体院 予約・店舗管理システム V1

Next.js App Router と Supabase/PostgreSQL で作る、単店舗から開始できる予約基盤です。予約データは PostgreSQL が唯一の正本であり、Web・電話・店頭・管理画面の予約はいずれも同じ原子的な DB 関数を通します。

## 起動

1. `.env.example` を `.env.local` にコピーし、Supabase Project URL、anon key、**server 専用** service-role key を設定する。
2. Supabase SQL Editor または CLI で `supabase/migrations/0001_initial.sql`、`supabase/migrations/0002_validate_reservation_schedule.sql`、`supabase/migrations/0003_grant_service_role_table_access.sql`、続いて `supabase/seed.sql` を順に実行する。
3. `npm install`、`npm run dev` を実行して `http://localhost:3000` を開く。

`/` はお客様用の予約フロー、`/admin` は予約一覧の骨格です。公開用 `POST /api/reservations` は `web` のみを受け付けます。手動登録用 `POST /api/admin/reservations` は Supabase Auth の Bearer token と `app_metadata` の `store_id`、`role: staff | admin` を確認してから `phone` / `walk_in` / `admin` を受け付けます。画面上のログイン・手動登録フォームは次の実装単位です。

## 検証

`npm run test`、`npm run typecheck`、`npm run build` を実行します。DB の競合・RLS は Supabase を接続した統合環境で追加検証します。

## 必要な実値

- Supabase Project URL / anon key / service-role key
- 本番店舗名、メニュー、施術者、営業時間
- 管理者のログイン方式と初期アカウント
- GitHub リポジトリと Vercel プロジェクト（公開時）
