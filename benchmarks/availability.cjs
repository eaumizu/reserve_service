const {createRequire}=require('node:module');
// Isolated application-code benchmark. All provider responses are synthetic;
// no network, production credentials, database writes or real notifications.
// This excludes the Next/OpenNext server and cold start; it is not a prediction
// of the production Workers CPU time. Run both revisions on the same machine.
const {mkdirSync,mkdtempSync,rmSync,readFileSync}=require('node:fs');
const {resolve,relative,join}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
async function main(){
const root=resolve(__dirname,'..');
const source=process.argv[2]==='--source'&&process.argv[3]?resolve(process.argv[3]):root;
if(process.argv.length>2&&(source===root||process.argv.length!==4))throw new Error('Usage: node benchmarks/availability.cjs [--source baseline-directory]');
const req=createRequire(resolve(root,'package.json'));
const viteReq=createRequire(createRequire(req.resolve('vitest')).resolve('vite'));
const esbuild=viteReq('esbuild');
const cache=resolve(root,'node_modules/.cache');mkdirSync(cache,{recursive:true});
const temp=mkdtempSync(join(cache,'availability-perf-')),output=join(temp,'route.cjs');
const plugins=source!==root?[{name:'baseline-source',setup(build){build.onLoad({filter:/\.ts$/},args=>({contents:readFileSync(resolve(source,relative(root,args.path)),'utf8'),loader:'ts'}));}}]:[];
try{
await esbuild.build({stdin:{contents:`export {GET} from './app/api/availability/route'; export {NextRequest} from 'next/server'; export {encryptCalendarSecret} from './lib/google-calendar';`,resolveDir:root,loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins,logLevel:'error'});
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-key',SUPABASE_SERVICE_ROLE_KEY:'test-server-key',NEXT_PUBLIC_DEFAULT_STORE_ID:'11111111-1111-1111-1111-111111111111',GOOGLE_CALENDAR_CLIENT_ID:'test-client',GOOGLE_CALENDAR_CLIENT_SECRET:'test-only',LINE_SETTINGS_ENCRYPTION_KEY:'a'.repeat(64)});
Date.now=()=>Date.parse('2029-12-31T00:00:00Z');
const store=process.env.NEXT_PUBLIC_DEFAULT_STORE_ID,service='44444444-4444-4444-4444-444444444444';
let staffCount=1,allDay=0,cipher,counts={};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
 const r=new Request(input,init),u=new URL(r.url),table=u.pathname.split('/').at(-1);
 counts[table]=(counts[table]||0)+1;
 if(u.hostname==='oauth2.googleapis.com')return json({access_token:'test-access'});
 if(u.hostname==='www.googleapis.com')return json({items:allDay?Array.from({length:allDay},()=>({start:{date:'2030-01-01'},end:{date:'2030-01-02'}})):[{start:{dateTime:'2030-01-01T12:00:00+09:00'},end:{dateTime:'2030-01-01T13:00:00+09:00'}}],timeZone:'Asia/Tokyo'});
 if(u.hostname!=='example.supabase.co')throw new Error('unexpected destination');
 if(table==='store_calendar_credentials')return json({busyEnabled:true,revision:'rev',calendarId:'test-calendar',refreshCipher:cipher});
 if(table==='begin_store_calendar_busy')return json('test-ticket');
 if(table==='save_store_calendar_busy')return json(true);
 if(table==='stores')return json([{advance_days:30,cutoff_minutes:60}]);
 if(table==='services')return json([{id:service,duration_minutes:60,buffer_before:0,buffer_after:10}]);
 if(table==='staff_services'){
  const row=i=>({staff_id:`22222222-2222-2222-2222-${String(i+1).padStart(12,'0')}`,staff:{name:`Staff ${i}`,active:true,store_id:store}});
  const rows=Array.from({length:staffCount},(_,i)=>row(i));
  return json(u.searchParams.has('staff_id')?rows.filter(r=>'eq.'+r.staff_id===u.searchParams.get('staff_id')):rows);
 }
 if(table==='business_hours')return json([{start_time:'09:00:00',end_time:'18:00:00'}]);
 if(table==='reservations'||table==='availability_blocks')return json([]);
 throw new Error('unexpected path '+u.pathname);
};
const {GET,NextRequest,encryptCalendarSecret}=require(output);
cipher=encryptCalendarSecret(store,'test-refresh');
const call=()=>GET(new NextRequest(`https://booking.test/api/availability?serviceId=${service}&date=2030-01-01`));
 for(const scenario of [{staff:1,allDay:0},{staff:3,allDay:0},{staff:1,allDay:20}]){
  staffCount=scenario.staff;allDay=scenario.allDay;
  for(let i=0;i<20;i++){const r=await call();if(r.status!==200)throw new Error('failed '+await r.text());await r.json();}
  counts={};const times=[],cpu=process.cpuUsage();let slots;
  for(let i=0;i<100;i++){const start=performance.now();const r=await call();slots=(await r.json()).slots;if(!slots)throw new Error('failed');times.push(performance.now()-start);}
  const used=process.cpuUsage(cpu);times.sort((a,b)=>a-b);
  assert.equal(slots.length,allDay?0:24*staffCount);
  console.log(JSON.stringify({revision:source===root?'working-tree':'baseline',...scenario,slots:slots.length,slotsHash:createHash('sha256').update(JSON.stringify(slots)).digest('hex'),cpuMsPerRequest:(used.user+used.system)/1000/100,medianMs:times[50],requestsPerCall:Object.values(counts).reduce((a,b)=>a+b,0)/100}));
 }
}finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
