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

describe('optional booking phone',()=>{
 it.each([undefined,null,'','   '])('normalizes an omitted phone %j to empty',async value=>{const {parseCustomerPhone}=await import('../lib/reservations/email');expect(parseCustomerPhone(value)).toBe('');});
 it('validates entered phones and normalizes full-width digits',async()=>{const {parseCustomerPhone}=await import('../lib/reservations/email');expect(parseCustomerPhone('０９０-１２３４-５６７８')).toBe('090-1234-5678');for(const v of [123,{},'abc','123\n456','x'.repeat(51)])expect(parseCustomerPhone(v)).toBeUndefined();});
});
