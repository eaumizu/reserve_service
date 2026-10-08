/** Empty means no email contact; reject malformed values before creating a booking. */
export function parseCustomerEmail(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const email = value.trim();
  if (!email) return null;
  if (email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) return undefined;
  const local = email.split("@")[0];
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return undefined;
  return email;
}
