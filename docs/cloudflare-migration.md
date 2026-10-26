# Cloudflare Workersへの移行

## 今回の変更と現在の状態

Next.js 15をOpenNext経由でWorkersに載せるためのコード・設定です。Vercelの予約サイト、Supabase、WordPress、Google/LINEの接続設定は、この変更だけでは切り替わりません。DB移行SQLはありません。

- 検証用Worker名: `reserve-service-staging`（wrangler.jsoncの既定）
- 本番Worker名: `reserve-service`（`--env production`）
- 前日通知Worker名: `reserve-service-reminders`。Vercel側の旧定期実行を停止した後、毎日日本時間09:00のcronを有効化。
- Next.js 15.5.28 / OpenNext 1.20.13 / Wrangler 4.152.0を固定。Node.js 22で検証する。
- API/空き枠は既存のno-store設定を維持。R2/D1/KVへのデータ移行や追加課金リソースは使わない。
- `.open-next`、`.wrangler`、`.dev.vars*`、秘密を含む`.env*`はGit管理外。
- 外部APIへの認証付き通信は`fetchWithoutRedirect`を使う。Workersで未対応の`redirect: "error"`は使わず、`manual`で受けた3xxを明示的に拒否する。Google認証・予定取得、メール、LINEと前日通知が対象。Workers用CIではnative Requestの検証を含め、Googleの予定を反映した空き枠計算までテスト応答で確認する。

## 1. アカウントと退避

まずCloudflareのWorkers Freeで検証する。アップグレードは初回デプロイの前提ではない。CPU上限の拡張を設定せず、契約プランの既定値を使う。制限が実際の利用に影響する場合は、同じアカウントのWorkers Paid（月額最低5ドル、従量超過あり）へ切り替える。ドメイン向けPro契約とは別。

既存Vercelの環境変数一覧と値、デプロイ先、Google/LINE設定URL、WordPressの埋め込みURLを安全な場所に控える。予約DBはバックアップし、同じ本番Supabaseを継続利用する。秘密の値をGit、チャット、手順書に書かない。

Cloudflareへのアクセス権がない実行環境からはアップロードできない。ダッシュボードのGitHub連携または、利用者のPCで認証済みのWranglerを使う。APIトークンをチャットに貼らない。

## 2. 検証環境を準備

機能テストには本番と分離したSupabaseプロジェクトを用意し、既存マイグレーションとテスト用データ・管理者を設定する。Googleもテスト用カレンダー、メールとLINEもテスト先を使う。本番の暗号化済み認証情報や顧客データを検証環境にコピーしない。検証WorkerはCloudflare Accessなどでアクセスを制限する（OAuthコールバック、Webhookは必要な通過設定を別途確認）。

## 3. 設定値を登録

Cloudflareはビルド設定と実行時設定が別。次の公開値3つを、Git連携の「Settings → Builds → Variables and secrets」と「Settings → Variables and Secrets」の**両方**へ対象環境ごとに登録する。実行時だけ変更しても、ブラウザー用の値は変わらないので再ビルドが必要。

| 名前 | 登録先・注意 |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | ビルドと実行時。対象のSupabase URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | ビルドと実行時。公開用anonキー |
| NEXT_PUBLIC_DEFAULT_STORE_ID | ビルドと実行時。対象の店舗ID |
| SUPABASE_SERVICE_ROLE_KEY | 実行時Secretのみ。公開用キーと混同しない |
| LINE_BOOKING_SITE_URL | 実行時。予約アプリのHTTPSオリジン（末尾パス、クエリ、#なし）。Googleコールバックや予約専用リンクの基点にも使う |
| LINE_SETTINGS_ENCRYPTION_KEY | 実行時Secret。本番は**Vercelの既存値をそのまま**。変更すると保存済みGoogle/LINE認証情報などを復号できない |
| GOOGLE_CALENDAR_CLIENT_ID | 実行時Secret。既存Google OAuthクライアントID |
| GOOGLE_CALENDAR_CLIENT_SECRET | 実行時Secret。既存Google OAuthクライアントシークレット |
| RESEND_API_KEY | 実行時Secret。既存メール用キー |
| CRON_SECRET | 実行時Secret。32文字以上。本番アプリと前日通知Workerに同じ値 |

Vercelの全変数を照合して不足がないか確認する。Google/LINEの店舗別トークンはSupabase内に保存されており、個別に再入力する方式ではない。Supabaseと暗号鍵を維持して引き継ぐ。CloudflareにはVercelの自動変数`VERCEL_PROJECT_PRODUCTION_URL`がないため、`LINE_BOOKING_SITE_URL`を必ず明示する。

