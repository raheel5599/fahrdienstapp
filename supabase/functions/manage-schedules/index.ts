import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};
const reply=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
const text=(v:any)=>{const s=String(v??"").trim();return s||null};

function isoDay(d:Date){const day=d.getUTCDay();return day===0?7:day;}
function ymd(d:Date){return d.toISOString().slice(0,10);}
function parseDate(s:string){return new Date(s+"T00:00:00.000Z");}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return reply(405,{error:"Nur POST ist erlaubt."});

  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return reply(500,{error:"Backend-Konfiguration fehlt."});

  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token) return reply(401,{error:"Nicht angemeldet."});

  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await db.auth.getUser(token);
  const user=userData?.user;
  if(userError||!user) return reply(401,{error:"Sitzung ist nicht gültig."});

  const {data:profile}=await db.from("app_profiles").select("organization_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active) return reply(403,{error:"Zugang ist nicht freigeschaltet."});

  let body:any;
  try{body=await req.json();}catch{return reply(400,{error:"Ungültige Anfrage."});}

  const code=String(body.businessUnitCode||"").trim();
  const {data:unit}=await db.from("business_units").select("id,organization_id").eq("organization_id",profile.organization_id).eq("code",code).eq("active",true).maybeSingle();
  if(!unit) return reply(400,{error:"Geschäftsbereich wurde nicht gefunden."});

  const {data:membership}=await db.from("memberships").select("role").eq("user_id",user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
  if(!membership||!["admin","office"].includes(membership.role)) return reply(403,{error:"Keine Berechtigung für Terminplanung."});

  const action=String(body.action||"");
  if(!["create_series","update_series","set_series_active"].includes(action))return reply(400,{error:"Unbekannte Aktion."});
  const {data,error}=await db.rpc("manage_trip_series_schedule",{p_unit:unit.id,p_actor:user.id,p_action:action,p_series:body.seriesId||null,p_payload:body});
  if(error)return reply(400,{error:error.message||"Serienfahrt konnte nicht gespeichert werden."});
  return reply(200,data);
});
