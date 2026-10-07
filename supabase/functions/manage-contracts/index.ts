import {normalizeTariffLines} from "../_shared/tariffs.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const h={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(s:number,b:any)=>new Response(JSON.stringify(b),{status:s,headers:h});
const txt=(v:any)=>{const x=String(v??"").trim();return x||null};
const num=(v:any)=>Math.max(0,Number(v||0));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:h});
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return out(500,{error:"Backend fehlt."});
  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:u}=await db.auth.getUser(token);
  if(!u?.user) return out(401,{error:"Nicht angemeldet."});
  const {data:p}=await db.from("app_profiles").select("organization_id,active").eq("id",u.user.id).maybeSingle();
  if(!p?.active) return out(403,{error:"Zugang gesperrt."});
  const body=await req.json();
  const {data:unit}=await db.from("business_units").select("id").eq("organization_id",p.organization_id).eq("code",body.businessUnitCode).eq("active",true).maybeSingle();
  if(!unit) return out(400,{error:"Geschaeftsbereich fehlt."});
  const {data:m}=await db.from("memberships").select("role").eq("user_id",u.user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
  if(!m||!["admin","office"].includes(m.role)) return out(403,{error:"Keine Berechtigung."});

  if(body.action==="save_insurer"){
    if(!txt(body.name)) return out(400,{error:"Name der Krankenkasse fehlt."});
    const data={contract_group:["aok","dak","ersatzkassen","individual"].includes(body.contractGroup)?body.contractGroup:"ersatzkassen",organization_id:p.organization_id,name:txt(body.name),short_name:txt(body.shortName),ik_number:txt(body.ikNumber),billing_contact:txt(body.billingContact),billing_email:txt(body.billingEmail),billing_phone:txt(body.billingPhone),active:body.active!==false,notes:txt(body.notes),updated_at:new Date().toISOString()};
    const q=body.insurerId?db.from("health_insurers").update(data).eq("id",body.insurerId).eq("organization_id",p.organization_id):db.from("health_insurers").insert(data);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  if(body.action==="save_contract"){
    if(!txt(body.contractName)) return out(400,{error:"Krankenkasse und Vertragsname sind erforderlich."});
    const scope=body.contractScope==="group"?"group":"individual";
    const group=scope==="group"?"ersatzkassen":null;
    if(scope==="group"&&body.contractGroup!=="ersatzkassen")return out(400,{error:"Ungültige Vertragsgruppe."});
    if(scope==="individual"&&!body.insurerId)return out(400,{error:"Krankenkasse fehlt."});
    if(body.validFrom&&body.validUntil&&body.validFrom>body.validUntil)return out(400,{error:"Gültigkeitszeitraum ist ungültig."});
    const {data:insurer}=await db.from("health_insurers").select("id").eq("id",body.insurerId||"00000000-0000-0000-0000-000000000000").eq("organization_id",p.organization_id).maybeSingle();
    if(scope==="individual"&&!insurer) return out(404,{error:"Krankenkasse nicht gefunden."});
    const data={business_unit_id:unit.id,insurer_id:scope==="individual"?body.insurerId:null,contract_scope:scope,contract_group:group,applies_to_group:group,contract_number:txt(body.contractNumber),contract_name:txt(body.contractName),valid_from:txt(body.validFrom),valid_until:txt(body.validUntil),billing_method:["individual","flat_rate","mixed"].includes(body.billingMethod)?body.billingMethod:"individual",base_fee:num(body.baseFee),price_per_km:num(body.pricePerKm),waiting_per_hour:num(body.waitingPerHour),wheelchair_surcharge:num(body.wheelchairSurcharge),copay_min:num(body.copayMin||5),copay_max:num(body.copayMax||10),copay_percent:num(body.copayPercent||10),active:body.active!==false,notes:txt(body.notes),updated_at:new Date().toISOString()};
    let tariffLines;
    if(body.tariffLines!==undefined){
      try{tariffLines=normalizeTariffLines(body.tariffLines)}catch(e){return out(400,{error:e.message})}
      if(body.active!==false&&!tariffLines.some(x=>x.active))return out(400,{error:"Mindestens eine aktive Tarifposition hinterlegen."});
    }
    if(body.serviceType!==undefined&&!['standard','wheelchair'].includes(body.serviceType))return out(400,{error:"Leistungsbereich ungültig."});
    const payload={...data,...(tariffLines!==undefined?{tariff_lines:tariffLines}:{}),...(body.serviceType!==undefined||!body.contractId?{service_type:body.serviceType||"standard"}:{})};
    const q=body.contractId?db.from("payer_contracts").update(payload).eq("id",body.contractId).eq("business_unit_id",unit.id):db.from("payer_contracts").insert(payload);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  if(body.action==="save_rate"){
    if(!body.contractId||!txt(body.label)) return out(400,{error:"Vertrag und Bezeichnung sind erforderlich."});
    const {data:contract}=await db.from("payer_contracts").select("id").eq("id",body.contractId).eq("business_unit_id",unit.id).maybeSingle();
    if(!contract) return out(404,{error:"Vertrag nicht gefunden."});
    const data={contract_id:body.contractId,position_code:txt(body.positionCode),label:txt(body.label),unit:["ride","km","hour","minute","day","flat"].includes(body.unit)?body.unit:"ride",price:num(body.price),min_quantity:body.minQuantity==null||body.minQuantity===""?null:num(body.minQuantity),max_quantity:body.maxQuantity==null||body.maxQuantity===""?null:num(body.maxQuantity),active:body.active!==false,sort_order:Number(body.sortOrder||0),updated_at:new Date().toISOString()};
    const q=body.rateId?db.from("contract_rates").update(data).eq("id",body.rateId).eq("contract_id",body.contractId):db.from("contract_rates").insert(data);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }
  return out(400,{error:"Unbekannte Aktion."});
});
