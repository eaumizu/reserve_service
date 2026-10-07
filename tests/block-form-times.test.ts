import { describe, expect, it } from "vitest";
import { adjustBlockEnd, blockEndTimes, minimumBlockEndDate } from "../lib/block-form-times";
const period = { startDate: "2030-01-01", endDate: "2030-01-01", startTime: "12:00", endTime: "13:00" };
describe("closure end choices", () => {
  it("offers only strictly later times on the same day", () => {
    const times = blockEndTimes(period);
    expect(times[0]).toBe("12:15");
    expect(times).not.toContain("12:00"); expect(times).not.toContain("11:45");
  });
  it("moves an invalid end to the next quarter-hour when the start changes", () => {
    expect(adjustBlockEnd({ ...period, startTime: "13:15" }, false).endTime).toBe("13:30");
    expect(adjustBlockEnd(period, false)).toEqual(period);
  });
  it("allows earlier clock times on a later date", () => {
    const overnight = { ...period, endDate: "2030-01-02", endTime: "00:00" };
    expect(blockEndTimes(overnight)[0]).toBe("00:00");
    expect(adjustBlockEnd(overnight, false)).toEqual(overnight);
  });
  it("repairs the end when dates move forward or back", () => {
    expect(adjustBlockEnd({ ...period, startDate: "2030-01-03", endTime: "10:00" }, false))
      .toEqual({ ...period, startDate: "2030-01-03", endDate: "2030-01-03", endTime: "12:15" });
    expect(adjustBlockEnd({ ...period, endTime: "10:00" }, false).endTime).toBe("12:15");
  });
  it("rolls 23:45 over to midnight on the next day including year boundaries", () => {
    const late = { ...period, startDate: "2030-12-31", endDate: "2030-12-31", startTime: "23:45" };
    expect(adjustBlockEnd(late, false)).toEqual({ ...late, endDate: "2031-01-01", endTime: "00:00" });
    expect(minimumBlockEndDate(late.startDate, late.startTime, false)).toBe("2031-01-01");
  });
  it("permits same-day all-day periods, and repairs hidden times when all-day is turned off", () => {
    const input = { ...period, startTime: "23:45" };
    expect(adjustBlockEnd(input, true)).toEqual(input);
    expect(minimumBlockEndDate(input.startDate, input.startTime, true)).toBe(input.startDate);
    expect(adjustBlockEnd(input, false).endDate).toBe("2030-01-02");
  });
  it("waits for complete dates instead of inventing dates after clearing a field", () => {
    const empty = { ...period, endDate: "" };
    expect(blockEndTimes(empty)).toEqual([]);
    expect(adjustBlockEnd(empty, false)).toEqual(empty);
  });
});
