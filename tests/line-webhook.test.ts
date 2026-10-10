import {expect,it} from "vitest";
import {createHmac} from "node:crypto";
import {validLineSignature,lineLinkCode} from "../lib/line-webhook";
it("verifies exact raw body and tenant secret",()=>{const body='{"events":[]}';const sig=createHmac("sha256","tenant-secret").update(body).digest("base64");expect(validLineSignature(body,sig,"tenant-secret")).toBe(true);expect(validLineSignature(body+" ",sig,"tenant-secret")).toBe(false);expect(validLineSignature(body,sig,"other-secret")).toBe(false);expect(validLineSignature(body,null,"tenant-secret")).toBe(false);expect(validLineSignature(body,"x","tenant-secret")).toBe(false);});
it("accepts only explicit linking text and 128-bit codes",()=>{expect(lineLinkCode("予約連携 "+"a".repeat(32))).toBe("a".repeat(32));for(const text of ["a".repeat(32),"予約連携 123456","予約連携 "+"a".repeat(32)+" extra",null])expect(lineLinkCode(text)).toBeNull();});
