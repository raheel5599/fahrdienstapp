export const profileFields=['company_name','owner_name','street','postal_code','city','country','phone','email','website','ik_number','tax_number','vat_id','bank_name','iban','bic','payment_note','tax_note'];
export function normalizeProfile(input={}){
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
export async function loadIssuerSnapshot(db,unitId){
 const {data,error}=await db.from('billing_profiles').select('*').eq('business_unit_id',unitId).maybeSingle();
 if(error)throw new Error('Unternehmensdaten konnten nicht geladen werden.');
 if(!data?.company_name||!data.street||!data.postal_code||!data.city)throw new Error('Bitte zuerst Firmenname und vollständige Anschrift unter Einstellungen speichern.');
 return normalizeProfile(data);
}
