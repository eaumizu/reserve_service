import {domainToASCII} from "node:url";
import {supabaseServer} from "./supabase-server";
export type EmailSettings={senderName:string;senderEmail:string;replyTo:string;domain:string;domainId:string|null;revision:string;status:string;records:DNSRecord[]};
export type DNSRecord={record:string;type:string;name:string;value:string;ttl:string;priority?:number;status:string};
export function emailPlatformReady(){return Boolean(process.env.RESEND_API_KEY);}
export function parseEmailSettings(body:Record<string,unknown>){
 const name=typeof body.senderName==="string"?body.senderName.trim():"";
 const email=typeof body.senderEmail==="string"?body.senderEmail.trim():"";
 const reply=typeof body.replyTo==="string"?body.replyTo.trim():"";
 const valid=(s:string)=>s.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s);
 if(!name||name.length>80||/[\r\n<>"\\]/.test(name)||!valid(email)||(reply&&!valid(reply)))throw new Error("input");
 const [local,host]=email.split("@");const domain=domainToASCII(host.toLowerCase());
 if(domain.length>253||domain.split(".").some(x=>!/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(x)))throw new Error("input");
 if(["gmail.com","googlemail.com","yahoo.co.jp","yahoo.com","outlook.com","hotmail.com","icloud.com","onboarding.resend.dev"].includes(domain))throw new Error("public_domain");
 return {senderName:name,senderEmail:`${local}@${domain}`,replyTo:reply,domain};
}
export async function resendDomain(path:string,method="GET",body?:unknown){
 if(!emailPlatformReady())throw new Error("platform");
 const r=await fetch(`https://api.resend.com/domains${path}`,{method,headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json","User-Agent":"reserve-service/1.0"},...(body?{body:JSON.stringify(body)}:{}),redirect:"error",signal:AbortSignal.timeout(6000)});
 if(!r.ok)throw new Error("provider");return r.json();
}
export function domainSnapshot(value:Record<string,unknown>,settings:Pick<EmailSettings,"domain"|"domainId">){
 if(value.name!==settings.domain||(settings.domainId&&value.id!==settings.domainId)||typeof value.id!=="string"||!/^[a-f0-9-]{36}$/i.test(value.id))throw new Error("domain_mismatch");
 const capabilities=value.capabilities as {sending?:string}|undefined;
 const verified=value.status==="verified"&&capabilities?.sending==="enabled";
 const records=(Array.isArray(value.records)?value.records:[]).filter((r):r is DNSRecord=>Boolean(r)&&typeof r.name==="string"&&typeof r.value==="string"&&typeof r.type==="string").map(r=>({record:r.record||"",type:r.type,name:r.name,value:r.value,ttl:String(r.ttl??"Auto"),...(typeof r.priority==="number"?{priority:r.priority}:{}),status:r.status||"not_started"}));
 return {domainId:value.id,status:verified?"verified":String(value.status==="verified"?"sending_disabled":value.status||"pending"),records};
}
export async function readEmailSettings(storeId:string){
 const r=await supabaseServer().rpc("get_store_email_settings",{p_store_id:storeId});if(r.error)throw new Error("database");return r.data as EmailSettings|null;
}
export async function verifiedEmailSender(storeId:string){
 const settings=await readEmailSettings(storeId);if(!settings?.domainId||settings.status!=="verified")throw new Error("unverified");
 const result=domainSnapshot(await resendDomain(`/${encodeURIComponent(settings.domainId)}`),settings);
 if(result.status!=="verified")throw new Error("unverified");
 return settings;
}
