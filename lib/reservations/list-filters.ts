import { isBookingDate } from "./date";

export const RESERVATION_PAGE_SIZE = 100;
export function parseReservationListFilters(params: URLSearchParams) {
  const date = params.get("date");
  const staffId = params.get("staffId");
  const pageValue = params.get("page") ?? "0";
  const search = (params.get("q") ?? "").trim();
  const searchBy = params.get("searchBy") ?? "name";
  const status = params.get("status") ?? "";
  if (date !== null && !isBookingDate(date) ||
      staffId !== null && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(staffId) ||
      !/^\d{1,5}$/.test(pageValue) || Number(pageValue) > 10000 || search.length > 100 ||
      !["name", "phone"].includes(searchBy) || !["", "confirmed", "cancelled", "completed", "no_show"].includes(status)) return null;
  const start = date === null ? null : new Date(`${date}T00:00:00+09:00`);
  return { date, staffId, search, searchBy, status, page: Number(pageValue), start: start?.toISOString() ?? null,
    end: start ? new Date(start.getTime() + 86400000).toISOString() : null };
}
/** Search literal text rather than SQL LIKE wildcards. */
export function literalSearchPattern(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
