import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const h={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const out=(s:number,b:any)=>new Response(JSON.stringify(b),{status:s,headers:h});
const txt=(v:any)=>{const x=String(v??"").trim();return x||null};

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

  const linked=async(id:string)=>{
    const {data}=await db.from("customer_business_units").select("customer_id").eq("customer_id",id).eq("business_unit_id",unit.id).maybeSingle();
    return !!data;
  };

  const creating=body.action==="create_customer";
  if(creating||body.action==="update_customer"){
    let type=body.customerType??"person";
    if(!creating){
      if(!body.customerId||!(await linked(body.customerId))) return out(404,{error:"Kunde nicht gefunden."});
      const {data:customer,error}=await db.from("customers").select("customer_type").eq("id",body.customerId).maybeSingle();
      if(error||!customer) return out(404,{error:"Kunde nicht gefunden."});
      type=customer.customer_type;
    }
    if(!["person","company"].includes(type)) return out(400,{error:"Kundenart ist ungültig."});
    const company=type==="company";
    // The name fields remain the display name for trips, invoices and existing integrations.
    const firstName=company?"":txt(body.firstName);
    const lastName=company?txt(body.companyName):txt(body.lastName);
    if(!lastName||(!company&&!firstName)) return out(400,{error:company?"Firmenname ist erforderlich.":"Vorname und Nachname sind erforderlich."});
    const fields={
      customer_type:type,first_name:firstName,last_name:lastName,birth_date:company?null:txt(body.birthDate),
      phone:txt(body.phone),email:txt(body.email),street:txt(body.street),postal_code:txt(body.postalCode),city:txt(body.city),
      address_extra:txt(body.addressExtra),is_regular:!!body.isRegular,mobility:company?"other":String(body.mobility||"walking"),
      needs_assistance:!company&&!!body.needsAssistance,companion_required:!company&&!!body.companionRequired,
      notes:txt(body.notes)
    };
    if(!creating){
      const {error}=await db.from("customers").update({
        ...fields,active:body.active!==false,updated_at:new Date().toISOString()
      }).eq("id",body.customerId);
      return error?out(400,{error:error.message}):out(200,{ok:true});
    }
    const {data:c,error:e}=await db.from("customers").insert({
      ...fields,organization_id:p.organization_id,home_business_unit_id:unit.id,active:true
    }).select("id,customer_number").single();
    if(e||!c) return out(400,{error:e?.message||"Kunde konnte nicht angelegt werden."});
    const {error:le}=await db.from("customer_business_units").insert({customer_id:c.id,business_unit_id:unit.id});
    if(le){await db.from("customers").delete().eq("id",c.id);return out(500,{error:"Zuordnung fehlgeschlagen."});}
    return out(200,{ok:true,id:c.id,customerNumber:c.customer_number});
  }

  if(!body.customerId||!(await linked(body.customerId))) return out(404,{error:"Kunde nicht gefunden."});

  if(body.action==="save_insurance"){
    const data={
      customer_id:body.customerId,insurer_name:txt(body.insurerName),insurer_code:txt(body.insurerCode),
      insurance_number:txt(body.insuranceNumber),tariff_id:txt(body.tariffId),copay:Math.max(0,Number(body.copay||0)),
      exempt:!!body.exempt,exempt_until:txt(body.exemptUntil),is_primary:true,valid_from:txt(body.validFrom),valid_until:txt(body.validUntil),
      notes:txt(body.notes),updated_at:new Date().toISOString()
    };
    if(!data.insurer_name) return out(400,{error:"Krankenkasse fehlt."});
    const q=body.insuranceId?db.from("customer_insurances").update(data).eq("id",body.insuranceId):db.from("customer_insurances").insert(data);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  if(body.action==="save_destination"){
    const data={
      customer_id:body.customerId,label:txt(body.label),address:txt(body.address),default_km:Math.max(0,Number(body.defaultKm||0)),
      directions:Number(body.directions)===1?1:2,destination_type:String(body.destinationType||"other"),
      active:body.active!==false,updated_at:new Date().toISOString()
    };
    if(!data.label||!data.address) return out(400,{error:"Ziel und Adresse sind erforderlich."});
    const q=body.destinationId?db.from("customer_destinations").update(data).eq("id",body.destinationId):db.from("customer_destinations").insert(data);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  if(body.action==="save_authorization"){
    const data={
      customer_id:body.customerId,authorization_type:String(body.authorizationType||"prescription"),treatment_type:txt(body.treatmentType),
      approval_number:txt(body.approvalNumber),prescription_date:txt(body.prescriptionDate),valid_from:txt(body.validFrom),valid_until:txt(body.validUntil),
      status:String(body.status||"valid"),approved_rides:body.approvedRides===""||body.approvedRides==null?null:Math.max(0,Number(body.approvedRides)),
      used_rides:Math.max(0,Number(body.usedRides||0)),facility_name:txt(body.facilityName),reference_number:txt(body.referenceNumber),
      notes:txt(body.notes),updated_at:new Date().toISOString()
    };
    const q=body.authorizationId?db.from("customer_authorizations").update(data).eq("id",body.authorizationId):db.from("customer_authorizations").insert(data);
    const {error}=await q; return error?out(400,{error:error.message}):out(200,{ok:true});
  }

  return out(400,{error:"Unbekannte Aktion."});
});
