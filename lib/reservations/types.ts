export type ReservationSource = "web" | "phone" | "walk_in" | "admin";
export type ReservationStatus = "confirmed" | "cancelled" | "completed" | "no_show";
export type Service = { id: string; store_id: string; name: string; duration_minutes: number; buffer_before: number; buffer_after: number; price: number; active: boolean; online_bookable: boolean };
export type Staff = { id: string; store_id: string; name: string; active: boolean };
export type ReservationInput = { storeId: string; serviceId: string; staffId: string; startAt: string; customerName: string; customerPhone: string; source: ReservationSource; note?: string };
export type TimeRange = { start: Date; end: Date };
