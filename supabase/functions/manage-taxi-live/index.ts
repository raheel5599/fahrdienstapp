import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};
const reply=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
const clean=(v:any,n=500)=>{const s=String(v??"").trim().slice(0,n);return s||null};
const coord=(v:any,min:number,max:number)=>{const n=Number(v);return Number.isFinite(n)&&n>=min&&n<=max?n:null};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});
  if(req.method!=="POST")return reply(405,{error:"Nur POST ist erlaubt."});

  const url=Deno.env.get("SUPABASE_URL");
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return reply(500,{error:"Backend-Konfiguration fehlt."});

  const auth=req.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData}=await db.auth.getUser(token);
  const user=userData?.user;
  if(!user)return reply(401,{error:"Nicht angemeldet."});

  const {data:profile}=await db.from("app_profiles").select("organization_id,active").eq("id",user.id).maybeSingle();
  if(!profile?.active)return reply(403,{error:"Zugang gesperrt."});

  let body:any={};
  try{body=await req.json();}catch{return reply(400,{error:"Ungültige Anfrage."});}

  const {data:unit}=await db.from("business_units").select("id").eq("organization_id",profile.organization_id).eq("code",String(body.businessUnitCode||"")).eq("active",true).maybeSingle();
  if(!unit)return reply(400,{error:"Geschäftsbereich fehlt."});

  const {data:membership}=await db.from("memberships").select("role,driver_id").eq("user_id",user.id).eq("business_unit_id",unit.id).eq("active",true).maybeSingle();
  if(!membership)return reply(403,{error:"Keine Berechtigung."});

  const isStaff=["admin","office"].includes(membership.role);
  const driverId=membership.driver_id||null;

  async function ownRide(id:string){
    const {data}=await db.from("taxi_live_rides").select("*").eq("id",id).eq("business_unit_id",unit.id).maybeSingle();
    if(!data)return null;
    if(membership.role==="driver"&&data.driver_id!==driverId)return null;
    return data;
  }

  async function assignedVehicle(){
    if(!driverId)return null;
    const {data:shift}=await db.from("driver_shifts").select("vehicle_id,state").eq("business_unit_id",unit.id).eq("driver_id",driverId).is("ended_at",null).maybeSingle();
    if(shift?.state!=="active")return null;
    const {data:link}=await db.from("vehicle_business_units").select("vehicle_id").eq("business_unit_id",unit.id).eq("vehicle_id",shift.vehicle_id).maybeSingle();
    if(!link)return null;
    const {data:vehicle}=await db.from("vehicles").select("id,registration,status,active").eq("id",shift.vehicle_id).maybeSingle();
    return vehicle?.active?vehicle:null;
  }

  const action=String(body.action||"");

  if(action==="start"){
    if(membership.role!=="driver"||!driverId)return reply(403,{error:"Nur Fahrer dürfen eine Einsteigerfahrt starten."});
    const vehicle=await assignedVehicle();
    if(!vehicle)return reply(400,{error:"Vor Einsteigerfahrten eine aktive Schicht mit Fahrzeug anmelden."});

    const {data:active}=await db.from("taxi_live_rides").select("id").eq("business_unit_id",unit.id).eq("driver_id",driverId).in("status",["assigned","to_pickup","arrived","occupied"]).limit(1);
    if(active?.length)return reply(409,{error:"Du hast bereits eine aktive Taxifahrt."});

    const {data:orders,error:orderError}=await db.from("trips").select("id").eq("business_unit_id",unit.id).eq("driver_id",driverId).in("status",["auf_dem_weg","angekommen","in_fahrt"]).limit(1);
    if(orderError)return reply(503,{error:"Laufende Aufträge konnten nicht geprüft werden."});
    if(orders?.length)return reply(409,{error:"Laufenden Auftrag zuerst beenden."});
    const lat=coord(body.pickupLat,-90,90),lng=coord(body.pickupLng,-180,180);
    if(lat===null||lng===null)return reply(400,{error:"Abfahrtsstandort fehlt."});
    const mode=["known","later","unknown"].includes(body.destinationMode)?body.destinationMode:"unknown";

    const {data:ride,error}=await db.from("taxi_live_rides").insert({
      business_unit_id:unit.id,
      driver_id:driverId,
      vehicle_id:vehicle.id,
      source:["manual","hale"].includes(body.source)?body.source:"manual",
      status:"occupied",
      pickup_address:clean(body.pickupAddress,300),
      pickup_lat:lat,
      pickup_lng:lng,
      destination_address:clean(body.destinationAddress,300),
      destination_mode:mode,
      started_at:new Date().toISOString(),
      hale_state:clean(body.haleState,50),
      created_by:user.id,
      updated_by:user.id
    }).select("*").single();
    if(error||!ride)return reply(400,{error:error?.message||"Fahrt konnte nicht gestartet werden."});

    await db.from("drivers").update({status:"in_fahrt",updated_at:new Date().toISOString()}).eq("id",driverId);
    await db.from("vehicles").update({status:"unterwegs",updated_at:new Date().toISOString()}).eq("id",vehicle.id);

    return reply(200,{ok:true,ride,vehicle});
  }

  if(action==="update"){
    const ride=await ownRide(String(body.rideId||""));
    if(!ride)return reply(404,{error:"Fahrt nicht gefunden."});
    if(!["assigned","to_pickup","arrived","occupied"].includes(ride.status))return reply(409,{error:"Diese Fahrt kann nicht mehr geändert werden."});
    if(membership.role!=="driver"&&!isStaff)return reply(403,{error:"Keine Berechtigung."});

    const patch:any={updated_by:user.id,updated_at:new Date().toISOString()};
    if(body.pickupAddress!==undefined)patch.pickup_address=clean(body.pickupAddress,300);
    if(body.destinationAddress!==undefined)patch.destination_address=clean(body.destinationAddress,300);
    if(["known","later","unknown"].includes(body.destinationMode))patch.destination_mode=body.destinationMode;

    const {data,error}=await db.from("taxi_live_rides").update(patch).eq("id",ride.id).select("*").single();
    return error?reply(400,{error:error.message}):reply(200,{ok:true,ride:data});
  }

  if(action==="location"){
    if(membership.role!=="driver"||!driverId)return reply(403,{error:"Nur Fahrer dürfen Live-Positionen senden."});
    const ride=await ownRide(String(body.rideId||""));
    if(!ride||ride.driver_id!==driverId)return reply(404,{error:"Aktive Fahrt nicht gefunden."});
    if(!["assigned","to_pickup","arrived","occupied"].includes(ride.status))return reply(409,{error:"Fahrt ist nicht aktiv."});

    const lat=coord(body.latitude,-90,90),lng=coord(body.longitude,-180,180);
    if(lat===null||lng===null)return reply(400,{error:"Ungültige Position."});

    const {error}=await db.from("taxi_live_locations").upsert({
      ride_id:ride.id,business_unit_id:unit.id,driver_id:driverId,
      latitude:lat,longitude:lng,
      accuracy_m:Number.isFinite(Number(body.accuracy))?Number(body.accuracy):null,
      heading:Number.isFinite(Number(body.heading))?Number(body.heading):null,
      speed_mps:Number.isFinite(Number(body.speed))?Number(body.speed):null,
      updated_at:new Date().toISOString()
    },{onConflict:"ride_id"});
    return error?reply(400,{error:error.message}):reply(200,{ok:true});
  }

  if(action==="finish"){
    if(membership.role!=="driver"||!driverId)return reply(403,{error:"Nur Fahrer dürfen die Fahrt beenden."});
    const ride=await ownRide(String(body.rideId||""));
    if(!ride||ride.driver_id!==driverId)return reply(404,{error:"Fahrt nicht gefunden."});
    if(ride.status!=="occupied")return reply(409,{error:"Nur eine besetzte Fahrt kann beendet werden."});

    const lat=coord(body.destinationLat,-90,90),lng=coord(body.destinationLng,-180,180);
    if(lat===null||lng===null)return reply(400,{error:"Zielstandort fehlt."});

    const {data,error}=await db.from("taxi_live_rides").update({
      status:"completed",
      destination_address:clean(body.destinationAddress,300)||ride.destination_address,
      destination_lat:lat,
      destination_lng:lng,
      completed_at:new Date().toISOString(),
      updated_by:user.id,
      updated_at:new Date().toISOString()
    }).eq("id",ride.id).select("*").single();
    if(error||!data)return reply(400,{error:error?.message||"Fahrt konnte nicht beendet werden."});

    await db.from("taxi_live_locations").delete().eq("ride_id",ride.id);
    await db.from("drivers").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",driverId);
    await db.from("vehicles").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",ride.vehicle_id);
    return reply(200,{ok:true,ride:data});
  }

  if(action==="cancel"){
    const ride=await ownRide(String(body.rideId||""));
    if(!ride)return reply(404,{error:"Fahrt nicht gefunden."});
    if(membership.role!=="driver"&&!isStaff)return reply(403,{error:"Keine Berechtigung."});
    if(["completed","cancelled"].includes(ride.status))return reply(409,{error:"Fahrt ist bereits beendet."});

    const {data,error}=await db.from("taxi_live_rides").update({
      status:"cancelled",cancelled_at:new Date().toISOString(),updated_by:user.id,updated_at:new Date().toISOString()
    }).eq("id",ride.id).select("*").single();
    if(error||!data)return reply(400,{error:error?.message||"Fahrt konnte nicht abgebrochen werden."});

    await db.from("taxi_live_locations").delete().eq("ride_id",ride.id);
    await db.from("drivers").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",ride.driver_id);
    await db.from("vehicles").update({status:"frei",updated_at:new Date().toISOString()}).eq("id",ride.vehicle_id);
    return reply(200,{ok:true,ride:data});
  }

  return reply(400,{error:"Unbekannte Aktion."});
});