初回のWorker作成でURLが確定したら、実行時`LINE_BOOKING_SITE_URL`を登録する。これはビルド時の公開値ではない。`keep_vars`を有効にしているのでCLIの再デプロイでもダッシュボードの変数を維持する。Secretは環境ごとに登録し、本番への継承を想定しない。

## 4. ビルド・検証用デプロイ

CloudflareダッシュボードでWorkers & Pages → Create application → GitHubリポジトリ`eaumizu/reserve_service`を接続する。移行用ブランチを選び、フレームワークの自動変換ではなくこのリポジトリの設定を使う。

- 検証用Worker名: `reserve-service-staging`
- Node.js: 22
- インストール: `pnpm install --frozen-lockfile`（packageManagerのバージョンを使用）
- ビルド: `pnpm cf:build`
- デプロイ: `pnpm cf:deploy:staging`
- ルートディレクトリ: リポジトリのルート
- プレビュー用の別コマンドを求められた場合も、本番のSecretを渡さない。

PCで行う場合は`pnpm install --frozen-lockfile`後、対象の公開値3つをシェル環境に設定して`pnpm cf:build`、`pnpm cf:preview`を実行する。ローカル実行時の秘密はGit対象外の`.dev.vars`に置く。アップロードは認証済みWranglerで`pnpm cf:deploy:staging`。**ビルドした環境の値とデプロイ先を一致させる。**

## 5. 検証

CIはダミー設定だけで、既存の単体/API/SQL/ブラウザテストに加え、Workers用ビルド、production dry-run、前日通知Worker dry-run、ローカルworkerdでの読み取り専用smoke検査を実行する。Cloudflareへの自動アップロードはしない。

検証環境では以下を手動でも確認する。

- PCとスマホで予約画面・管理画面・予約専用リンクが開く。
- 予約作成、日時変更、取消、店舗管理者の権限が正しい。
- テストメール、LINE連携・Webhook署名、Google OAuth再接続が動く。
- 接続した「店舗予約」カレンダーの予定あり時間だけ予約枠が閉じる。30秒の自動更新と確定時の重複拒否が動く。
- Google OAuthのcallback URIは`https://予約アプリのホスト/api/admin/calendar/callback`。審査中の本番クライアントの設定変更は影響を確認してから行い、必要に応じて検証用クライアントを使う。
- Googleの検証用HTMLが同じパスで200応答する。

### 無料枠の確認と有料への切り替え

予約画面が「空き枠を取得できません」となる場合、管理画面のGoogleカレンダー連携 → 受付停止の動作確認で確認する。失敗理由は確認ボタンの近くにも表示する。暗号鍵による復号、Googleのクライアント認証、保存済み認証の失効、予定の取得、DBへの保存などを区別する。表示は認証済み管理者だけに固定文言で返し、キー・Googleの応答本文・例外の生メッセージは表示しない。先に原因を確認し、空き枠を出すためにGoogle busyのチェックを解除しない。

Freeではアカウント全体で1日10万リクエスト、HTTP/cronとも1実行あたりCPU 10ms、外部へのサブリクエスト50回が上限。ネットワーク応答待ちはCPU時間に含まれないが、暗号処理や画面生成は含まれる。ローカル実行やCIの成功だけでは、この上限内で動く保証にはならない。

Cloudflare上へ検証用デプロイした後、WorkersのMetricsで実際のリクエスト数・CPU時間・エラーを確認する。予約・日時変更・Google busy・通知を一通り試し、複数件の前日通知も確認する。現在の通知APIは1実行で最大40件を扱うため、件数によって外部通信50回の上限に先に達する場合がある。通知を有効にする前に、想定件数で確認し、必要ならPaidへ切り替える。

CPU制限によるError 1102、1日のリクエスト上限によるError 1027、サブリクエスト超過が出る場合は切り替えを判断する。Freeのまま上限を超えても、自動でPaidへ移行する設定にはしない。

Paidへ変更する際は、同じCloudflareアカウントのWorkersプランをアップグレードする。Workerの作り直し、URL変更、APIキー再発行、Supabaseの移設は不要。今回の設定はプランの既定上限を使うため、アップグレードのためのコード変更も不要。切り替え後に同じ動作確認を行い、使用量と請求見込みを確認する。

## 6. 本番Workerを準備

