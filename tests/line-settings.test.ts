import { afterEach,describe,expect,it,vi } from "vitest";
import {parseLineSettings,validLineFriendUrl} from "../lib/line-settings";
import {encryptLineCredential,decryptLineCredential,lineEncryptionReady} from "../lib/line-settings-secret";
const valid={accountName:"店舗",friendUrl:"https://lin.ee/example",channelId:"1234567890",expectedVersion:null};
afterEach(()=>vi.unstubAllEnvs());
describe("store LINE settings",()=>{
  it("allows account information before adding credentials",()=>expect(parseLineSettings(valid)).toEqual(valid));
  it.each(["http://lin.ee/example","https://evil.test","https://line.me@evil.test","javascript:alert(1)"])("rejects unsafe friend URL %s",url=>expect(validLineFriendUrl(url)).toBe(false));
  it("requires a channel when credentials are supplied",()=>expect(parseLineSettings({...valid,channelId:"",accessToken:"secret"})).toBeNull());
  it("does not combine credential clearing with new credentials",()=>expect(parseLineSettings({...valid,clearCredentials:true,accessToken:"secret"})).toBeNull());
  it("rejects malformed versions and keys",()=>{expect(parseLineSettings({...valid,expectedVersion:"bad"})).toBeNull();vi.stubEnv("LINE_SETTINGS_ENCRYPTION_KEY","bad");expect(lineEncryptionReady()).toBe(false);expect(()=>encryptLineCredential("store","secret")).toThrow();});
  it("encrypts credentials with authenticated tenant isolation",()=>{
    vi.stubEnv("LINE_SETTINGS_ENCRYPTION_KEY","a".repeat(64));const encrypted=encryptLineCredential("store-a","secret");
    expect(encrypted).not.toContain("secret");expect(decryptLineCredential("store-a",encrypted)).toBe("secret");
    expect(()=>decryptLineCredential("store-b",encrypted)).toThrow();expect(encryptLineCredential("store-a","secret")).not.toBe(encrypted);
  });
});
