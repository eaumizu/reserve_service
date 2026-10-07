export type ReservationOutcome = "completed" | "no_show";
export function canRecordOutcome(reservation: { status: string; start_at: string; end_at: string; services: { buffer_after?: number } | null }, outcome: ReservationOutcome, now = Date.now()) {
  const eligibleAt = outcome === "completed" ? Date.parse(reservation.end_at) + (reservation.services?.buffer_after ?? 0) * 60000 : Date.parse(reservation.start_at);
  return reservation.status === "confirmed" && Number.isFinite(eligibleAt) && eligibleAt <= now;
}
