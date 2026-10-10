import {calculateOwnShare,privateFare,COPAY_RULE_VERSION} from "../_shared/copay.js";
import {calculateTariff} from "../_shared/tariffs.js";
import {resolveContract,composeBillingPosition,defaultTreatment,tripServiceType} from "../_shared/contracts.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};
const reply=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
const clean=(v:any)=>{const s=String(v??"").trim();return s||null};
const activeTripStatuses=["geplant","auf_dem_weg","angekommen","in_fahrt"];
const estimateTripMinutes=(type:string)=>{
  const value=String(type||"").toLowerCase();
  if(value.includes("dialyse")||value.includes("chemo")||value.includes("krankenhaus")) return 90;
  if(value.includes("rollstuhl")) return 75;
  return 60;
};
const timeMinutes=(value:string)=>{
  const parts=String(value||"00:00").split(":").map(Number);
  return (parts[0]||0)*60+(parts[1]||0);
};
const overlaps=(aStart:number,aDuration:number,bStart:number,bDuration:number,buffer=15)=>
  aStart < bStart+bDuration+buffer && bStart < aStart+aDuration+buffer;

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

  const unitCode=String(body.businessUnitCode||"").trim();
  const {data:unit}=await db.from("business_units").select("id,organization_id").eq("organization_id",profile.organization_id).eq("code",unitCode).eq("active",true).maybeSingle();
  if(!unit) return reply(400,{error:"Geschäftsbereich wurde nicht gefunden."});

  const {data:membership}=await db.from("memberships").select("role,driver_id,active").eq("user_id",user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
  if(!membership) return reply(403,{error:"Keine Berechtigung für diesen Bereich."});

  const isStaff=["admin","office"].includes(membership.role);
  const driverId=membership.driver_id||null;
  const action=String(body.action||"");

  if(action==="record_history"){
    if(!isStaff)return reply(403,{error:"Nur Büro oder Chef dürfen vergangene Fahrten bestätigen."});
    if(body.confirmed!==true)return reply(400,{error:"Tatsächliche Durchführung bzw. Ausfall bitte bestätigen."});
    const entries=body.entries;
    if(!Array.isArray(entries)||entries.length<1||entries.length>100||new Set(entries.map(e=>e?.id)).size!==entries.length)return reply(400,{error:"Bitte 1 bis 100 verschiedene Fahrten auswählen."});
    if(!["abgeschlossen","storniert"].includes(body.decision)||String(body.note||"").trim().length<3)return reply(400,{error:"Entscheidung und Begründung sind erforderlich."});
    const {data,error}=await db.rpc("record_historical_trips",{p_unit:unit.id,p_actor:user.id,p_entries:entries.map(e=>({id:e.id,updatedAt:e.updatedAt})),p_decision:body.decision,p_note:String(body.note).trim()});
    if(error)return reply(409,{error:error.message});
    return reply(200,data);
  }

  const customerForUnit=async(customerId:string)=>{
    const {data:link}=await db.from("customer_business_units").select("customer_id").eq("customer_id",customerId).eq("business_unit_id",unit.id).maybeSingle();
    if(!link)return null;
    const {data:customer}=await db.from("customers").select("id,first_name,last_name,mobility,active,street,postal_code,city").eq("id",customerId).maybeSingle();
    return customer?.active?customer:null;
  };

  const driverForUnit=async(id:string)=>{
    const {data:link}=await db.from("driver_business_units").select("driver_id").eq("driver_id",id).eq("business_unit_id",unit.id).maybeSingle();
    if(!link)return null;
    const {data:driver}=await db.from("drivers").select("id,full_name,active,status").eq("id",id).maybeSingle();
    return driver?.active?driver:null;
  };

  const vehicleForUnit=async(id:string)=>{
    const {data:link}=await db.from("vehicle_business_units").select("vehicle_id").eq("vehicle_id",id).eq("business_unit_id",unit.id).maybeSingle();
    if(!link)return null;
    const {data:vehicle}=await db.from("vehicles").select("id,registration,active,status").eq("id",id).maybeSingle();
    return vehicle?.active?vehicle:null;
  };

  const getTrip=async(id:string)=>{
    const {data}=await db.from("trips").select("*").eq("id",id).eq("business_unit_id",unit.id).maybeSingle();
    return data||null;
  };

  if(action==="create_trip"){
    if(!isStaff)return reply(403,{error:"Nur Chef oder Büro dürfen Fahrten anlegen."});
    const customerId=String(body.customerId||"");
    const customer=await customerForUnit(customerId);
    if(!customer)return reply(404,{error:"Kunde wurde nicht gefunden."});
    const serviceDate=String(body.serviceDate||"");
    const scheduledTime=String(body.scheduledTime||"");
    const fromAddress=clean(body.fromAddress)||[customer.street,customer.postal_code,customer.city].filter(Boolean).join(", ");
    const toAddress=clean(body.toAddress);
    if(!serviceDate||!scheduledTime||!fromAddress||!toAddress)return reply(400,{error:"Datum, Uhrzeit, Abhol- und Zieladresse sind erforderlich."});

    const billingPayerType=body.billingPayerType||"auto";if(!["auto","private","insurer"].includes(billingPayerType))return reply(400,{error:"Kostenträger ist ungültig."});
    const privateVatRate=Number(body.privateVatRate??0);if(![0,7,19].includes(privateVatRate))return reply(400,{error:"Steuersatz ist ungültig."});
    let fare:any=null;if(billingPayerType==="private"&&body.privatePrice!=null&&body.privatePrice!==""){try{fare=privateFare({amount:body.privatePrice,vatRate:body.privateVatRate})}catch(e){return reply(400,{error:e.message})}}
    const {data:trip,error}=await db.from("trips").insert({
      business_unit_id:unit.id,customer_id:customer.id,service_date:serviceDate,scheduled_time:scheduledTime,billing_payer_type:billingPayerType,private_price:fare?.gross||null,private_vat_rate:privateVatRate,
      direction:String(body.direction||"outbound"),trip_type:clean(body.tripType)||"Krankenfahrt",
      from_address:fromAddress,to_address:toAddress,status:"offen",notes:clean(body.notes),
      customer_name:[customer.first_name,customer.last_name].filter(Boolean).join(" "),
      customer_mobility:customer.mobility,created_by:user.id,updated_by:user.id
    }).select("*").single();

    if(error||!trip)return reply(400,{error:error?.message||"Fahrt konnte nicht angelegt werden."});
    return reply(200,{ok:true,trip});
  }

  if(action==="assign_trip"){
    if(!isStaff)return reply(403,{error:"Nur Chef oder Büro dürfen Fahrten zuweisen."});
    const tripId=String(body.tripId||"");
    const targetDriverId=String(body.driverId||"");
    const targetVehicleId=String(body.vehicleId||"");
    const [trip,driver,vehicle]=await Promise.all([getTrip(tripId),driverForUnit(targetDriverId),vehicleForUnit(targetVehicleId)]);
    if(!trip)return reply(404,{error:"Fahrt wurde nicht gefunden."});
    const customer=await customerForUnit(trip.customer_id);
    if(!customer)return reply(404,{error:"Kunde wurde nicht gefunden."});
    if(!["offen","geplant"].includes(trip.status))return reply(400,{error:"Diese Fahrt kann in ihrem aktuellen Status nicht neu zugewiesen werden."});
    if(!driver)return reply(400,{error:"Fahrer ist nicht verfügbar oder gehört nicht zu diesem Bereich."});
    if(!vehicle)return reply(400,{error:"Fahrzeug ist nicht verfügbar oder gehört nicht zu diesem Bereich."});
    if(["werkstatt","offline"].includes(vehicle.status))return reply(409,{error:"Dieses Fahrzeug ist aktuell nicht einsatzbereit."});

    const targetStart=timeMinutes(trip.scheduled_time);
    const targetDuration=estimateTripMinutes(trip.trip_type);

    const {data:driverTrips}=await db.from("trips")
      .select("id,scheduled_time,trip_type,customer_name")
      .eq("business_unit_id",unit.id).eq("service_date",trip.service_date)
      .eq("driver_id",driver.id).in("status",activeTripStatuses).neq("id",trip.id);
    const driverConflict=(driverTrips||[]).find((item:any)=>
      overlaps(targetStart,targetDuration,timeMinutes(item.scheduled_time),estimateTripMinutes(item.trip_type))
    );
    if(driverConflict)return reply(409,{error:"Fahrer-Konflikt: Die Fahrt überschneidet sich mit einer anderen Fahrt inklusive 15 Minuten Puffer."});

    const {data:vehicleTrips}=await db.from("trips")
      .select("id,scheduled_time,trip_type,customer_name")
      .eq("business_unit_id",unit.id).eq("service_date",trip.service_date)
      .eq("vehicle_id",vehicle.id).in("status",activeTripStatuses).neq("id",trip.id);
    const vehicleConflict=(vehicleTrips||[]).find((item:any)=>
      overlaps(targetStart,targetDuration,timeMinutes(item.scheduled_time),estimateTripMinutes(item.trip_type))
    );
    if(vehicleConflict)return reply(409,{error:"Fahrzeug-Konflikt: Das Fahrzeug ist in diesem Zeitraum bereits eingeplant, inklusive 15 Minuten Puffer."});

    const nextStatus=trip.status==="offen"?"geplant":"geplant";
    const {data:updated,error}=await db.from("trips").update({
      driver_id:driver.id,driver_name:driver.full_name,vehicle_id:vehicle.id,vehicle_registration:vehicle.registration,
      customer_name:[customer.first_name,customer.last_name].filter(Boolean).join(" "),customer_mobility:customer.mobility,
      status:nextStatus,assigned_at:new Date().toISOString(),updated_by:user.id,updated_at:new Date().toISOString()
    }).eq("id",trip.id).select("*").single();

    if(error||!updated)return reply(400,{error:error?.message||"Fahrt konnte nicht zugewiesen werden."});

    await db.from("trip_status_events").insert({
      trip_id:trip.id,status:"zugewiesen",actor_user_id:user.id,actor_driver_id:driver.id,
      note:`${driver.full_name} · ${vehicle.registration}`
    });

    return reply(200,{ok:true,trip:updated});
  }

  if(action==="report_location"){
    if(membership.role!=="driver"||!driverId)return reply(403,{error:"Nur Fahrer dürfen Live-Positionen melden."});
    const trip=await getTrip(String(body.tripId||""));
    if(!trip||trip.driver_id!==driverId)return reply(403,{error:"Diese Fahrt ist dir nicht zugewiesen."});
    if(!["auf_dem_weg","angekommen","in_fahrt"].includes(trip.status))return reply(400,{error:"Live-Position wird nur während einer aktiven Fahrt gespeichert."});

    const latitude=Number(body.latitude);
    const longitude=Number(body.longitude);
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<-90||latitude>90||longitude<-180||longitude>180){
      return reply(400,{error:"Ungültige Position."});
    }

    const {error}=await db.from("driver_live_locations").upsert({
      trip_id:trip.id,
      business_unit_id:unit.id,
      driver_id:driverId,
      latitude,
      longitude,
      accuracy_m:Number.isFinite(Number(body.accuracy))?Number(body.accuracy):null,
      heading:Number.isFinite(Number(body.heading))?Number(body.heading):null,
      speed_mps:Number.isFinite(Number(body.speed))?Number(body.speed):null,
      updated_at:new Date().toISOString()
    },{onConflict:"trip_id"});

    if(error)return reply(400,{error:error.message});
    return reply(200,{ok:true});
  }

  if(action==="update_status"){
    const tripId=String(body.tripId||"");
    const nextStatus=String(body.status||"");
    const trip=await getTrip(tripId);
    if(!trip)return reply(404,{error:"Fahrt wurde nicht gefunden."});

    if(membership.role==="driver"){
      if(!driverId||trip.driver_id!==driverId)return reply(403,{error:"Diese Fahrt ist dir nicht zugewiesen."});
      if(!["auf_dem_weg","angekommen","in_fahrt","abgeschlossen"].includes(nextStatus))return reply(403,{error:"Dieser Status darf in der Fahrer-App nicht gesetzt werden."});
    }else if(!isStaff){
      return reply(403,{error:"Keine Berechtigung."});
    }

    let updated:any;
    if(unitCode==='taxi'&&['auf_dem_weg','angekommen','in_fahrt'].includes(nextStatus)&&trip.driver_id){
      const {data:rides,error:rideError}=await db.from('taxi_live_rides').select('id').eq('business_unit_id',unit.id).eq('driver_id',trip.driver_id).in('status',['assigned','to_pickup','arrived','occupied']).limit(1);
      if(rideError)return reply(503,{error:'Aktive Taxifahrt konnte nicht geprüft werden.'});
      if(rides?.length)return reply(409,{error:'Einsteigerfahrt zuerst beenden.'});
    }
    if(membership.role==='driver' && body.requestId){
      const {data:result,error}=await db.rpc('sync_driver_trip_status',{p_unit:unit.id,p_actor:user.id,p_request:body.requestId,p_trip:tripId,p_shift:body.shiftId,p_expected:body.expectedStatus,p_status:nextStatus,p_version:body.baseVersion||null,p_predecessor:body.predecessorId||null,p_event:body.recordedAt});
      if(error)return reply(409,{error:error.message});
      updated=result.trip;
    }else{
    if(["auf_dem_weg","angekommen","in_fahrt"].includes(nextStatus)&&trip.driver_id){
      const {data:busy}=await db.from("trips").select("id").eq("business_unit_id",unit.id).eq("driver_id",trip.driver_id).in("status",["auf_dem_weg","angekommen","in_fahrt"]).neq("id",trip.id).limit(1);
      if(busy?.length)return reply(409,{error:"Der Fahrer hat bereits eine aktive Fahrt."});
    }

    const {data:changed,error}=await db.from("trips").update({
      status:nextStatus,updated_by:user.id,updated_at:new Date().toISOString()
    }).eq("id",trip.id).select("*").single();

    if(error||!changed)return reply(400,{error:error?.message||"Status konnte nicht geändert werden."});

    updated=changed;
    if(updated.driver_id){
      const driverStatus=["auf_dem_weg","angekommen","in_fahrt"].includes(nextStatus)?nextStatus:"frei";
      await db.from("drivers").update({status:driverStatus,updated_at:new Date().toISOString()}).eq("id",updated.driver_id);
    }
    if(updated.vehicle_id){
      const vehicleStatus=["auf_dem_weg","angekommen","in_fahrt"].includes(nextStatus)?"unterwegs":"frei";
      await db.from("vehicles").update({status:vehicleStatus,updated_at:new Date().toISOString()}).eq("id",updated.vehicle_id);
    }
    if(!["auf_dem_weg","angekommen","in_fahrt"].includes(nextStatus)){
      await db.from("driver_live_locations").delete().eq("trip_id",updated.id);
    }

    }

    if(nextStatus==="abgeschlossen" && ["fahrdienst","taxi"].includes(unitCode)){
      const {data:existingCase}=await db.from("trip_billing_cases").select("id").eq("trip_id",updated.id).maybeSingle();
      if(!existingCase){
        const {data:insurance}=await db.from("customer_insurances")
          .select("*").eq("customer_id",updated.customer_id).eq("is_primary",true)
          .or("valid_from.is.null,valid_from.lte."+updated.service_date)
          .or("valid_until.is.null,valid_until.gte."+updated.service_date)
          .order("created_at",{ascending:false}).limit(1).maybeSingle();

        const privateTrip=updated.billing_payer_type==="private"||(updated.billing_payer_type!=="insurer"&&!insurance);
        if(privateTrip){
          let fare:any=null;if(updated.private_price!=null){try{fare=privateFare({amount:updated.private_price,vatRate:updated.private_vat_rate})}catch{}}
          const {error:caseError}=await db.from("trip_billing_cases").upsert({business_unit_id:unit.id,trip_id:updated.id,customer_id:updated.customer_id,payer_type:"private",private_amount:fare?.gross||null,private_vat_rate:updated.private_vat_rate||0,gross_amount:fare?.gross||0,own_share_amount:0,insurer_amount:0,own_share_required:false,copay_rule_version:COPAY_RULE_VERSION,copay_note:"Privatfahrt: Kunde zahlt den gesamten Fahrtbetrag.",billing_status:fare?"ready":"review",review_message:fare?"":"Privatpreis vor Rechnungserstellung prüfen.",direction_count:1,calculated_at:new Date().toISOString()},{onConflict:"trip_id",ignoreDuplicates:true});
          if(caseError)return reply(body.requestId?503:409,{error:"Fahrt abgeschlossen, Abrechnungsfall konnte nicht erstellt werden. Abschluss erneut speichern."});
          return reply(200,{ok:true,trip:updated});
        }
        let insurer:any=null, contract:any=null, defaultKm:any=null;
        if(insurance){
          if(insurance.insurer_code){
            const {data}=await db.from("health_insurers").select("*").eq("organization_id",profile.organization_id).eq("ik_number",insurance.insurer_code).eq("active",true).maybeSingle();
            insurer=data;
          }
          if(!insurer && insurance.insurer_name){
            const {data}=await db.from("health_insurers").select("*").eq("organization_id",profile.organization_id).ilike("name",insurance.insurer_name).eq("active",true).maybeSingle();
            insurer=data;
          }
          contract=await resolveContract(db,unit.id,profile.organization_id,insurer?.id,updated.service_date,insurance.tariff_id,tripServiceType(updated));

        }

        const {data:dest}=await db.from("customer_destinations").select("default_km,address").eq("customer_id",updated.customer_id).eq("active",true).eq("address",updated.to_address).limit(1).maybeSingle();
        if(dest?.default_km!=null) defaultKm=Number(dest.default_km);



        let legacyRates=[];
        if(contract?.tariff_lines==null&&contract){const {data:rates}=await db.from("contract_rates").select("*").eq("contract_id",contract.id).eq("active",true).order("sort_order");legacyRates=rates||[];}
        const journeyKind=updated.series_id?"series":"single";
        const tariff=calculateTariff(contract,legacyRates,{date:updated.service_date,km:defaultKm,waitingMinutes:0,treatmentCode:defaultTreatment(updated.trip_type),vehicleClass:"unconfirmed",journeyKind,area:"unconfirmed"});
        const {base:baseFee,kmRate,surcharge,gross}=tariff;
        const copay=calculateOwnShare({gross,insurance,date:updated.service_date,lines:tariff.lines,positionCode:legacyRates[0]?.position_code});
        const actualOwnShare=copay.amount;
        const insurerAmount=Math.max(0,Math.round((gross-actualOwnShare+Number.EPSILON)*100)/100);
        const positionCode=tariff.lines.find(l=>l.kind==="km")?.template||tariff.lines[0]?.template||legacyRates[0]?.position_code||null;
        const treatmentCode=defaultTreatment(updated.trip_type)||null;
        const billingPosition=composeBillingPosition(positionCode,treatmentCode);
        const review:string[]=[...tariff.review];
        if(!insurance) review.push("Keine primäre Krankenversicherung hinterlegt.");
        if(insurance && !insurer) review.push("Krankenkasse konnte keinem Kostenträger zugeordnet werden.");
        if(insurance && !contract) review.push("Kein aktiver Kassenvertrag gefunden.");



        const ready=review.length===0;

        const {error:caseError}=await db.from("trip_billing_cases").upsert({
          business_unit_id:unit.id,trip_id:updated.id,customer_id:updated.customer_id,
          copay_rule_version:COPAY_RULE_VERSION,copay_note:copay.note,direction_count:1,insurance_id:insurance?.id||null,insurer_id:insurer?.id||null,contract_id:contract?.id||null,
          position_code:positionCode,treatment_code:treatmentCode,billing_position:billingPosition,billing_status:!contract?"blocked":ready?"ready":"review",payer_type:"insurer",
          billable_km:defaultKm,base_fee:baseFee,km_rate:kmRate,surcharge_amount:surcharge,
          tariff_breakdown:tariff.lines,billing_vehicle_class:"unconfirmed",billing_journey_kind:journeyKind,billing_area:"unconfirmed",
          gross_amount:gross,own_share_amount:actualOwnShare,insurer_amount:insurerAmount,
          own_share_required:actualOwnShare>0,review_message:review.join(" "),calculated_at:new Date().toISOString()
        },{onConflict:"trip_id",ignoreDuplicates:true});
        if(caseError)return reply(body.requestId?503:409,{error:"Fahrt abgeschlossen, Abrechnungsfall konnte nicht erstellt werden. Abschluss erneut speichern."});
      }
    }

    return reply(200,{ok:true,trip:updated});
  }

  if(action==="cancel_trip"){
    if(!isStaff)return reply(403,{error:"Nur Chef oder Büro dürfen Fahrten stornieren."});
    const trip=await getTrip(String(body.tripId||""));
    if(!trip)return reply(404,{error:"Fahrt wurde nicht gefunden."});
    if(["abgeschlossen","storniert"].includes(trip.status))return reply(400,{error:"Diese Fahrt kann nicht mehr storniert werden."});

    const {data:updated,error}=await db.from("trips").update({status:"storniert",updated_by:user.id,updated_at:new Date().toISOString()}).eq("id",trip.id).select("*").single();
    if(error||!updated)return reply(400,{error:error?.message||"Fahrt konnte nicht storniert werden."});
    if(updated.driver_id)await db.from("drivers").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",updated.driver_id);
    if(updated.vehicle_id)await db.from("vehicles").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",updated.vehicle_id);
    await db.from("driver_live_locations").delete().eq("trip_id",updated.id);
    return reply(200,{ok:true,trip:updated});
  }

  return reply(400,{error:"Unbekannte Aktion."});
});


