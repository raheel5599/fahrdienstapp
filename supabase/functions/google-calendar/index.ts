import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {syncEvent,verifyCalendar} from './events.js';

const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply = (status:number, body:unknown) => Response.json(body,{status,headers:cors});
const encode = (data:Uint8Array) => btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const json64 = (value:unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));
let cached:{token:string,until:number}|undefined;
function credentials() {
  let value;
  try { value=JSON.parse(Deno.env.get('GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON') || '{}'); }
  catch { throw Error('Die Konfiguration des Google-Dienstkontos ist ungültig.'); }
  if (!value.client_email || !value.private_key) throw Error('Der Google-Kalender-Dienst ist noch nicht eingerichtet.');
  return value;
}
async function accessToken() {
  if (cached && cached.until>Date.now()) return cached.token;
  const account=credentials(), now=Math.floor(Date.now()/1000);
  const input=json64({alg:'RS256',typ:'JWT'})+'.'+json64({iss:account.client_email,scope:'https://www.googleapis.com/auth/calendar.events',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const pem=account.private_key.replace(/-----[^-]+-----|\s/g,'');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(input));
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+encode(new Uint8Array(sig))})});
  if (!res.ok) throw Error('Google-Anmeldung fehlgeschlagen. Dienstkonto prüfen.');
  const result=await res.json();
  cached={token:result.access_token,until:Date.now()+(result.expires_in-120)*1000};
  return cached.token;
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  if(req.method!=='POST') return reply(405,{error:'POST erforderlich.'});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  try {
    const body=await req.json();
    if(body.action==='sync'){
      const secret=req.headers.get('X-Calendar-Worker');
      if(!secret)return reply(403,{error:'Zugriff verweigert.'});
      const permitted=await db.rpc('calendar_worker_valid',{p_secret:secret});
      if(permitted.error||!permitted.data)return reply(403,{error:'Zugriff verweigert.'});
      const jobs=await db.rpc('calendar_claim');
      if(jobs.error)throw Error('Auftragsliste nicht verfügbar.');
      if(!jobs.data.length)return reply(200,{processed:0});
      const token=accessToken();
      await Promise.all(jobs.data.map(async(job:any)=>{
        let issue=null;
        try{await syncEvent(job,await token);}catch(e){issue=e instanceof Error?e.message:'Übertragung fehlgeschlagen.';}
        const result=await db.rpc('calendar_finish',{p_unit:job.business_unit_id,p_trip:job.trip_id,p_lease:job.lease,p_revision:job.revision,p_error:issue});
        if(result.error)throw Error('Übertragungsstatus konnte nicht gespeichert werden.');
      }));
      return reply(200,{processed:jobs.data.length});
    }
    const bearer=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!bearer)return reply(401,{error:'Bitte anmelden.'});
    const {data:{user}}=await db.auth.getUser(bearer);
    if(!user)return reply(401,{error:'Bitte erneut anmelden.'});
    const {data:profile}=await db.from('app_profiles').select('organization_id').eq('id',user.id).eq('active',true).maybeSingle();
    if(!profile)return reply(403,{error:'Zugriff verweigert.'});
    const {data:unit}=await db.from('business_units').select('id').eq('organization_id',profile.organization_id).eq('code','fahrdienst').eq('active',true).maybeSingle();
    if(!unit)return reply(403,{error:'Geschäftsbereich fehlt.'});
    const {data:member}=await db.from('memberships').select('role').eq('business_unit_id',unit.id).eq('user_id',user.id).eq('active',true).maybeSingle();
    if(member?.role!=='admin')return reply(403,{error:'Nur die Geschäftsleitung kann den Kalender verbinden.'});
    if(body.action==='disconnect'){
      const result=await db.from('google_calendar_links').delete().eq('business_unit_id',unit.id);
      if(result.error)throw Error('Verbindung konnte nicht getrennt werden.');
    }else if(body.action==='connect'){
      const calendar=String(body.calendarId||'').trim();
      if(!/^[^\s@/]+@[^\s@/]+$/.test(calendar)||calendar.length>320) return reply(400,{error:'Bitte die Kalender-ID aus Google Kalender eingeben.'});
      await verifyCalendar(calendar,await accessToken());
      const result=await db.rpc('calendar_connect',{p_unit:unit.id,p_calendar:calendar});
      if(result.error)throw Error('Verbindung konnte nicht gespeichert werden. Bestehende Verbindung prüfen.');
    }else if(body.action!=='status')return reply(400,{error:'Unbekannte Aktion.'});
    const [link,queue,failed]=await Promise.all([
      db.from('google_calendar_links').select('calendar_id').eq('business_unit_id',unit.id).maybeSingle(),
      db.from('google_calendar_queue').select('trip_id',{count:'exact',head:true}).eq('business_unit_id',unit.id),
      db.from('google_calendar_queue').select('last_error').eq('business_unit_id',unit.id).not('last_error','is',null).limit(1).maybeSingle()
    ]);
    if(link.error||queue.error||failed.error)throw Error('Kalenderstatus konnte nicht geladen werden.');
    let email=null;
    try{email=credentials().client_email;}catch{/* Status remains readable before provisioning. */}
    return reply(200,{calendarId:link.data?.calendar_id||null,email,pending:queue.count||0,issue:failed.data?.last_error||null});
  }catch(e){return reply(400,{error:e instanceof Error?e.message:'Kalenderanfrage fehlgeschlagen.'});}
});
