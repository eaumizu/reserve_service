export type CalendarBusyStage = "settings" | "configuration" | "begin" | "decrypt" | "google_auth" | "google_events" | "bookings" | "events" | "save";
export type CalendarAuthReason = "invalid_client" | "invalid_grant" | "other";

export class CalendarAuthError extends Error {
  constructor(readonly reason: CalendarAuthReason = "other") { super("google_auth_failed"); }
}
export class CalendarBusyError extends Error {
  constructor(readonly stage: CalendarBusyStage, readonly reason?: CalendarAuthReason | "subrequests") { super("calendar_busy_unavailable"); }
}
export function busyFailure(stage: CalendarBusyStage, error: unknown) {
  const reason = error instanceof CalendarAuthError ? error.reason :
    error instanceof Error && /too many subrequests/i.test(error.message) ? "subrequests" : undefined;
  return new CalendarBusyError(stage, reason);
}
// Administrator diagnostics use fixed categories only. Never return provider bodies,
// tokens, exception messages, calendar identifiers or customer data.
export function calendarBusyDiagnostic(error: unknown) {
  if (!(error instanceof CalendarBusyError)) return { diagnosticCode: "calendar_check_failed", error: "Google連携を確認できません。時間をおいて再度確認してください。" };
  if (error.reason === "subrequests") return { diagnosticCode: "calendar_subrequest_limit", error: "受付停止の確認中に外部通信回数の上限に達しました。Cloudflareの実行結果とプラン上限を確認してください。" };
  if (error.stage === "google_auth" && error.reason === "invalid_client") return { diagnosticCode: "calendar_google_invalid_client", error: "Googleがクライアント認証を拒否しました。移行元と同じGOOGLE_CALENDAR_CLIENT_ID・GOOGLE_CALENDAR_CLIENT_SECRETか確認してください。" };
  if (error.stage === "google_auth" && error.reason === "invalid_grant") return { diagnosticCode: "calendar_google_invalid_grant", error: "Googleが保存済みの接続認証を受け付けませんでした。移行元と同じOAuthクライアントか、認証が期限切れ・解除されていないか確認してください。" };
  const messages: Record<CalendarBusyStage, string> = {
    settings: "Google接続設定をデータベースから読み取れません。接続設定を確認してください。",
    configuration: "Google連携に必要な環境変数を確認してください。クライアントID・シークレットと64文字の暗号鍵が必要です。",
    begin: "Google予定の確認を開始できません。データベースの連携設定を確認してください。",
    decrypt: "保存済みのGoogle接続情報を復号できません。LINE_SETTINGS_ENCRYPTION_KEYが移行元と同じ値か確認してください。",
    google_auth: "Googleの認証情報を取得できません。接続用の設定とGoogleへの通信状況を確認してください。",
    google_events: "Googleの予定を取得できません。接続先カレンダーへのアクセス権限と通信状況を確認してください。",
    bookings: "Google予定と照合する予約データを取得できません。時間をおいて再度確認してください。",
    events: "Google予定の日時を読み取れません。予定の日付とタイムゾーンを確認してください。",
    save: "受付停止の確認結果を保存できません。同時に確認している画面を閉じて再度お試しください。",
  };
  return { diagnosticCode: `calendar_${error.stage}_failed`, error: messages[error.stage] };
}
