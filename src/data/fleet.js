import { APP_CONFIG } from '../config/app.js';
import { supabase } from '../lib/supabase.js';

async function getUnit() {
  const { data, error } = await supabase
    .from('business_units')
    .select('id,code,name')
    .eq('code', APP_CONFIG.businessUnitCode)
    .eq('active', true)
    .maybeSingle();
  if (error || !data) throw new Error('Geschaeftsbereich konnte nicht geladen werden.');
  return data;
}

export async function listFleet() {
  const unit = await getUnit();
  const [driverLinks, vehicleLinks, assignments] = await Promise.all([
    supabase.from('driver_business_units').select('driver_id').eq('business_unit_id', unit.id),
    supabase.from('vehicle_business_units').select('vehicle_id').eq('business_unit_id', unit.id),
    supabase.from('driver_vehicle_assignments')
      .select('id,driver_id,vehicle_id,assigned_at')
      .eq('business_unit_id', unit.id)
      .is('released_at', null)
  ]);

  if (driverLinks.error) throw driverLinks.error;
  if (vehicleLinks.error) throw vehicleLinks.error;
  if (assignments.error) throw assignments.error;

  const driverIds = (driverLinks.data || []).map(x => x.driver_id);
  const vehicleIds = (vehicleLinks.data || []).map(x => x.vehicle_id);

  const [driverRows, vehicleRows] = await Promise.all([
    driverIds.length
      ? supabase.from('drivers')
          .select('id,full_name,email,phone,personnel_number,license_number,license_expiry,notes,active,status,created_at,updated_at')
          .in('id', driverIds)
          .order('full_name')
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length
      ? supabase.from('vehicles')
          .select('id,registration,make,model,vin,model_year,mileage,seats,wheelchair_capable,tuv_due,service_due,notes,active,status,created_at,updated_at')
          .in('id', vehicleIds)
          .order('registration')
      : Promise.resolve({ data: [], error: null })
  ]);

  if (driverRows.error) throw driverRows.error;
  if (vehicleRows.error) throw vehicleRows.error;

  const vehicleMap = new Map((vehicleRows.data || []).map(v => [v.id, v]));
  const assignmentMap = new Map((assignments.data || []).map(a => [a.driver_id, a]));

  const drivers = (driverRows.data || []).map(d => {
    const assignment = assignmentMap.get(d.id);
    const vehicle = assignment ? vehicleMap.get(assignment.vehicle_id) : null;
    return {
      id: d.id,
      name: d.full_name,
      fullName: d.full_name,
      email: d.email || '',
      phone: d.phone || '',
      personnelNumber: d.personnel_number || '',
      licenseNumber: d.license_number || '',
      licenseExpiry: d.license_expiry || '',
      notes: d.notes || '',
      active: d.active,
      status: d.status,
      vehicleId: vehicle?.id || null,
      vehicle: vehicle?.registration || '',
      vehicleLabel: vehicle ? [vehicle.make, vehicle.model].filter(Boolean).join(' ') : '',
      assignedAt: assignment?.assigned_at || null,
      createdAt: d.created_at,
      updatedAt: d.updated_at
    };
  });

  const driverByVehicle = new Map(
    drivers.filter(d => d.vehicleId).map(d => [d.vehicleId, d])
  );

  const vehicles = (vehicleRows.data || []).map(v => ({
    id: v.id,
    registration: v.registration,
    make: v.make || '',
    model: v.model || '',
    vin: v.vin || '',
    modelYear: v.model_year || '',
    mileage: v.mileage || 0,
    seats: v.seats || '',
    wheelchairCapable: v.wheelchair_capable,
    tuvDue: v.tuv_due || '',
    serviceDue: v.service_due || '',
    notes: v.notes || '',
    active: v.active,
    status: v.status,
    driverId: driverByVehicle.get(v.id)?.id || null,
    driverName: driverByVehicle.get(v.id)?.name || '',
    createdAt: v.created_at,
    updatedAt: v.updated_at
  }));

  return { unit, drivers, vehicles };
}

async function invokeFleet(body) {
  const { data, error } = await supabase.functions.invoke('manage-fleet', {
    body: { ...body, businessUnitCode: APP_CONFIG.businessUnitCode }
  });
  if (error) return { ok: false, message: error.message || 'Fuhrpark konnte nicht gespeichert werden.' };
  if (data?.error) return { ok: false, message: data.error };
  return { ok: true, data };
}

export const createDriver = input => invokeFleet({ action: 'create_driver', ...input });
export const updateDriver = (driverId, input) => invokeFleet({ action: 'update_driver', driverId, ...input });
export const createVehicle = input => invokeFleet({ action: 'create_vehicle', ...input });
export const updateVehicle = (vehicleId, input) => invokeFleet({ action: 'update_vehicle', vehicleId, ...input });
export const assignVehicle = (driverId, vehicleId) => invokeFleet({ action: 'assign_vehicle', driverId, vehicleId });
export const releaseVehicle = driverId => invokeFleet({ action: 'release_vehicle', driverId });
