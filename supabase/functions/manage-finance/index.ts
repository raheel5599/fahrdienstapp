import {correctionReason,correctionItems,correctionHeader} from "../_shared/financeCorrections.js";
import {normalizeProfile,loadIssuerSnapshot} from "../_shared/businessProfile.js";
import {resolveContract,tripServiceType} from "../_shared/contracts.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const h={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(s:number,b:any)=>new Response(JSON.stringify(b),{status:s,headers:h});
const txt=(v:any,n=500)=>{const x=String(v??"").trim().slice(0,n);return x||null};
const money=(v:any)=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
const validVat=(v:any)=>[0,7,19].includes(Number(v))?Number(v):0;

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:h});
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return out(500,{error:"Backend fehlt."});
  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:u}=await db.auth.getUser(token);
  if(!u?.user)return out(401,{error:"Nicht angemeldet."});

  const {data:p}=await db.from("app_profiles").select("organization_id,active").eq("id",u.user.id).maybeSingle();
  if(!p?.active)return out(403,{error:"Zugang gesperrt."});

  const body=await req.json();
  const {data:unit}=await db.from("business_units").select("id").eq("organization_id",p.organization_id).eq("code",body.businessUnitCode).eq("active",true).maybeSingle();
  if(!unit)return out(400,{error:"Geschäftsbereich fehlt."});
  const {data:m}=await db.from("memberships").select("role").eq("user_id",u.user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
  if(!m||!["admin","office"].includes(m.role))return out(403,{error:"Keine Berechtigung."});

  if(body.action==="save_company_profile"){
    if(m.role!=="admin")return out(403,{error:"Nur Administratoren dürfen Unternehmensdaten ändern."});
    let profile;try{profile=normalizeProfile(body.profile)}catch(e){return out(400,{error:e.message})}
    const {error}=await db.from("billing_profiles").upsert({...profile,business_unit_id:unit.id,updated_at:new Date().toISOString()},{onConflict:"business_unit_id"});
    return error?out(400,{error:error.message}):out(200,{ok:true});
  }
  if(body.action==="create_invoice"){
    const items=Array.isArray(body.items)?body.items:[];
    if(!items.length||items.length>100)return out(400,{error:"Rechnungspositionen fehlen."});
    const calc=items.map((item:any)=>{
      const quantity=Math.max(0.01,Number(item.quantity||1));
      const unitGross=Math.max(0,money(item.unitGross));
      const vatRate=validVat(item.vatRate);
      const gross=money(quantity*unitGross);
      const net=money(gross/(1+vatRate/100));
      const vat=money(gross-net);
      return {trip_id:item.tripId||null,description:txt(item.description,180),quantity,unit:txt(item.unit,30)||"Fahrt",unit_gross:unitGross,vat_rate:vatRate,net_total:net,vat_total:vat,gross_total:gross,sort_order:Number(item.sortOrder||0)};
    });
    if(calc.some((x:any)=>!x.description))return out(400,{error:"Eine Rechnungsposition hat keine Bezeichnung."});
    const grossTotal=money(calc.reduce((s:number,x:any)=>s+x.gross_total,0));
    const netTotal=money(calc.reduce((s:number,x:any)=>s+x.net_total,0));
    const vatTotal=money(grossTotal-netTotal);

    let customer:any=null;
    if(body.customerId){
      const {data}=await db.from("customers").select("id,first_name,last_name,street,postal_code,city").eq("id",body.customerId).eq("organization_id",p.organization_id).maybeSingle();
      customer=data;
    }
    let insurer:any=null;
    if(body.insurerId){
      const {data}=await db.from("health_insurers").select("id,name,billing_contact,billing_email").eq("id",body.insurerId).eq("organization_id",p.organization_id).maybeSingle();
      insurer=data;
    }
    if(body.businessUnitCode==="fahrdienst"&&body.payerType==="insurer"){
      if(!insurer)return out(400,{error:"Krankenkasse fehlt."});
      const dates=[];
      for(const item of items){
        if(item.tripId){
          const {data:trip}=await db.from("trips").select("service_date,business_unit_id,customer_mobility").eq("id",item.tripId).eq("business_unit_id",unit.id).maybeSingle();
          if(!trip)return out(400,{error:"Fahrt nicht gefunden."});
          dates.push({date:trip.service_date,serviceType:tripServiceType(trip)});
        }else{
          if(!/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate||""))return out(400,{error:"Leistungsdatum für Vertragsprüfung fehlt."});
          dates.push({date:body.serviceDate,serviceType:body.serviceType==="wheelchair"?"wheelchair":"standard"});
        }
      }
      for(const entry of dates){if(!await resolveContract(db,unit.id,p.organization_id,insurer.id,entry.date,undefined,entry.serviceType))return out(409,{error:"Kein gültiger Kassenvertrag am Leistungsdatum. Abrechnung gesperrt."});}
    }
    const customerName=customer?[customer.first_name,customer.last_name].filter(Boolean).join(" "):txt(body.customerName,180);
    const customerAddress=customer?[customer.street,[customer.postal_code,customer.city].filter(Boolean).join(" ")].filter(Boolean).join(", "):txt(body.customerAddress,300);
    const payerType=["private","insurer","other"].includes(body.payerType)?body.payerType:"private";
    const payerName=payerType==="insurer"?(insurer?.name||txt(body.payerName,180)):(txt(body.payerName,180)||customerName);
    if(!payerName)return out(400,{error:"Rechnungsempfänger fehlt."});

    let issuer;try{issuer=await loadIssuerSnapshot(db,unit.id)}catch(e){return out(409,{error:e.message})}
    const {data:invoice,error:ie}=await db.from("invoices").insert({
      business_unit_id:unit.id,issuer_snapshot:issuer,service_date:txt(body.serviceDate,10),customer_id:customer?.id||null,insurer_id:insurer?.id||null,
      payer_type:payerType,payer_name:payerName,payer_address:txt(body.payerAddress,300)||(payerType==="private"?customerAddress:null),
      customer_name:customerName,customer_address:customerAddress,status:"open",
      issue_date:txt(body.issueDate,10)||new Date().toISOString().slice(0,10),
      due_date:txt(body.dueDate,10),net_total:netTotal,vat_total:vatTotal,gross_total:grossTotal,
      notes:txt(body.notes,1000),created_by:u.user.id
    }).select("id,document_seq").single();
    if(ie||!invoice)return out(400,{error:ie?.message||"Rechnung konnte nicht erstellt werden."});

    const invoiceNumber="RE-"+new Date().getFullYear()+"-"+String(invoice.document_seq).padStart(5,"0");
    const {error:ne}=await db.from("invoices").update({invoice_number:invoiceNumber}).eq("id",invoice.id);
    if(ne)return out(400,{error:ne.message});
    const rows=calc.map((x:any)=>({...x,invoice_id:invoice.id}));
    const {error:itemErr}=await db.from("invoice_items").insert(rows);
    if(itemErr){await db.from("invoices").delete().eq("id",invoice.id);return out(400,{error:itemErr.message});}
    return out(200,{ok:true,id:invoice.id,invoiceNumber,netTotal,vatTotal,grossTotal});
  }

  if(body.action==="cancel_invoice"||body.action==="record_refund"){
    let reason;try{reason=correctionReason(body.reason)}catch(e){return out(400,{error:e.message})}
    const name=body.action==="cancel_invoice"?"cancel_finance_invoice":"record_invoice_refund";
    const params:any={p_invoice:body.invoiceId,p_unit:unit.id,p_actor:u.user.id};
    params[body.action==="cancel_invoice"?"p_reason":"p_note"]=reason;
    const {data,error}=await db.rpc(name,params);
    return error?out(409,{error:error.message}):out(200,data);
  }
  if(body.action==="replace_invoice"){
    const {data:original}=await db.from("invoices").select("*").eq("id",body.invoiceId).eq("business_unit_id",unit.id).maybeSingle();
    if(!original||original.document_type!=="invoice"||original.status!=="cancelled")return out(409,{error:"Zuerst die Originalrechnung stornieren."});
    let header,items;
    try{items=correctionItems(body.items);header=correctionHeader(body,original,await loadIssuerSnapshot(db,unit.id))}catch(e){return out(400,{error:e.message})}
    if(original.payer_type==="insurer"&&body.businessUnitCode==="fahrdienst"){
      if(!await resolveContract(db,unit.id,p.organization_id,original.insurer_id,header.serviceDate,undefined,body.serviceType==="wheelchair"?"wheelchair":"standard"))return out(409,{error:"Kein gültiger Vertrag am Leistungsdatum. Ersatzrechnung gesperrt."});
    }
    const {data,error}=await db.rpc("replace_finance_invoice",{p_original:original.id,p_unit:unit.id,p_actor:u.user.id,p_header:header,p_items:items});
    return error?out(409,{error:error.message}):out(200,data);
  }
  if(body.action==="set_invoice_status"){
    if(!body.invoiceId||body.status!=="paid")return out(400,{error:"Storno benötigt einen eigenen Beleg und Stornogrund."});
    const {data,error}=await db.rpc("mark_finance_invoice_paid",{p_invoice:body.invoiceId,p_unit:unit.id,p_actor:u.user.id});
    return error?out(409,{error:error.message}):out(200,data);
  }

  if(body.action==="create_receipt"){
    const amount=money(body.amount);
    const method=["cash","card"].includes(body.paymentMethod)?body.paymentMethod:"cash";
    const allowedTypes=body.businessUnitCode==="taxi"
      ? ["city_trip","airport_trip","courier_trip"]
      : body.businessUnitCode==="fahrdienst"
        ? ["own_share"]
        : [];
    const receiptType=String(body.receiptType||"");
    if(!allowedTypes.includes(receiptType))return out(400,{error:"Ungültige Quittungsart für diesen Geschäftsbereich."});
    const labels:any={city_trip:"Stadtfahrt",airport_trip:"Flughafenfahrt",courier_trip:"Kurierfahrt",own_share:"Eigener Anteil"};
    const receivedFrom=txt(body.receivedFrom,180);
    if(amount<=0||!receivedFrom)return out(400,{error:"Zahler und Betrag sind erforderlich."});
    let issuer;try{issuer=await loadIssuerSnapshot(db,unit.id)}catch(e){return out(409,{error:e.message})}
    const {data:receipt,error}=await db.from("receipts").insert({
      business_unit_id:unit.id,issuer_snapshot:issuer,customer_id:body.customerId||null,invoice_id:body.invoiceId||null,
      received_from:receivedFrom,purpose:labels[receiptType],receipt_type:receiptType,amount,
      concession_number:txt(body.concessionNumber,120),from_address:txt(body.fromAddress,300),to_address:txt(body.toAddress,300),
      payment_method:method,payment_date:txt(body.paymentDate,10)||new Date().toISOString().slice(0,10),
      notes:txt(body.notes,1000),created_by:u.user.id
    }).select("id,document_seq").single();
    if(error||!receipt)return out(400,{error:error?.message||"Quittung konnte nicht erstellt werden."});
    const receiptNumber="QU-"+new Date().getFullYear()+"-"+String(receipt.document_seq).padStart(5,"0");
    const {error:re}=await db.from("receipts").update({receipt_number:receiptNumber}).eq("id",receipt.id);
    return re?out(400,{error:re.message}):out(200,{ok:true,id:receipt.id,receiptNumber});
  }

  if(body.action==="cancel_receipt"){
    if(!body.receiptId)return out(400,{error:"Quittung fehlt."});
    const {error}=await db.from("receipts").update({cancelled_at:new Date().toISOString()}).eq("id",body.receiptId).eq("business_unit_id",unit.id).is("cancelled_at",null);
    return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  return out(400,{error:"Unbekannte Aktion."});
});
