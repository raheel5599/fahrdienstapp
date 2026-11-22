import {taxiBrand} from './rideCategories.js';

export const profileFields=['company_name','owner_name','street','postal_code','city','country','phone','email','website','ik_number','tax_number','vat_id','bank_name','iban','bic','payment_note','tax_note'];
export function normalizeProfile(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Unternehmensdaten fehlen.');
 const result={};
 for(const field of profileFields){const value=String(input[field]??'').trim();if(value.length> (field.endsWith('_note')?1000:180))throw new Error('Unternehmensangabe zu lang: '+field);result[field]=value||null;}
 result.country=result.country||'Deutschland';
 for(const key of ['iban','bic'])if(result[key])result[key]=result[key].replace(/\s/g,'').toUpperCase();
 if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new Error('E-Mail-Adresse prüfen.');
 if(result.ik_number&&!/^\d{9}$/.test(result.ik_number))throw new Error('IK muss neun Ziffern enthalten.');
 if(result.bic&&!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(result.bic))throw new Error('BIC prüfen.');
 if(result.iban){if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(result.iban))throw new Error('IBAN prüfen.');const digits=(result.iban.slice(4)+result.iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));let mod=0;for(const d of digits)mod=(mod*10+Number(d))%97;if(mod!==1)throw new Error('IBAN-Prüfsumme ungültig.');}
 return result;
}
export async function loadIssuerSnapshot(db,unitId,{kind='medical',unitCode='fahrdienst'}={}){
 const {data,error}=await db.from('billing_profiles').select('*').eq('business_unit_id',unitId).maybeSingle();
 if(error)throw new Error('Unternehmensdaten konnten nicht geladen werden.');
 const isTaxi=kind==='taxi'||unitCode==='taxi';
 const selected=isTaxi&&unitCode==='fahrdienst'?(data?.taxi_profile??data):data;
 if(!selected?.company_name||!selected.street||!selected.postal_code||!selected.city){
  throw new Error(isTaxi
   ?'Bitte zuerst Firmenname und vollständige Anschrift im Taxi-Profil unter Einstellungen speichern.'
   :'Bitte zuerst Firmenname und vollständige Anschrift unter Einstellungen speichern.');
 }
 const snapshot=normalizeProfile(selected);
 return isTaxi?{...snapshot,trade_name:taxiBrand}:snapshot;
}
