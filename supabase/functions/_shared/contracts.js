export function insurerGroup(insurer) {
  const name = `${insurer?.name || ''} ${insurer?.short_name || ''}`.toLowerCase();
  if (/\baok\b/.test(name)) return 'aok';
  if (/\bdak\b/.test(name)) return 'dak';
  return insurer?.contract_group || 'ersatzkassen';
}

export function validOn(contract, date) {
  return Boolean(contract?.active && date && (!contract.valid_from || contract.valid_from <= date) && (!contract.valid_until || contract.valid_until >= date));
}

export function chooseContract(contracts, insurer, date, preferredId) {
  if (!insurer?.active) return null;
  const valid = contracts.filter(c => validOn(c, date));
  const sort = (a, b) => Number(b.id === preferredId) - Number(a.id === preferredId) || String(b.valid_from || '').localeCompare(String(a.valid_from || '')) || String(a.id).localeCompare(String(b.id));
  const individual = valid.filter(c => (c.contract_scope || 'individual') === 'individual' && c.insurer_id === insurer.id).sort(sort);
  if (individual.length) return individual[0];
  const group = insurerGroup(insurer);
  // AOK and DAK always need their own individual contract.
  if (group === 'aok' || group === 'dak' || group === 'individual') return null;
  return valid.filter(c => c.contract_scope === 'group' && (c.contract_group || c.applies_to_group) === group).sort(sort)[0] || null;
}

export function composeBillingPosition(template, treatmentCode) {
  const base = String(template || '').trim().toUpperCase();
  const code = String(treatmentCode || '').trim();
  if (!base) return null;
  if (base.endsWith('XX')) return /^\d+XX$/.test(base) && /^\d{2}$/.test(code) ? base.slice(0, -2) + code : null;
  return /^\d{5,12}$/.test(base) ? base : /^\d{4}$/.test(base) && /^\d{2}$/.test(code) ? base + code : null;
}

export function defaultTreatment(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('dialyse')) return '52';
  if (value.includes('arzt') || value.includes('ambulant')) return '05';
  return '';
}

export async function resolveContract(db, unitId, organizationId, insurerId, date, preferredId) {
  if (!insurerId) return null;
  const {data: insurer, error: ie} = await db.from('health_insurers').select('*').eq('id', insurerId).eq('organization_id', organizationId).maybeSingle();
  if (ie) throw ie;
  const {data: contracts, error} = await db.from('payer_contracts').select('*').eq('business_unit_id', unitId).eq('active', true);
  if (error) throw error;
  return chooseContract(contracts || [], insurer, date, preferredId);
}
