import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser } }) }));
import { authorizeStaff } from "../lib/admin-auth";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-key");
  getUser.mockReset();
});
describe("admin authorization", () => {
  it("rejects missing and malformed tokens before contacting auth", async () => {
    expect(await authorizeStaff(null)).toBeNull();
    expect(await authorizeStaff("Basic token")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });
  it("rejects an invalid token", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    expect(await authorizeStaff("Bearer fake")).toBeNull();
  });
  it("does not accept self-editable user_metadata as privileges", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user", app_metadata: {}, user_metadata: { role: "admin", store_id: "11111111-1111-1111-1111-111111111111" } } }, error: null });
    expect(await authorizeStaff("Bearer valid")).toBeNull();
  });
  it.each(["staff", "admin"])("accepts verified %s with a valid store", async role => {
    getUser.mockResolvedValue({ data: { user: { id: "user", app_metadata: { role, store_id: "11111111-1111-1111-1111-111111111111" } } }, error: null });
    expect(await authorizeStaff("Bearer valid")).toEqual({ storeId: "11111111-1111-1111-1111-111111111111", userId: "user", role });
    expect(getUser).toHaveBeenCalledWith("valid");
  });
  it.each([{ role: "customer", store_id: "11111111-1111-1111-1111-111111111111" }, { role: "admin", store_id: "bad-id" }])("rejects invalid roles or stores", async metadata => {
    getUser.mockResolvedValue({ data: { user: { id: "user", app_metadata: metadata } }, error: null });
    expect(await authorizeStaff("Bearer valid")).toBeNull();
  });
});
