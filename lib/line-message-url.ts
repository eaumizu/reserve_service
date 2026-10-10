export function lineMessageUrl(accountId:string,message:string){
 if(!/^@[a-zA-Z0-9._-]+$/.test(accountId))throw new Error("invalid_line_id");
 return `https://line.me/R/oaMessage/${encodeURIComponent(accountId)}/?${encodeURIComponent(message)}`;
}
