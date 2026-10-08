import {loadIssuerSnapshot} from "../_shared/businessProfile.js";
import {resolveContract,composeBillingPosition,defaultTreatment,tripServiceType} from "../_shared/contracts.js";
import {calculateTariff,invoiceTariffItems,tariffFingerprint} from "../_shared/tariffs.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(s:number,b:any)=>new Response(JSON.stringify(b),{status:s,headers:H});
const cash=(v:any)=>Math.round((Math.max(0,Number(v)||0)+Number.EPSILON)*100)/100;
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return out(500,{error:"Backend fehlt."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/,"");
 const {data:ud}=await db.auth.getUser(token); const user=ud?.user;
 if(!user)return out(401,{error:"Nicht angemeldet."});
 const body=await req.json().catch(()=>({}));
 const {data:p}=await db.from("app_profiles").select("organization_id,active").eq("id",user.id).maybeSingle();
 if(!p?.active)return out(403,{error:"Zugang gesperrt."});
 const {data:unit}=await db.from("business_units").select("id").eq("organization_id",p.organization_id).eq("code",body.businessUnitCode).eq("active",true).maybeSingle();
 if(!unit)return out(400,{error:"Geschäftsbereich fehlt."});
 const {data:m}=await db.from("memberships").select("role").eq("user_id",user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
 if(!m||!["admin","office"].includes(m.role))return out(403,{error:"Keine Berechtigung."});
 const {data:c}=await db.from("trip_billing_cases").select("*").eq("id",body.caseId).eq("business_unit_id",unit.id).maybeSingle();
 if(!c)return out(404,{error:"Abrechnungsfall nicht gefunden."});
 const {data:trip}=await db.from("trips").select("*").eq("id",c.trip_id).maybeSingle();
 if(!trip)return out(404,{error:"Fahrt fehlt."});

 if(body.action==="recalculate"){
   if(c.invoice_id)return out(409,{error:"Abgerechnete Fahrt kann nicht neu berechnet werden."});
   let insurance:any=null;
   if(c.insurance_id){const {data}=await db.from("customer_insurances").select("*").eq("id",c.insurance_id).eq("customer_id",c.customer_id).maybeSingle();insurance=data}
   if(!insurance){const {data}=await db.from("customer_insurances").select("*").eq("customer_id",c.customer_id).eq("is_primary",true).or("valid_from.is.null,valid_from.lte."+trip.service_date).or("valid_until.is.null,valid_until.gte."+trip.service_date).order("created_at",{ascending:false}).limit(1).maybeSingle();insurance=data}
   let insurerId=c.insurer_id;
   if(!insurerId&&insurance){
     if(insurance.insurer_code){const {data}=await db.from("health_insurers").select("id").eq("organization_id",p.organization_id).eq("ik_number",insurance.insurer_code).eq("active",true).maybeSingle();insurerId=data?.id;}
     if(!insurerId&&insurance.insurer_name){const {data}=await db.from("health_insurers").select("id").eq("organization_id",p.organization_id).ilike("name",insurance.insurer_name).eq("active",true).maybeSingle();insurerId=data?.id;}
   }
   const serviceType=tripServiceType(trip);
   const contract=await resolveContract(db,unit.id,p.organization_id,insurerId,trip.service_date,c.contract_id,serviceType);
   let pos=String(body.positionCode ?? (contract?.id===c.contract_id?c.position_code:"") ?? "").trim()||null;
   let legacyRates=[];
   if(contract?.id&&contract.tariff_lines==null){const {data:r,error}=await db.from("contract_rates").select("*").eq("contract_id",contract.id).eq("active",true).order("sort_order");if(error)return out(400,{error:error.message});legacyRates=r||[];if(!pos)pos=legacyRates[0]?.position_code||null}
   const lower=String(trip.trip_type||"").toLowerCase();
   const treatment=String(body.treatmentCode ?? c.treatment_code ?? defaultTreatment(lower)).trim()||null;
   const rawKm=Number(body.billableKm??c.billable_km??0),rawWait=Number(body.waitingMinutes??c.waiting_minutes??0),rawOwn=Number(body.ownShareAmount??c.own_share_amount??0);
   if(![rawKm,rawWait,rawOwn].every(x=>Number.isFinite(x)&&x>=0))return out(400,{error:"Kilometer, Wartezeit und Eigenanteil müssen mindestens 0 sein."});
   const km=cash(rawKm),wait=Math.round(rawWait);
   const vehicleClass=body.vehicleClass??c.billing_vehicle_class??'unconfirmed';
   const journeyKind=body.journeyKind??c.billing_journey_kind??(trip.series_id?'series':'single');
   const area=body.area??c.billing_area??'unconfirmed';
   const meterAmount=body.meterAmount??c.meter_amount;
   if(!['unconfirmed','taxi','mietwagen'].includes(vehicleClass)||!['single','series'].includes(journeyKind)||!['unconfirmed','inside','outside'].includes(area))return out(400,{error:"Abrechnungsart ist ungültig."});
   if(meterAmount!=null&&meterAmount!==''&&(!Number.isFinite(Number(meterAmount))||Number(meterAmount)<0))return out(400,{error:"Taxameterbetrag ist ungültig."});
   let tariff;
   try{tariff=calculateTariff(contract,legacyRates,{date:trip.service_date,km,waitingMinutes:wait,treatmentCode:treatment,positionCode:pos,vehicleClass,journeyKind,area,meterAmount})}catch(e){return out(400,{error:e.message})}
   const {gross,base,kmRate:rate,waiting,surcharge}=tariff;
   if(contract?.tariff_lines!=null)pos=tariff.lines.find(l=>l.kind==='km')?.template||tariff.lines[0]?.template||null;
   const billingPosition=composeBillingPosition(pos,treatment);
   const exempt=Boolean(insurance?.exempt)&&(!insurance?.exempt_until||insurance.exempt_until>=trip.service_date);
   const own=exempt?0:Math.min(gross,cash(body.ownShareAmount??c.own_share_amount));
   if(c.receipt_id&&cash(c.own_share_amount)!==own)return out(409,{error:"Quittierter Eigenanteil kann nicht verändert werden."});
   const review=[...tariff.review]; if(!insurance)review.push("Keine primäre Krankenversicherung."); if(insurance&&!insurerId)review.push("Kostenträger nicht zugeordnet."); if(insurance&&!contract)review.push(serviceType==='wheelchair'?"Kein gültiger eigener Rollstuhlvertrag.":"Kein aktiver Vertrag.");
   const patch={insurance_id:insurance?.id||null,insurer_id:insurerId||null,contract_id:contract?.id||null,billable_km:km,base_fee:base,km_rate:rate,waiting_minutes:wait,waiting_amount:waiting,surcharge_amount:surcharge,wheelchair_surcharge_applied:false,gross_amount:gross,own_share_amount:own,insurer_amount:cash(gross-own),own_share_required:own>0,position_code:pos,treatment_code:treatment,billing_position:billingPosition,tariff_breakdown:tariff.lines,billing_vehicle_class:vehicleClass,billing_journey_kind:journeyKind,billing_area:area,meter_amount:meterAmount==null||meterAmount===''?null:Number(meterAmount),billing_status:!contract?"blocked":review.length?"review":"ready",review_message:review.join(" "),calculated_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   const {data,error}=await db.from("trip_billing_cases").update(patch).eq("id",c.id).select("*").single();
   return error?out(400,{error:error.message}):out(200,{ok:true,case:data});
 }

 if(body.action==="own_share_receipt"){
   if(c.receipt_id)return out(409,{error:"Eigenanteil bereits quittiert."}); if(!c.own_share_required||cash(c.own_share_amount)<=0)return out(400,{error:"Kein Eigenanteil offen."});
   const {data:customer}=await db.from("customers").select("*").eq("id",c.customer_id).maybeSingle(); if(!customer)return out(400,{error:"Kunde fehlt."});
   let issuer;try{issuer=await loadIssuerSnapshot(db,unit.id)}catch(e){return out(409,{error:e.message})}
   const {data:r,error}=await db.from("receipts").insert({business_unit_id:unit.id,issuer_snapshot:issuer,customer_id:c.customer_id,received_from:[customer.first_name,customer.last_name].filter(Boolean).join(" "),purpose:"Eigener Anteil",receipt_type:"own_share",amount:cash(c.own_share_amount),payment_method:["cash","card"].includes(body.paymentMethod)?body.paymentMethod:"cash",payment_date:new Date().toISOString().slice(0,10),from_address:trip.from_address,to_address:trip.to_address,created_by:user.id}).select("id,document_seq").single();
   if(error||!r)return out(400,{error:error?.message||"Quittung fehlgeschlagen."}); const no="QU-"+new Date().getFullYear()+"-"+String(r.document_seq).padStart(5,"0"); await db.from("receipts").update({receipt_number:no}).eq("id",r.id); await db.from("trip_billing_cases").update({receipt_id:r.id,own_share_paid:true,updated_at:new Date().toISOString()}).eq("id",c.id); return out(200,{ok:true,receiptNumber:no});
 }

 if(body.action==="invoice"){
   const contract=await resolveContract(db,unit.id,p.organization_id,c.insurer_id,trip.service_date,c.contract_id,tripServiceType(trip));
   if(!contract)return out(409,{error:"Kein gültiger Kassenvertrag am Fahrtag. Abrechnung gesperrt."});
   if(contract.id!==c.contract_id)return out(409,{error:"Vertragszuordnung hat sich geändert. Fahrt zuerst neu berechnen."});
   if(contract.tariff_lines!=null){
     let current;
     try{current=calculateTariff(contract,[],{date:trip.service_date,km:c.billable_km,waitingMinutes:c.waiting_minutes,treatmentCode:c.treatment_code,vehicleClass:c.billing_vehicle_class,journeyKind:c.billing_journey_kind,area:c.billing_area,meterAmount:c.meter_amount})}catch(e){return out(409,{error:e.message})}
     if(current.review.length||tariffFingerprint(current.lines)!==tariffFingerprint(c.tariff_breakdown)||current.gross!==cash(c.gross_amount))return out(409,{error:"Tarifpositionen wurden geändert oder fehlen. Fahrt zuerst neu berechnen."});
   }
   if(!composeBillingPosition(c.position_code,c.treatment_code)||composeBillingPosition(c.position_code,c.treatment_code)!==c.billing_position)return out(409,{error:"Positionsnummer zuerst vollständig prüfen."});
   if(c.invoice_id)return out(409,{error:"Rechnung bereits vorhanden."}); if(c.billing_status!=="ready")return out(409,{error:"Abrechnungsfall zuerst vollständig prüfen."}); if(!c.insurer_id||cash(c.insurer_amount)<=0)return out(400,{error:"Kein Kassenbetrag vorhanden."});
   const [{data:customer},{data:insurer}]=await Promise.all([db.from("customers").select("*").eq("id",c.customer_id).maybeSingle(),db.from("health_insurers").select("*").eq("id",c.insurer_id).maybeSingle()]); if(!customer||!insurer)return out(400,{error:"Kunde oder Krankenkasse fehlt."});
   const amount=cash(c.insurer_amount),desc=[c.billing_position?"Pos. "+c.billing_position:null,trip.trip_type,trip.service_date,trip.from_address+" → "+trip.to_address].filter(Boolean).join(" · ");
   let issuer;try{issuer=await loadIssuerSnapshot(db,unit.id)}catch(e){return out(409,{error:e.message})}
   const positions=c.tariff_breakdown?.length?invoiceTariffItems(c.tariff_breakdown,cash(c.own_share_amount),trip,null):[{trip_id:trip.id,description:desc,quantity:1,unit:"Fahrt",unit_gross:amount,vat_rate:0,net_total:amount,vat_total:0,gross_total:amount}];
   const {data,error}=await db.rpc("issue_case_finance_invoice",{p_case:c.id,p_unit:unit.id,p_actor:user.id,p_expected_updated_at:c.updated_at||null,p_header:{payerName:insurer.name,customerName:[customer.first_name,customer.last_name].filter(Boolean).join(" "),customerAddress:[customer.street,[customer.postal_code,customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),serviceDate:trip.service_date,issuerSnapshot:issuer},p_items:positions});
   return error?out(409,{error:error.message}):out(200,data);
 }
 return out(400,{error:"Unbekannte Aktion."});
});
