const redirect = 'https://app.tariq-fahrdienst.de/google-calendar-callback.html';
const scopes = ['calendar.events','calendar.calendarlist.readonly'].map(s=>'https://www.googleapis.com/auth/'+s).join(' ');
const bytes = (s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const base64 = (v:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(v)));
async function client() {
  const token=Deno.env.get('VERWALTUNG_PROJECT_TOKEN');
  if(!token) throw Error('Der Kalenderdienst benötigt den Fahrdienst-Projektzugang zur TARIQ Verwaltung.');
  const res=await fetch('https://verwaltung.tariq-itconsulting.de/api/project-config',{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
  const values=res.ok?(await res.json()).values:null;
  if(!values?.GOOGLE_CLIENT_ID||!values?.GOOGLE_CLIENT_SECRET)throw Error('Google-Client in der TARIQ Verwaltung für das Fahrdienst-Projekt freigeben.');
  return {client_id:values.GOOGLE_CLIENT_ID,client_secret:values.GOOGLE_CLIENT_SECRET};
}
export async function authorize(state:string,challenge:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw Error('Anmeldung erneut starten.');
  const {client_id}=await client();
  return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id,redirect_uri:redirect,response_type:'code',scope:scopes,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'});
}
export async function tokens(params:Record<string,string>) {
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...params,...await client()}),signal:AbortSignal.timeout(10000)});
  if(!res.ok)throw Error('Google-Anmeldung fehlgeschlagen. Bitte erneut verbinden.');
  return res.json();
}
export async function writable(token:string){
  const calendars=[];let page='';
  do{
    const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.search=new URLSearchParams({minAccessRole:'writer',fields:'items(id,summary),nextPageToken',...(page?{pageToken:page}:{})}).toString();
    const res=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw Error('Kalenderliste konnte nicht geladen werden.');
    const data=await res.json();calendars.push(...(data.items||[]));page=data.nextPageToken;
  }while(page);
  return calendars;
}
async function key(){
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('fahrdienst-calendar-oauth-v1:'+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')));
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function seal(value:string,owner:string){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},await key(),new TextEncoder().encode(value));
  return base64(iv)+'.'+base64(encrypted);
}
export async function open(value:string,owner:string){
  const [iv,data]=value.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(owner)},await key(),bytes(data)));
}
export async function exchange(code:string,verifier:string){
  return tokens({grant_type:'authorization_code',redirect_uri:redirect,code,code_verifier:verifier});
}
