import { describe, expect, it } from "vitest";
import { canRecordOutcome } from "../lib/reservations/outcome";
const reservation = { status: "confirmed", start_at: "2030-01-01T09:00:00+09:00", end_at: "2030-01-01T10:00:00+09:00", services: { buffer_after: 15 } };
describe("attendance outcome availability", () => {
  it("waits until treatment and cleanup end before completion", () => {
    expect(canRecordOutcome(reservation, "completed", Date.parse("2030-01-01T10:00:00+09:00"))).toBe(false);
    expect(canRecordOutcome(reservation, "completed", Date.parse("2030-01-01T10:14:59+09:00"))).toBe(false);
    expect(canRecordOutcome(reservation, "completed", Date.parse("2030-01-01T10:15:00+09:00"))).toBe(true);
  });
  it("waits until the start before no-show", () => {
    expect(canRecordOutcome(reservation, "no_show", Date.parse("2030-01-01T08:59:59+09:00"))).toBe(false);
    expect(canRecordOutcome(reservation, "no_show", Date.parse(reservation.start_at))).toBe(true);
  });
  it.each(["cancelled", "completed", "no_show"])("does not overwrite an existing %s outcome", status => {
    expect(canRecordOutcome({ ...reservation, status }, "completed", Date.parse("2030-01-02T10:00:00+09:00"))).toBe(false);
  });
});
