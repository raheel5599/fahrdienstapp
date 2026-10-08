export function correctionReason(value){const reason=String(value||'').trim();if(reason.length<3||reason.length>1000)throw new Error('Bitte einen Grund mit 3 bis 1000 Zeichen angeben.');return reason;}
export function correctionItems(input){
 if(!Array.isArray(input)||!input.length||input.length>100)throw new Error('1 bis 100 Rechnungspositionen erforderlich.');
 return input.map(row=>{const description=String(row.description||'').trim(),quantity=Number(row.quantity),price=Number(row.unitGross),vatRate=Number(row.vatRate??0);if(row.unitGross==null||String(row.unitGross).trim()===''||!description||description.length>180||!Number.isFinite(quantity)||quantity<=0||quantity>1000000||!Number.isFinite(price)||price<0||price>10000000||![0,7,19].includes(vatRate))throw new Error('Bezeichnung, Menge, Preis oder Steuersatz einer Position ist ungültig.');return {description,quantity,unitGross:Math.round((price+Number.EPSILON)*100)/100,vatRate,unit:String(row.unit||'Fahrt').slice(0,30)};});
}
export function correctionHeader(input,original,issuer){
 const date=String(input.serviceDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('Gültiges Leistungsdatum erforderlich.');
 const due=String(input.dueDate||'');if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due))throw new Error('Fälligkeitsdatum prüfen.');
 const header={serviceDate:date,dueDate:due,issuerSnapshot:issuer};
 for(const [key,source,max] of [['payerName','payer_name',180],['payerAddress','payer_address',300],['customerName','customer_name',180],['customerAddress','customer_address',300],['notes','notes',1000]]){const text=String(input[key]??original[source]??'').trim();if(text.length>max)throw new Error('Rechnungsangabe zu lang.');header[key]=text;}
 if(!header.payerName)throw new Error('Rechnungsempfänger fehlt.');return header;
}
