import { createHash, randomBytes } from "node:crypto";
export const CUSTOMER_TOKEN = /^[a-f0-9]{64}$/;
export function createCustomerToken() { return randomBytes(32).toString("hex"); }
export function hashCustomerToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function customerManagementPath(token: string) { return `/reservation#${token}`; }
export const CUSTOMER_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export type CustomerBooking = {
  id: string; storeId: string; storeName: string; serviceId: string; serviceName: string;
  staffId: string; staffName: string; customerName: string; startAt: string; endAt: string;
  status: string; updatedAt: string; canManage: boolean;
};
