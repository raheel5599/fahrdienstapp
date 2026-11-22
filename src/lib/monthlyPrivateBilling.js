import {isTaxiTrip} from '../../supabase/functions/_shared/rideCategories.js';

export function isMonthlyPrivate(billing,customer){
  return billing.payer_type==='private'&&(billing.private_billing_cycle??customer?.private_billing_cycle)==='monthly';
}

export function monthlyPrivateGroups(data,customer,month){
  if(!customer)return [];
  const trips=new Map(data.trips.map(trip=>[trip.id,trip]));
  const groups=new Map();
  for(const billing of data.cases){
    if(billing.customer_id!==customer.id||billing.invoice_id||billing.receipt_id||!isMonthlyPrivate(billing,customer))continue;
    const trip=trips.get(billing.trip_id);
    if(trip?.status!=='abgeschlossen'||trip.service_date?.slice(0,7)!==month)continue;
    const kind=isTaxiTrip(trip.trip_type)?'taxi':'medical';
    const original=billing.last_cancelled_invoice_id??null;
    const key=kind+':'+(original??'');
    if(!groups.has(key))groups.set(key,{key,kind,original,rows:[]});
    groups.get(key).rows.push({billing,trip});
  }
  return [...groups.values()].map(group=>{
    group.rows.sort((a,b)=>a.trip.service_date.localeCompare(b.trip.service_date)||a.trip.id.localeCompare(b.trip.id));
    return {
      ...group,
      ready:group.rows.every(({billing})=>billing.billing_status==='ready'&&Number(billing.private_amount)>0),
      cents:group.rows.reduce((sum,{billing})=>sum+Math.round(Number(billing.private_amount||0)*100),0)
    };
  });
}
