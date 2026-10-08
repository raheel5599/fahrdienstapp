export const COPAY_RULE_VERSION=1;
const money=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export function insuranceValidOn(insurance,date){return Boolean(insurance)&&(!insurance.valid_from||insurance.valid_from<=date)&&(!insurance.valid_until||insurance.valid_until>=date);}
export function calculateOwnShare({gross,insurance,date,positionCode,lines=[]}){
 const total=Number(gross);if(!Number.isFinite(total)||total<0)throw new Error('Fahrtbetrag ist ungültig.');
 if(!insuranceValidOn(insurance,date))return {amount:0,note:'Krankenversicherung am Fahrtag prüfen.',exempt:false};
 const exempt=Boolean(insurance.exempt)&&(!insurance.exempt_until||insurance.exempt_until>=date);
 if(exempt)return {amount:0,note:'Am Fahrtag von der Zuzahlung befreit.',exempt:true};
 const meter=[positionCode,...lines.flatMap(l=>[l.position_code,l.template])].some(code=>/^5148/.test(String(code||'').replace(/\s/g,'')));
 const amount=money(Math.min(total,meter?5:Math.max(5,Math.min(10,Math.round(Math.round(total*100)/10)/100))));
 return {amount,note:meter?'5148: 5 € Eigenanteil für diese Fahrtrichtung.':'10 % dieser Fahrtrichtung, mindestens 5 €, höchstens 10 €; maximal der Fahrtbetrag.',exempt:false};
}
export function privateFare(input){const amount=Number(input.amount),vatRate=Number(input.vatRate??0);if(input.amount==null||String(input.amount).trim()===''||!Number.isFinite(amount)||amount<=0||amount>10000000||![0,7,19].includes(vatRate))throw new Error('Positiven Privatpreis und gültigen Steuersatz angeben.');const gross=money(amount);if(gross<=0)throw new Error('Privatpreis muss mindestens 0,01 € sein.');const net=money(gross/(1+vatRate/100));return {gross,net,vat:money(gross-net),vatRate};}
export function tripDirectionLabel(trip){return trip.direction==='return'?'Rückfahrt':'Hinfahrt';}
