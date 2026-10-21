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
