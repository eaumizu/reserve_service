import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
it('spaces concurrent mail requests and continues after a failure',async()=>{
 vi.useFakeTimers();vi.stubEnv('NODE_ENV','production');vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('provider')).mockResolvedValueOnce(new Response('{}')));
 const {resendFetch}=await import('../lib/resend-request');
 const a=resendFetch('https://api.resend.com/emails',{}),b=resendFetch('https://api.resend.com/emails',{}).catch(()=>null),c=resendFetch('https://api.resend.com/emails',{});
 await vi.advanceTimersByTimeAsync(0);expect(fetch).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(650);expect(fetch).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(650);expect(fetch).toHaveBeenCalledTimes(3);await Promise.all([a,b,c]);
});
it('retries rate-limited idempotent sends without changing the key',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('{}',{status:429,headers:{'retry-after':'1'}})).mockResolvedValueOnce(new Response('{}')));
 const {resendFetch}=await import('../lib/resend-request');const p=resendFetch('https://api.resend.com/emails',{method:'POST',headers:{'Idempotency-Key':'notification-id'}});
 await vi.advanceTimersByTimeAsync(1000);await p;expect(fetch).toHaveBeenCalledTimes(2);expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual({'Idempotency-Key':'notification-id'});
});
it('does not retry non-idempotent domain creation',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:429})));
 const {resendFetch}=await import('../lib/resend-request');expect((await resendFetch('https://api.resend.com/domains',{method:'POST'})).status).toBe(429);expect(fetch).toHaveBeenCalledTimes(1);
});
it('starts the request timeout after waiting for earlier requests',async()=>{
 vi.useFakeTimers();vi.stubEnv('NODE_ENV','production');let release!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{release=r;})).mockResolvedValue(new Response('{}')));
 const {resendFetch}=await import('../lib/resend-request');const a=resendFetch('https://api.resend.com/domains',{}),b=resendFetch('https://api.resend.com/emails',{});
 await vi.advanceTimersByTimeAsync(7000);release(new Response('{}'));await a;await vi.advanceTimersByTimeAsync(0);await b;
 expect(vi.mocked(fetch).mock.calls[1][1]?.signal?.aborted).toBe(false);
});
it('bounds rate-limit retries',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:429})));
 const {resendFetch}=await import('../lib/resend-request');const p=resendFetch('https://api.resend.com/emails',{method:'POST',headers:{'Idempotency-Key':'notification-id'}});
 await vi.advanceTimersByTimeAsync(4000);expect((await p).status).toBe(429);expect(fetch).toHaveBeenCalledTimes(3);
});
