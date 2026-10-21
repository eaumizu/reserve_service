// Resend limits are shared by store and customer mail. Serialize within this worker;
// provider-wide limits across workers still rely on the retry queues.
let tail:Promise<void>=Promise.resolve();let nextAt=0;
export function resendFetch(url:string,init:RequestInit){
 const result=tail.then(async()=>{
  const delay=process.env.NODE_ENV==="test"?0:Math.max(0,nextAt-Date.now());
  if(delay)await new Promise(r=>setTimeout(r,delay));
  nextAt=Date.now()+650;
  return fetch(url,init);
 });
 tail=result.then(()=>undefined,()=>undefined);return result;
}
