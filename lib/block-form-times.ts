import { isBookingDate } from "./reservations/date";
import { CLOCK_TIMES } from "./reservations/time-grid";

type Period = { startDate: string; startTime: string; endDate: string; endTime: string };
function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}
export function minimumBlockEndDate(startDate: string, startTime: string, allDay: boolean) {
  if (!isBookingDate(startDate)) return "";
  return !allDay && startTime === CLOCK_TIMES.at(-1) ? nextDay(startDate) : startDate;
}
export function blockEndTimes(period: Period) {
  if (!isBookingDate(period.startDate) || !isBookingDate(period.endDate) || period.endDate < period.startDate) return [];
  return period.endDate === period.startDate ? CLOCK_TIMES.filter(time => time > period.startTime) : CLOCK_TIMES;
}
/** Keep a valid selected end, otherwise move to the first valid quarter-hour. */
export function adjustBlockEnd<T extends Period>(period: T, allDay: boolean): T {
  if (!isBookingDate(period.startDate) || !isBookingDate(period.endDate)) return period;
  const endDate = period.endDate < period.startDate ? period.startDate : period.endDate;
  const result = { ...period, endDate };
  if (allDay) return result;
  const options = blockEndTimes(result);
  if (options.includes(result.endTime)) return result;
  if (options.length) return { ...result, endTime: options[0] };
  return { ...result, endDate: nextDay(result.startDate), endTime: "00:00" };
}
