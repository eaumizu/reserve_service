export type LineSettingsInput={accountName:string;friendUrl:string;channelId:string;expectedVersion:string|null;accessToken?:string;channelSecret?:string;clearCredentials?:boolean};
export function validLineFriendUrl(value:string){
  if(!value)return true;
  try{const url=new URL(value);return url.protocol==="https:"&&["lin.ee","line.me"].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&value.length<=500;}
  catch{return false;}
}
export function parseLineSettings(value:unknown):LineSettingsInput|null{
  if(!value||typeof value!=="object")return null;const v=value as LineSettingsInput;
  if(typeof v.accountName!=="string"||v.accountName.trim().length>100||typeof v.friendUrl!=="string"||!validLineFriendUrl(v.friendUrl.trim())||
    typeof v.channelId!=="string"||(v.channelId!==""&&!/^[0-9]{5,30}$/.test(v.channelId))||
    (v.expectedVersion!==null&&(typeof v.expectedVersion!=="string"||!(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).test(v.expectedVersion)))||
    (v.accessToken!==undefined&&(typeof v.accessToken!=="string"||v.accessToken.length>5000||/[\r\n]/.test(v.accessToken)))||
    (v.channelSecret!==undefined&&(typeof v.channelSecret!=="string"||v.channelSecret.length>500||/[\r\n]/.test(v.channelSecret)))||
    (v.clearCredentials!==undefined&&typeof v.clearCredentials!=="boolean"))return null;
  if(v.clearCredentials&&(v.accessToken?.trim()||v.channelSecret?.trim()))return null;
  if((v.accessToken?.trim()||v.channelSecret?.trim())&&!v.channelId)return null;
  return {...v,accountName:v.accountName.trim(),friendUrl:v.friendUrl.trim()};
}