URLを決める。`workers.dev`で先に検証し、必要なら所有ドメインのサブドメインをWorkerに追加する。`vercel.app`自体をCloudflareへ引き継ぐことはできない。独自ドメインを使うためにDNSを変更する場合、WordPress/XserverのAレコード、メールのMX/SPF/DKIM/DMARCなどを維持する。

本番用のビルド設定・Worker実行時設定を、既存Supabase/既存暗号鍵で登録する。**検証用のビルド成果物を本番に流用しない。** 同じソースを本番の公開値で再ビルドする。本番Git連携ではビルド`pnpm cf:build`、デプロイ`pnpm cf:deploy:production`を指定し、Worker名`reserve-service`と`production`環境を使う。最初は利用者の入口を変更せず、管理者にアクセスを制限して読み取り中心で確認する。

## 7. URLの切り替え

切り替え前に古い予約確認メール/LINEの`https://reserve-service-beryl.vercel.app/reservation#...`リンクへの対処を決める。旧ドメインを廃止すると既送信リンクが使えなくなる。旧URLの保持・パス/クエリ/フラグメントを保つ転送、または対象者へのリンク再発行が必要。Vercel Hobbyで商用転送を無期限に維持できるとは扱わない。

準備が整ったら、Googleの承認済みリダイレクトURI/必要なドメイン設定、LINEのWebhook、WordPress `https://jiyu.ai/reserve/`のiframe srcと予約/管理ボタンを新URLへ切り替える。Googleの審査中の変更に追加確認が必要かも確認する。Googleの権限追加や接続解除を移行のためだけに行わない。Supabase AuthのSite URL/許可リダイレクトURLも、新ホストを使う導線がある場合は合わせる。

WordPressのページ、プライバシーポリシー、利用規約、メールドメイン自体は引き続き既存のものを使う。

## 8. 前日通知を切り替え

前日通知の実行時刻は`0 0 * * *`（UTC 00:00 = 日本時間09:00）。予約画面の30秒更新とは別の処理。`vercel.json`の`crons`は空にしてあり、Vercelの本番デプロイと管理画面で旧ジョブの削除を確認した後、Cloudflare側を`REMINDERS_ENABLED: "true"`・毎日09:00のcronへ切り替えた。初回の自動実行と実際の配信結果はデプロイ後に確認する。

1. 空の`crons`を含む変更がVercelの本番デプロイに反映されたことを確認する。Vercelの対象プロジェクト → Settings → Cron Jobsで`/api/cron/reminders`の定期実行がなくなっていることを確認する。リポジトリ上の変更やプレビューデプロイの成功だけを停止の確認としない。
2. `reserve-service-reminders`へ本番アプリと同じ`CRON_SECRET`をSecret登録する。
3. `cloudflare/wrangler.reminders.jsonc`は`REMINDERS_ENABLED: "true"`、`triggers.crons: ["0 0 * * *"]`になっている。別環境へ導入する際も、旧スケジューラーを停止してからこの設定をデプロイする。停止する場合は`"false"`と空の`crons`へ戻し、通知用Workerを再デプロイする。
4. `pnpm cf:reminders:deploy`。service binding先`reserve-service`を確認する。public HTTPトリガーはない。Git連携の通知用Workerは、ビルド`pnpm exec wrangler deploy --dry-run --config cloudflare/wrangler.reminders.jsonc`、デプロイ`pnpm cf:reminders:deploy`、ルート`/`、プレビュービルド無効を使う。予約用Workerの再デプロイだけでは通知用の設定は反映されない。
5. Cron反映には最大15分程度かかる場合がある。次の09:00実行と管理画面の通知履歴を確認する。送信テストはテスト先・対象予約を決めて行う。

定期実行の失敗はScheduledイベント結果を確認する。通知本文や宛先、認証情報をログに出さない。ログは既定無効で、調査時に期間を区切って有効化する。送信失敗の再試行は既存の管理画面から行える。

## 9. 切り戻し・移行完了

問題時は入口/Google/LINEのURLを控えたVercel設定へ戻す。Cloudflareのcronを停止してからVercelのcronを再開する。両方を同時に動かさない。DBは同じなので旧デプロイへDBを巻き戻さない。

本番で予約・変更・取消、Google busy、メール、LINE、翌日通知を確認し、古い予約リンクの対応とWorkersのリクエスト/CPU使用量・請求見込みを確認してからVercelを停止する。WorkersのCPU上限は1実行あたりであり、月額請求の固定上限ではない。

公式資料: [OpenNext](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/) / [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) / [Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) / [Free/Paidの制限](https://developers.cloudflare.com/workers/platform/limits/)
