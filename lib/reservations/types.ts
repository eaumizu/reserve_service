export type ReservationSource = "web" | "phone" | "walk_in" | "admin";
export type ReservationStatus = "confirmed" | "cancelled" | "completed" | "no_show";
export type Service = { id: string; store_id: string; name: string; duration_minutes: number; buffer_before: number; buffer_after: number; price: number; active: boolean; online_bookable: boolean };
export type Staff = { id: string; store_id: string; name: string; active: boolean };
export type ReservationInput = { storeId: string; serviceId: string; staffId: string; startAt: string; customerName: string; customerPhone: string; source: ReservationSource; note?: string };
export type TimeRange = { start: Date; end: Date };
export type AdminReservation = {
  id: string; service_id: string; staff_id: string; start_at: string; end_at: string; updated_at: string;
  status: string; source: string; note?: string | null;
  customers: { name: string; phone?: string } | null;
  services: { name: string; buffer_after?: number } | null;
  staff: { name: string } | null;
};
