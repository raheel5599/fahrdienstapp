export function paymentCents(value){
 const text=String(value??'').trim().replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw Error('Betrag mit höchstens zwei Nachkommastellen eingeben.');
 const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents>1000000000)throw Error('Betrag ist zu groß.');return cents;
}
export function insurerPaymentInput(form,rows,requestId){
 const amount=paymentCents(form.amount);if(amount<=0)throw Error('Tatsächlich eingegangenen Betrag eingeben.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date||''))throw Error('Tatsächliches Zahlungsdatum eingeben.');
 const reference=String(form.reference||'').trim(),note=String(form.note||'').trim();if(reference.length<3||reference.length>180)throw Error('Eindeutige Bank-/Abrechnungsreferenz mit 3 bis 180 Zeichen eingeben.');if(note.length>1000)throw Error('Vermerk ist zu lang.');
 const entries=[];let allocated=0;
 for(const row of rows){const value=form.allocations?.[row.invoiceId];if(value==null||String(value).trim()==='')continue;const cents=paymentCents(value);if(!cents)continue;if(row.status!=='open'||cents>row.openCents)throw Error(`Zuordnung zu ${row.invoiceNumber} übersteigt den offenen Betrag.`);allocated+=cents;entries.push({invoiceId:row.invoiceId,amount:cents/100,version:row.version})}
 if(allocated>amount)throw Error('Zuordnungen übersteigen den tatsächlichen Zahlungseingang.');
 return {requestId,date:form.date,amount:amount/100,reference,note,entries};
}
