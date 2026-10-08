import { describe, expect, it } from "vitest";
import { literalSearchPattern, parseReservationListFilters } from "../lib/reservations/list-filters";
describe("reservation search parsing", () => {
  it("retains Japanese names and punctuation as search values", () => {
    const value = ' 山田, (太郎) "確認" ';
    const result = parseReservationListFilters(new URLSearchParams({ q: value, searchBy: "name", status: "no_show" }));
    expect(result?.search).toBe(value.trim()); expect(result?.status).toBe("no_show");
  });
  it("treats empty input as no search while preserving date and staff filters", () => {
    const result = parseReservationListFilters(new URLSearchParams({ q: "  ", date: "2030-01-01", staffId: "11111111-1111-4111-8111-111111111111" }));
    expect(result?.search).toBe(""); expect(result?.start).toBe("2029-12-31T15:00:00.000Z"); expect(result?.staffId).toBeTruthy();
  });
  it("escapes LIKE wildcard characters without building raw OR filters", () => {
    expect(literalSearchPattern("%_\\")).toBe("%\\%\\_\\\\%");
  });
});
