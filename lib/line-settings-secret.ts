import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
function key(){
  const value=process.env.LINE_SETTINGS_ENCRYPTION_KEY;
  if(!value||!/^[a-f0-9]{64}$/i.test(value))throw new Error("line_encryption_not_configured");
  return Buffer.from(value,"hex");
}
export function lineEncryptionReady(){return /^[a-f0-9]{64}$/i.test(process.env.LINE_SETTINGS_ENCRYPTION_KEY??"");}
export function encryptLineCredential(storeId:string,value:string){
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(),iv);cipher.setAAD(Buffer.from(storeId));
  const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),encrypted.toString("base64")].join(".");
}
export function decryptLineCredential(storeId:string,value:string){
  const [iv,tag,data,...extra]=value.split(".");if(!iv||!tag||!data||extra.length)throw new Error("invalid_line_credential");
  const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64"));decipher.setAAD(Buffer.from(storeId));decipher.setAuthTag(Buffer.from(tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8");
}
