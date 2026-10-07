import { describe, expect, it } from "vitest";
import { parseAvailabilityBlock } from "../lib/availability-blocks";
const input = { staffId: null, startDate: "2030-01-01", endDate: "2030-01-01", startTime: "12:00", endTime: "13:00", reason: " 休憩 " };
describe("Japan-time availability blocks", () => {
  it("converts Japan-time fields and strips untrusted store fields", () => {
    expect(parseAvailabilityBlock({ ...input, storeId: "other", startAt: "bogus" }))
      .toEqual({ staffId: null, startAt: "2030-01-01T03:00:00.000Z", endAt: "2030-01-01T04:00:00.000Z", reason: "休憩" });
  });
  it("accepts a whole day and periods crossing midnight", () => {
    expect(parseAvailabilityBlock({ ...input, startTime: "00:00", endDate: "2030-01-02", endTime: "00:00", reason: "" }))
      .toEqual({ staffId: null, startAt: "2029-12-31T15:00:00.000Z", endAt: "2030-01-01T15:00:00.000Z", reason: null });
    expect(parseAvailabilityBlock({ ...input, startTime: "23:30", endDate: "2030-01-02", endTime: "00:30" })).not.toBeNull();
  });
  it.each([
    { startDate: "2030-02-30" }, { endDate: "2030-13-01" }, { startTime: "12:15" }, { endTime: "24:00" },
    { endTime: "12:00" }, { endTime: "11:30" }, { endDate: "2031-01-03" }, { reason: "a".repeat(201) },
    { staffId: "bogus" }, { staffId: undefined }, { startDate: "2030-1-1" }, { reason: null },
  ])("rejects invalid dates, ranges, minutes and scope: %j", invalid => {
    expect(parseAvailabilityBlock({ ...input, ...invalid })).toBeNull();
  });
});
