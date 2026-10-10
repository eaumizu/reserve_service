import {expect,it} from "vitest";
import {lineMessageUrl} from "../lib/line-message-url";
it("targets only the official account and encodes the draft",()=>{const message="予約連携 "+"a".repeat(32);expect(lineMessageUrl("@shop",message)).toBe("https://line.me/R/oaMessage/%40shop/?"+encodeURIComponent(message));});
it("rejects malformed account IDs",()=>{for(const id of ["https://evil.test","@shop/?x","", "@shop#x"])expect(()=>lineMessageUrl(id,"test")).toThrow();});
