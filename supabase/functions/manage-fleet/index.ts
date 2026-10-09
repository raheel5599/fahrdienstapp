import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Nur POST ist erlaubt." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Backend-Konfiguration fehlt." });

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json(401, { error: "Nicht angemeldet." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  const requester = userResult?.user;
  if (userError || !requester) return json(401, { error: "Sitzung ist nicht gültig." });

  const { data: profile } = await admin
    .from("app_profiles")
    .select("id, organization_id, active")
    .eq("id", requester.id)
    .maybeSingle();
  if (!profile?.active) return json(403, { error: "Dieser Zugang ist nicht freigeschaltet." });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Ungültige Anfrage." });
  }

  const unitCode = String(body?.businessUnitCode || "").trim();
  const { data: unit } = await admin
    .from("business_units")
    .select("id, organization_id, code, active")
    .eq("organization_id", profile.organization_id)
    .eq("code", unitCode)
    .eq("active", true)
    .maybeSingle();

  if (!unit) return json(400, { error: "Geschäftsbereich wurde nicht gefunden." });

  const { data: membership } = await admin
    .from("memberships")
    .select("role, active")
    .eq("user_id", requester.id)
    .eq("business_unit_id", unit.id)
    .eq("active", true)
    .maybeSingle();

  const role = membership?.role;
  const isAdmin = role === "admin";
  const isOffice = role === "office";
  if (!isAdmin && !isOffice) return json(403, { error: "Keine Berechtigung für die Fuhrparkverwaltung." });

  const action = String(body?.action || "");

  if (action === "create_driver") {
    if (!isAdmin) return json(403, { error: "Nur Administratoren dürfen Fahrer anlegen." });
    const fullName = cleanText(body?.fullName);
    if (!fullName) return json(400, { error: "Name des Fahrers fehlt." });

    const { data: driver, error } = await admin.from("drivers").insert({
      organization_id: profile.organization_id,
      full_name: fullName,
      email: cleanText(body?.email),
      phone: cleanText(body?.phone),
      personnel_number: cleanText(body?.personnelNumber),
      license_number: cleanText(body?.licenseNumber),
      license_expiry: cleanText(body?.licenseExpiry),
      notes: cleanText(body?.notes),
      active: true,
      status: "frei",
    }).select("id").single();

    if (error || !driver) return json(400, { error: error?.message || "Fahrer konnte nicht angelegt werden." });

    const { error: linkError } = await admin.from("driver_business_units").insert({
      driver_id: driver.id,
      business_unit_id: unit.id,
    });

    if (linkError) {
      await admin.from("drivers").delete().eq("id", driver.id);
      return json(500, { error: "Fahrer konnte dem Geschäftsbereich nicht zugeordnet werden." });
    }

    return json(200, { ok: true, id: driver.id });
  }

  if (action === "update_driver") {
    if (!isAdmin) return json(403, { error: "Nur Administratoren dürfen Fahrer bearbeiten." });
    const driverId = String(body?.driverId || "");
    const fullName = cleanText(body?.fullName);
    if (!driverId || !fullName) return json(400, { error: "Fahrerdaten sind unvollständig." });

    const { data: linked } = await admin
      .from("driver_business_units")
      .select("driver_id")
      .eq("driver_id", driverId)
      .eq("business_unit_id", unit.id)
      .maybeSingle();
    if (!linked) return json(404, { error: "Fahrer wurde in diesem Bereich nicht gefunden." });

    const { error } = await admin.from("drivers").update({
      full_name: fullName,
      email: cleanText(body?.email),
      phone: cleanText(body?.phone),
      personnel_number: cleanText(body?.personnelNumber),
      license_number: cleanText(body?.licenseNumber),
      license_expiry: cleanText(body?.licenseExpiry),
      notes: cleanText(body?.notes),
      active: body?.active !== false,
      updated_at: new Date().toISOString(),
    }).eq("id", driverId).eq("organization_id", profile.organization_id);

    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === "create_vehicle") {
    const registration = String(body?.registration || "").trim().toUpperCase();
    if (!registration) return json(400, { error: "Kennzeichen fehlt." });

    const mileage = Math.max(0, Number(body?.mileage || 0));
    const seats = body?.seats ? Math.max(1, Number(body.seats)) : null;
    const modelYear = body?.modelYear ? Number(body.modelYear) : null;

    const { data: vehicle, error } = await admin.from("vehicles").insert({
      organization_id: profile.organization_id,
      registration,
      make: cleanText(body?.make),
      model: cleanText(body?.model),
      vin: cleanText(body?.vin),
      model_year: modelYear,
      mileage,
      seats,
      wheelchair_capable: Boolean(body?.wheelchairCapable),
      tuv_due: cleanText(body?.tuvDue),
      service_due: cleanText(body?.serviceDue),
      notes: cleanText(body?.notes),
      active: true,
      status: "frei",
    }).select("id").single();

    if (error || !vehicle) return json(400, { error: error?.message || "Fahrzeug konnte nicht angelegt werden." });

    const { error: linkError } = await admin.from("vehicle_business_units").insert({
      vehicle_id: vehicle.id,
      business_unit_id: unit.id,
    });

    if (linkError) {
      await admin.from("vehicles").delete().eq("id", vehicle.id);
      return json(500, { error: "Fahrzeug konnte dem Geschäftsbereich nicht zugeordnet werden." });
    }

    return json(200, { ok: true, id: vehicle.id });
  }

  if (action === "update_vehicle") {
    const vehicleId = String(body?.vehicleId || "");
    const registration = String(body?.registration || "").trim().toUpperCase();
    if (!vehicleId || !registration) return json(400, { error: "Fahrzeugdaten sind unvollständig." });

    const { data: linked } = await admin
      .from("vehicle_business_units")
      .select("vehicle_id")
      .eq("vehicle_id", vehicleId)
      .eq("business_unit_id", unit.id)
      .maybeSingle();
    if (!linked) return json(404, { error: "Fahrzeug wurde in diesem Bereich nicht gefunden." });

    const { error } = await admin.from("vehicles").update({
      registration,
      make: cleanText(body?.make),
      model: cleanText(body?.model),
      vin: cleanText(body?.vin),
      model_year: body?.modelYear ? Number(body.modelYear) : null,
      mileage: Math.max(0, Number(body?.mileage || 0)),
      seats: body?.seats ? Math.max(1, Number(body.seats)) : null,
      wheelchair_capable: Boolean(body?.wheelchairCapable),
      tuv_due: cleanText(body?.tuvDue),
      service_due: cleanText(body?.serviceDue),
      notes: cleanText(body?.notes),
      active: body?.active !== false,
      status: String(body?.status || "frei"),
      updated_at: new Date().toISOString(),
    }).eq("id", vehicleId).eq("organization_id", profile.organization_id);

    if (error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === "assign_vehicle" || action === "release_vehicle") {
    const { data, error } = await admin.rpc("set_office_shift_vehicle", {
      p_unit: unit.id, p_actor: requester.id, p_driver: body.driverId,
      p_vehicle: action === "assign_vehicle" ? body.vehicleId : null,
    });
    return error ? json(409, { error: error.message }) : json(200, data);
  }

  return json(400, { error: "Unbekannte Aktion." });
});
