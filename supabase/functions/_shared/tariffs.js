import {composeBillingPosition} from './contracts.js';

export const tariffKinds = {base:'Grundpauschale',km:'Kilometerpreis',waiting:'Wartezeit',surcharge:'Zuschlag',flat:'Pauschale',meter:'Taxameter'};
export const tariffUnits = {ride:'Fahrt',km:'km',hour:'Stunde',minute:'Minute',flat:'Pauschale'};
export const moneyRound = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const intersects = (a,b) => a === 'all' || b === 'all' || a === b;
const periodOverlaps = (a,b) => (!a.valid_until || !b.valid_from || a.valid_until >= b.valid_from) && (!b.valid_until || !a.valid_from || b.valid_until >= a.valid_from);
const optionalNumber = value => value === '' || value == null ? null : Number(value);

// Normalize once on the server, and validate again whenever these tariffs are billed.
export function normalizeTariffLines(input) {
  if (!Array.isArray(input) || input.length > 200) throw new Error('Bis zu 200 Tarifpositionen sind zulässig.');
  const result = input.map((row,index) => {
    const line = {
      id: String(row.id || `position-${index}`), position_code:String(row.position_code || '').replace(/\s/g,'').toUpperCase(),
      label:String(row.label || '').trim(), kind:row.kind, unit:row.unit,
      price:Number(row.price), vehicle_class:row.vehicle_class || 'all', journey_kind:row.journey_kind || 'all', area:row.area || 'all',
      valid_from:row.valid_from || null, valid_until:row.valid_until || null,
      min_km:optionalNumber(row.min_km), max_km:optionalNumber(row.max_km),
      treatment_code:String(row.treatment_code || '').trim(), active:row.active !== false, sort_order:index
    };
    if (!line.label || !/^(?:\d{5,12}|\d{4}(?:XX)?)$/.test(line.position_code)) throw new Error(`Position ${index+1}: Bezeichnung und vollständige Positionsnummer bzw. Vorlage fehlen.`);
    if (!Object.hasOwn(tariffKinds,line.kind) || !Object.hasOwn(tariffUnits,line.unit)) throw new Error(`Position ${index+1}: Berechnungsart oder Einheit ungültig.`);
    if ((line.kind==='km' && line.unit!=='km') || (line.kind==='waiting' && !['hour','minute'].includes(line.unit)) || (!['km','waiting'].includes(line.kind) && !['ride','flat'].includes(line.unit))) throw new Error(`Position ${index+1}: Einheit passt nicht zur Berechnungsart.`);
    if ((row.price==null||row.price==='')&&line.kind!=='meter' || !Number.isFinite(line.price) || line.price<0) throw new Error(`Position ${index+1}: Betrag muss eingetragen werden und mindestens 0 € sein.`);
    line.price=moneyRound(line.price);
    if (!['all','taxi','mietwagen'].includes(line.vehicle_class) || !['all','single','series'].includes(line.journey_kind) || !['all','inside','outside'].includes(line.area)) throw new Error(`Position ${index+1}: Einsatzregel ungültig.`);
    if (line.treatment_code && !/^\d{2}$/.test(line.treatment_code)) throw new Error(`Position ${index+1}: Behandlungscode muss zweistellig sein.`);
    for (const date of [line.valid_from,line.valid_until]) {
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0,10)!==date)) throw new Error(`Position ${index+1}: Datum ungültig.`);
    }
    if (line.valid_from && line.valid_until && line.valid_from>line.valid_until) throw new Error(`Position ${index+1}: Gültigkeitszeitraum ungültig.`);
    for (const km of [line.min_km,line.max_km]) if (km!=null && (!Number.isFinite(km)||km<0)) throw new Error(`Position ${index+1}: Kilometergrenze ungültig.`);
    if (line.min_km!=null && line.max_km!=null && line.min_km>line.max_km) throw new Error(`Position ${index+1}: Kilometergrenzen vertauscht.`);
    return line;
  });
  for (let i=0;i<result.length;i++) for (let j=i+1;j<result.length;j++) {
    const a=result[i],b=result[j];
    if (!a.active || !b.active || !periodOverlaps(a,b) || !intersects(a.vehicle_class,b.vehicle_class) || !intersects(a.journey_kind,b.journey_kind) || !intersects(a.area,b.area) || (a.treatment_code && b.treatment_code && a.treatment_code!==b.treatment_code) || (a.max_km!=null && b.min_km!=null && a.max_km<b.min_km) || (b.max_km!=null && a.min_km!=null && b.max_km<a.min_km)) continue;
    if ((a.kind===b.kind && a.kind!=='surcharge') || a.position_code===b.position_code) throw new Error(`Tarifpositionen ${i+1} und ${j+1} überschneiden sich. Regeln oder Gültigkeitszeitraum trennen.`);
    if (['flat','meter'].includes(a.kind) && ['base','km','flat','meter'].includes(b.kind) || ['flat','meter'].includes(b.kind) && ['base','km','flat','meter'].includes(a.kind)) throw new Error('Pauschale/Taxameter und Grundpreis/km dürfen nicht gleichzeitig für dieselbe Fahrt gelten.');
  }
  return result;
}

