import { describe, expect, it } from "vitest";
import { parseCustomerEmail } from "../lib/reservations/email";

describe("booking email contact", () => {
  it.each([undefined, null, "", "   "])("allows omitted contact %j", value => {
    expect(parseCustomerEmail(value)).toBeNull();
  });
  it("trims contact without changing local part case", () => {
    expect(parseCustomerEmail(" Test+booking@example.co.jp ")).toBe("Test+booking@example.co.jp");
  });
  it.each([123, {}, "no-email", "a@", "a@b", "a b@example.com", "a@example.com\nBcc:other@example.com", "..a@example.com", "a.@example.com", "a@-example.com", `${"a".repeat(65)}@example.com`, `${"a".repeat(64)}@${"b".repeat(190)}.com`])("rejects malformed contact %j", value => {
    expect(parseCustomerEmail(value)).toBeUndefined();
  });
});
