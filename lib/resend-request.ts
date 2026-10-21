// Serialize requests within this worker. Other workers can still hit the account limit.
let tail:Promise<void>=Promise.resolve();let nextAt=0;
export class ResendRequestError extends Error {
 constructor(public readonly status:number){super(`provider_http_${status}`);}
}
export async function requireResendResponse(response:Response){
 if(!response.ok)throw new ResendRequestError(response.status);
 return response;
}
export function resendFetch(url:string,init:RequestInit){
 const result=tail.then(async()=>{
  for(let attempt=0;;attempt++){
   const delay=process.env.NODE_ENV==="test"?0:Math.max(0,nextAt-Date.now());
   if(delay)await new Promise(r=>setTimeout(r,delay));
   nextAt=Date.now()+650;
   // The request timeout starts after queueing, so other mail cannot consume it.
   const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000);
   const response=await fetch(url,{...init,signal});
   // Only retry reads or sends protected by the stable notification idempotency key.
   const safe=(init.method??"GET")==="GET"||new Headers(init.headers).has("Idempotency-Key");
   if(response.status!==429||!safe||attempt>=2)return response;
   const retryAfter=Number(response.headers.get("retry-after")??"1");
   if(!Number.isFinite(retryAfter)||retryAfter<0||retryAfter>3)return response;
   await response.body?.cancel();
   await new Promise(r=>setTimeout(r,Math.max(1000,retryAfter*1000)));
  }
 });
 tail=result.then(()=>undefined,()=>undefined);return result;
}
