import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { Buffer } from "node:buffer";
import {invoicePdf,recipientLines} from "./invoicePdf.js";
import {epostSettings,handOverInvoice} from "./webdav.js";

const headers={
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"POST, OPTIONS",
 "Content-Type":"application/json","Cache-Control":"no-store"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const fields="filename,status,message,updated_at";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return out(405,{error:"POST erforderlich."});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return out(500,{error:"Backend fehlt."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
 const {data:login}=await db.auth.getUser(token);
 const user=login?.user;
 if(!user)return out(401,{error:"Nicht angemeldet."});
 const body=await req.json().catch(()=>null);
 if(!body||!["status","preview","send"].includes(body.action)||!uuid.test(String(body.invoiceId||"")))return out(400,{error:"Rechnung fehlt."});
 const {data:profile}=await db.from("app_profiles").select("organization_id,active").eq("id",user.id).maybeSingle();
 if(!profile?.active)return out(403,{error:"Zugang gesperrt."});
 const {data:unit}=await db.from("business_units").select("id").eq("organization_id",profile.organization_id)
  .eq("code","fahrdienst").eq("active",true).maybeSingle();
 if(!unit)return out(403,{error:"Geschäftsbereich fehlt."});
 const {data:member}=await db.from("memberships").select("role").eq("business_unit_id",unit.id)
  .eq("user_id",user.id).eq("active",true).maybeSingle();
 if(member?.role!=="admin")return out(403,{error:"Nur Administratoren dürfen Rechnungen per E-POST versenden."});

 const {data:invoice,error:invoiceError}=await db.from("invoices").select("*").eq("id",body.invoiceId).eq("business_unit_id",unit.id).maybeSingle();
 if(invoiceError||!invoice)return out(404,{error:"Rechnung nicht gefunden."});
 const {data:dispatch,error:dispatchError}=await db.from("invoice_epost_dispatches").select(fields)
  .eq("invoice_id",invoice.id).eq("business_unit_id",unit.id).maybeSingle();
 if(dispatchError)return out(503,{error:"E-POST-Status konnte nicht geladen werden."});
 if(body.action==="status")return out(200,{dispatch});
 if(dispatch&&dispatch.status!=="rejected")return out(409,{error:"Für diese Rechnung besteht bereits ein E-POST-Auftrag."});
 if(invoice.payer_type!=="private"||!["open","paid"].includes(invoice.status)||invoice.document_type==="cancellation"||!invoice.invoice_number){
  return out(409,{error:"Nur ausgestellte Privatrechnungen können per E-POST versendet werden."});
 }
 const settings=epostSettings(name=>Deno.env.get(name),unit.id);
 if(!settings)return out(503,{error:"Der E-POST-Sammelkorb ist noch nicht konfiguriert."});
 if(body.action==="send"&&(body.confirmed!==true||typeof body.digest!=="string"||!/^[a-f0-9]{64}$/.test(body.digest))){
  return out(400,{error:"Briefvorschau und Versand bestätigen."});
 }
 const items=[];
 let count:number|null=null;
 while(count===null||items.length<count){
  const result=await db.from("invoice_items").select("id,description,quantity,unit,unit_gross,vat_rate,gross_total",{count:"exact"})
   .eq("invoice_id",invoice.id).order("sort_order").order("id").range(items.length,items.length+499);
  if(result.error||result.count===null||(count!==null&&result.count!==count)||(!result.data?.length&&result.count!==items.length)){
   return out(409,{error:"Rechnungspositionen konnten nicht vollständig geladen werden."});
  }
  count=result.count;
  items.push(...result.data);
 }
 let pdf,digest;
 try{
  pdf=await invoicePdf(invoice,items);
  if(pdf.length>20*1024*1024)return out(409,{error:"Die PDF-Datei ist für E-POST zu groß."});
  digest=Buffer.from(await crypto.subtle.digest("SHA-256",pdf)).toString("hex");
 }catch(error){
  return out(409,{error:error instanceof Error?error.message:"Brief-PDF konnte nicht erzeugt werden."});
 }
 if(body.action==="preview")return out(200,{digest,pdf:pdf.toString("base64"),recipient:recipientLines(invoice),invoiceNumber:invoice.invoice_number});
 if(body.digest!==digest)return out(409,{error:"Rechnung wurde geändert. Briefvorschau erneut öffnen."});
 const {data:claimed,error:claimError}=await db.rpc("claim_epost_invoice",{
  p_invoice:invoice.id,p_unit:unit.id,p_actor:user.id,p_version:invoice.updated_at
 });
 if(claimError||!claimed)return out(409,{error:claimError?.message||"Versand konnte nicht reserviert werden."});
 const delivery=await handOverInvoice(settings,claimed.filename,pdf);
 const {data:recorded,error:recordError}=await db.from("invoice_epost_dispatches")
  .update({...delivery,updated_at:new Date().toISOString()}).eq("invoice_id",invoice.id)
  .eq("attempt_id",claimed.attempt_id).eq("status","sending").select(fields).maybeSingle();
 if(recordError||!recorded)return out(503,{error:"Der Versandstatus konnte nicht gespeichert werden. Vor einem weiteren Versuch bitte das E-POST-Journal prüfen."});
 return out(200,{dispatch:recorded});
});
