import {createHmac,timingSafeEqual} from "node:crypto";
export function validLineSignature(body:string,signature:string|null,secret:string){
 if(!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
 const expected=createHmac("sha256",secret).update(body).digest();const received=Buffer.from(signature,"base64");
 return received.length===expected.length&&timingSafeEqual(expected,received);
}
export function lineLinkCode(text:unknown){
 if(typeof text!=="string")return null;
 return /^予約連携 ([a-f0-9]{32})$/.exec(text.trim())?.[1]??null;
}
