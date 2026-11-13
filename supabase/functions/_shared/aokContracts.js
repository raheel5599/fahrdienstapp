// Transcribed from the user's AOK Hessen contracts, version 24.11.2025,
// effective 01.01.2026, Wetteraukreis. No patient data or contract scans stored here.
export const AOK_TREATMENTS={
 '01':'Krankenhausbehandlung, voll-/teilstationär','02':'Krankenhausbehandlung, vor-/nachstationär','03':'Verlegung',
 '05':'Ambulante Behandlung im Krankenhaus','10':'Ambulante Operation / Vor- und Nachbehandlung',
 '20':'Ambulante Behandlung','30':'Chemo- oder Strahlentherapie','52':'Dialyse',
};
const make=(code,label,kind,price,extra={})=>({id:`aok-${code}-${extra.transport_type||'single'}`,position_code:code,label,kind,unit:kind==='km'?'km':'ride',price,
 vehicle_class:'taxi',journey_kind:'all',area:'all',valid_from:'2026-01-01',valid_until:null,active:true,
 ...(code.endsWith('XX')?{allowed_treatment_codes:Object.keys(AOK_TREATMENTS)}:{}),...extra});
const wheel=(...args)=>({...make(...args),vehicle_class:'all'});
const sharedNote='Sammeltransport: Aufteilung und tatsächliche Personenzahl vor automatischer Abrechnung klären.';
const shared={automatic:false,calculation_note:sharedNote,transport_type:'shared'};
const agreement={automatic:false,calculation_note:'Nur mit dokumentiertem, genehmigtem Vereinbarungspreis; gesonderte Prüfung erforderlich.'};
export const AOK_CONTRACT_PRESETS=[
 {id:'aok-hessen-sitzend-2026',name:'AOK Hessen · Sitzend · Taxi · Wetteraukreis 2026',actk:'4606280',serviceType:'standard',source:'AOK sitzend, Version 24.11.2025, Anlagen 5 und 6',
 notes:'Vertrag für sitzende Taxifahrten im Wetteraukreis. Preise brutto. Kurzstrecke bis einschließlich 5 Besetzt-km ohne Einsatzpauschale. Taxameter im Pflichtfahrgebiet: Betrag als Menge, Einzelpreis 1 EUR. Genehmigte Vereinbarungspreise und Sammeltransporte benötigen gesonderte Prüfung.',
 lines:[
 make('511200','Einsatzpauschale Einpersonentransport','base',2.40,{area:'outside',min_km:5.01}),
 make('5116XX','Kurzstreckenpauschale bis 5 Besetzt-km','flat',12.90,{area:'outside',max_km:5}),
 make('5130XX','Besetztkilometer Einpersonentransport','km',2.10,{area:'outside',min_km:5.01}),
 make('5148XX','Taxameter im Pflichtfahrgebiet','meter',1,{area:'inside',meter_quantity:true}),
 make('512900','Genehmigter Vereinbarungspreis Einpersonentransport','flat',0,agreement),
 make('521200','Einsatzpauschale Mehrpersonentransport','base',2.40,shared),
 make('5231XX','Besetztkilometer Mehrpersonentransport','km',1.73,shared),
 make('522900','Genehmigter Vereinbarungspreis Mehrpersonentransport','flat',0,{...shared,...agreement}),
 ]},
 {id:'aok-hessen-rollstuhl-2026',name:'AOK Hessen · Rollstuhl · Wetteraukreis 2026',actk:'4606460',serviceType:'wheelchair',source:'AOK Rollstuhl, Version 24.11.2025, Anlagen 5 und 6',
 notes:'Nicht umsetzbarer Rollstuhltransport im behindertengerechten Fahrzeug. Preise brutto. Grundpauschale umfasst die ersten 10 Besetzt-km; Kilometerpreis erst ab dem 11. Besetzt-km. Sammeltransporte und genehmigte Vereinbarungspreise benötigen gesonderte Prüfung.',
 lines:[
 wheel('7501XX','Grundpauschale Rollstuhl Einpersonentransport, inkl. 10 km','base',27.48),
 wheel('753000','Besetztkilometer Rollstuhl Einpersonentransport ab km 11','km',2.10,{included_km:10}),
 wheel('7502XX','Grundpauschale Rollstuhl Mehrpersonentransport','base',18.78,shared),
 wheel('753100','Besetztkilometer Rollstuhl Mehrpersonentransport ab km 11','km',1.73,{...shared,included_km:10}),
 wheel('752900','Genehmigter Vereinbarungspreis Rollstuhl','flat',0,agreement),
 ]},
];
export function aokPresetFor(contract){
 const number=String(contract?.contract_number||'').replace(/\s/g,'');
 return AOK_CONTRACT_PRESETS.find(p=>p.actk===number&&(contract.service_type||'standard')===p.serviceType)||null;
}
export function aokPresetDraft(id,existing={}){
 const p=AOK_CONTRACT_PRESETS.find(p=>p.id===id);if(!p)throw Error('AOK-Vertragsvorlage fehlt.');
 return {...existing,contract_name:p.name,contract_number:p.actk,contract_scope:'individual',contract_group:null,service_type:p.serviceType,
  valid_from:'2026-01-01',valid_until:null,active:true,billing_method:'mixed',notes:p.notes,tariff_lines:structuredClone(p.lines)};
}
export function contractPositionChoices(contract,date){
 return (contract?.tariff_lines||[]).filter(l=>l.active!==false&&(!date||(!l.valid_from||l.valid_from<=date)&&(!l.valid_until||l.valid_until>=date)))
  .filter((l,n,list)=>list.findIndex(x=>x.position_code===l.position_code)===n);
}
export function expandContractPositions(line){
 if(!line.position_code.endsWith('XX'))return [{code:line.position_code,label:line.label}];
 const codes=line.allowed_treatment_codes||Object.keys(AOK_TREATMENTS);
 return codes.map(code=>({code:line.position_code.slice(0,-2)+code,label:`${line.label} · ${AOK_TREATMENTS[code]||code}`}));
}