export function calculateTariff(contract, legacyRates, input) {
  const {date,treatmentCode}=input;
  const km=Number(input.km || 0),waitingMinutes=Number(input.waitingMinutes || 0);
  if (![km,waitingMinutes].every(x=>Number.isFinite(x)&&x>=0)) throw new Error('Kilometer und Wartezeit müssen mindestens 0 sein.');
  if (!contract) return {lines:[],gross:0,review:[],base:0,kmRate:0,waiting:0,surcharge:0};
  // Existing contracts remain usable until their tariff table is entered explicitly.
  if (contract.tariff_lines==null) {
    const template=input.positionCode || legacyRates.find(r=>r.active)?.position_code;
    const position=composeBillingPosition(template,treatmentCode);
    if(/^5148/.test(String(template||''))){const price=Number(input.meterAmount),review=[];if(!position)review.push('Vollständige Positionsnummer und Fahrtart-Code prüfen.');if(!Number.isFinite(price)||price<=0)review.push('Taxameterbetrag fehlt.');const gross=review.length?0:moneyRound(price);return {lines:gross?[{position_code:position,template,label:'Taxameterfahrt gemäß Vertrag',quantity:1,unit:'ride',price:gross,amount:gross,kind:'meter'}]:[],gross,review,base:0,kmRate:0,waiting:0,surcharge:0};}
    const base=Number(contract.base_fee||0),kmRate=Number(contract.price_per_km||0),waiting=moneyRound(Number(contract.waiting_per_hour||0)*waitingMinutes/60);
    const gross=moneyRound(base+km*kmRate+waiting);
    const review=[];
    if(kmRate>0&&km<=0)review.push('Abrechnungs-km fehlen.');
    if(!position)review.push('Vollständige Positionsnummer und Fahrtart-Code prüfen.');
    return {lines:position?[{position_code:position,template,label:'Krankenfahrt gemäß Vertrag',quantity:1,unit:'ride',price:gross,amount:gross,kind:'flat'}]:[],gross,review,base,kmRate,waiting,surcharge:0};
  }
  const normalized=normalizeTariffLines(contract.tariff_lines);
  const rates=normalized.filter(r=>r.active&&(!r.valid_from||r.valid_from<=date)&&(!r.valid_until||r.valid_until>=date)&&(!r.treatment_code||r.treatment_code===treatmentCode));
  const review=[];
  if (rates.some(r=>r.vehicle_class!=='all') && !['taxi','mietwagen'].includes(input.vehicleClass)) review.push('Taxi oder Mietwagen auswählen.');
  const vehicleRates=rates.filter(r=>r.vehicle_class==='all'||r.vehicle_class===input.vehicleClass);
  if(vehicleRates.some(r=>r.area!=='all')&&!['inside','outside'].includes(input.area))review.push('Pflichtfahrgebiet: innerhalb oder außerhalb auswählen.');
  const applicable=vehicleRates.filter(r=>(r.journey_kind==='all'||r.journey_kind===input.journeyKind)&&(r.area==='all'||r.area===input.area)&&(r.min_km==null||km>=r.min_km)&&(r.max_km==null||km<=r.max_km));
  // A valid base fee alone must not hide a gap in a configured kilometer tariff.
  const configured=normalized.filter(r=>r.active&&(r.vehicle_class==='all'||r.vehicle_class===input.vehicleClass)&&(r.journey_kind==='all'||r.journey_kind===input.journeyKind)&&(r.area==='all'||r.area===input.area)&&(!r.treatment_code||r.treatment_code===treatmentCode)&&(r.min_km==null||km>=r.min_km)&&(r.max_km==null||km<=r.max_km));
  if(!applicable.some(r=>['flat','meter'].includes(r.kind)))for(const kind of ['base','km'])if(configured.some(r=>r.kind===kind)&&!applicable.some(r=>r.kind===kind))review.push(`Keine gültige ${tariffKinds[kind]}-Position am Fahrtag.`);
  if(applicable.some(r=>r.kind==='km')&&km<=0)review.push('Abrechnungs-km fehlen.');
  if(!applicable.some(r=>['base','km','flat','meter'].includes(r.kind)))review.push('Keine passende Grund-, Kilometer-, Pauschal- oder Taxameterposition am Fahrtag.');
  const lines=[];
  for(const rate of applicable){
    const position=composeBillingPosition(rate.position_code,treatmentCode);
    if(!position){review.push(`Behandlungscode für ${rate.position_code} fehlt.`);continue;}
    const quantity=rate.kind==='km'?km:rate.kind==='waiting'?(rate.unit==='hour'?waitingMinutes/60:waitingMinutes):1;
    let price=rate.price;
    if(rate.kind==='meter'){
      price=Number(input.meterAmount);
      if(!Number.isFinite(price)||price<=0){review.push('Taxameterbetrag fehlt.');continue;}
    }
    if(quantity<=0)continue;
    lines.push({rate_id:rate.id,position_code:position,template:rate.position_code,label:rate.label,kind:rate.kind,quantity,unit:rate.unit,price,amount:moneyRound(quantity*price)});
  }
  const sum=kind=>moneyRound(lines.filter(l=>l.kind===kind).reduce((s,l)=>s+l.amount,0));
  return {lines,gross:moneyRound(lines.reduce((s,l)=>s+l.amount,0)),review,base:sum('base'),kmRate:lines.find(l=>l.kind==='km')?.price||0,waiting:sum('waiting'),surcharge:sum('surcharge')};
}

export function invoiceTariffItems(lines, ownShare, trip, invoiceId) {
  const units=tariffUnits;
  const context=[trip.service_date,trip.from_address+' → '+trip.to_address].join(' · ');
  const items=lines.map((line,index)=>({invoice_id:invoiceId,trip_id:trip.id,description:`Pos. ${line.position_code} · ${line.label} · ${context}`,quantity:line.quantity,unit:units[line.unit]||line.unit,unit_gross:line.price,vat_rate:0,net_total:line.amount,vat_total:0,gross_total:line.amount,sort_order:index,item_kind:'charge'}));
  if(ownShare>0)items.push({invoice_id:invoiceId,trip_id:trip.id,description:'Abzug Eigenanteil des Versicherten',quantity:1,unit:'Abzug',unit_gross:-ownShare,vat_rate:0,net_total:-ownShare,vat_total:0,gross_total:-ownShare,sort_order:items.length,item_kind:'own_share_deduction'});
  return items;
}

export function tariffFingerprint(lines) {
  return JSON.stringify((lines||[]).map(l=>[l.rate_id,l.position_code,l.template,l.label,l.kind,l.quantity,l.unit,l.price,l.amount]));
}
