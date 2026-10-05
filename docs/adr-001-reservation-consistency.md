# ADR-001: 予約の整合性と空き枠の責務

## 決定

- `reservations` を唯一の予約正本とする。外部カレンダー等は将来の投影先であり、正本にしない。
- 空き枠計算は `lib/reservations/availability.ts` に集約し、顧客 UI・管理 UI は API を利用する。
- 予約確定は `create_reservation_atomic` PostgreSQL 関数だけで行う。スタッフごとの transaction advisory lock、バッファを含む競合照会、PostgreSQL exclusion constraint を組み合わせる。
- 各業務表には `store_id` を持たせ、JWT の `app_metadata.store_id` による RLS で店舗を隔離する。

## 理由

UI側だけで空きを判定すると、同時操作で二重予約になります。DB内で再判定・確定を一つのトランザクションにすることで、Web/電話/店頭という入口が増えても同一の保証を保てます。

## 結果

サービスロール鍵は `app/api` からのみ使い、ブラウザには渡しません。管理 UI は Supabase Dashboard ではなく専用画面として育てます。Google Calendar、LINE、WordPress、決済はこの境界の外に置き、V1には含めません。
