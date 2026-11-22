import PDFDocument from 'npm:pdfkit@0.17.2';
import {create as openFont} from 'npm:fontkit@2.0.4';
import {Buffer} from 'node:buffer';
import {gunzipSync} from 'node:zlib';
import {fontGzip,medicalLogo,taxiLogo} from './assets.js';

const font=gunzipSync(Buffer.from(fontGzip,'base64'));
const glyphs=openFont(font);
const gold='#a97412';
const euros=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
const quantity=new Intl.NumberFormat('de-DE',{maximumFractionDigits:4});
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')?value.split('-').reverse().join('.'):'';
function clean(value){
 const text=String(value??'').replaceAll('→','–').replace(/\s+/gu,' ').trim();
 if(text.includes('[[')||Array.from(text).some(character=>!glyphs.hasGlyphForCodePoint(character.codePointAt(0)))){
   throw Error('Der Beleg enthält Zeichen, die im Post-PDF nicht sicher dargestellt werden können.');
 }
 return text;
}
function multiline(value){
 return String(value??'').split(/\r?\n/).map(clean).filter(Boolean).join('\n');
}

export function recipientLines(invoice){
 const name=String(invoice.payer_name??'').trim();
 const address=String(invoice.payer_address??'').trim();
 const match=address.match(/^([\s\S]+?)[,\n]\s*(\d{5} [^,\r\n]+)(?:[,\n]\s*(?:Deutschland|Germany))?$/i);
 if(!name||/[\r\n]/.test(name)||!match)throw Error('Für E-POST braucht die Rechnung eine deutsche Empfängeranschrift mit Straße, PLZ und Ort.');
 const addressLines=match[1].split(/\r?\n|,/).map(clean).filter(Boolean);
 const lines=[clean(name),...addressLines,clean(match[2])];
 if(lines.length<3||lines.length>5)throw Error('Die Empfängeranschrift passt nicht ins Brieffenster.');
 return lines;
}

export async function invoicePdf(invoice,items){
 const address=recipientLines(invoice);
 const issuer=invoice.issuer_snapshot;
 if(!issuer?.company_name||!issuer.street||!issuer.postal_code||!issuer.city||!items.length||
    !date(invoice.issue_date))throw Error('Firmenanschrift, Rechnungsdatum oder Rechnungspositionen fehlen.');
 const ownShare=Boolean(invoice.own_share_month||invoice.own_share_case_id);
 const month=invoice.private_billing_month||invoice.own_share_month;
 const title=ownShare?'Eigenanteilsrechnung':month?'Monatsrechnung':'Rechnung';
 const reference=clean(invoice.invoice_number);
 const company=[issuer.company_name,issuer.trade_name!==issuer.company_name?issuer.trade_name:'',issuer.owner_name,issuer.street,
   [issuer.postal_code,issuer.city].filter(Boolean).join(' '),issuer.country,issuer.phone?('Tel. '+issuer.phone):''
 ].map(clean).filter(Boolean).join('\n');
 const foot=[['IK',issuer.ik_number],['Steuernummer',issuer.tax_number],['USt-ID',issuer.vat_id],['Bank',issuer.bank_name],
   ['IBAN',issuer.iban],['BIC',issuer.bic],['E-Mail',issuer.email],['Web',issuer.website]
 ].filter(([,value])=>value).map(([label,value])=>label+': '+clean(value)).join('\n');
 const notes=[invoice.notes,issuer.payment_note,issuer.tax_note].map(multiline).filter(Boolean);
 const isTaxi=issuer.trade_name==='TARIQ Taxi-Zentrale';
 const logo=Buffer.from(isTaxi?taxiLogo:medicalLogo,'base64');
 const doc=new PDFDocument({
   size:'A4',margin:42,autoFirstPage:false,font,subset:'PDF/A-1b',pdfVersion:'1.4',
   info:{Title:title+' '+reference,Author:clean(issuer.company_name),CreationDate:new Date(invoice.issue_date+'T12:00:00Z')}
 });
 const chunks=[];
 const done=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);
 });
 let pages=0;
 const addPage=()=>{
   if(++pages>94)throw Error('Die Rechnung überschreitet die erlaubte Seitenzahl für E-POST.');
   doc.addPage();
 };
 const x=71,right=548,bottom=778;
 const line=y=>doc.moveTo(x,y).lineTo(right,y).strokeColor(gold).lineWidth(0.8).stroke();
 const text=(value,left,y,width,options={})=>doc.text(value,left,y,{width,...options});
 const tableHead=y=>{
  doc.rect(x,y,right-x,19).fill('#262626');
  doc.fillColor('white').fontSize(8);
  for(const [heading,left,width] of [['Leistung',x+5,257],['Menge',337,44],['Einzelpreis',382,63],['MwSt.',446,34],['Gesamt',481,62]]){
   text(heading,left,y+4,width,{lineBreak:false,align:left===x+5?'left':'right'});
  }
  doc.fillColor('#151515');
  return y+22;
 };
 try{
  addPage();
  doc.image(logo,x,43,{fit:[195,62]});
  doc.fillColor('#151515').fontSize(9);
  if(doc.heightOfString(company,{width:205})>110)throw Error('Die Firmenanschrift ist für das Brieflayout zu lang.');
  text(company,343,43,205,{align:'right'});

  // Use the position and line spacing verified by the successful E-POST test.
  doc.fontSize(10);
  for(const [index,part] of address.entries()){
   if(doc.widthOfString(part)>210)throw Error('Die Empfängeranschrift passt nicht ins Brieffenster.');
   text(part,x,197+11.34*index,210,{lineBreak:false});
  }

  line(308);
  doc.fontSize(21);text(title,x,322,275);
  doc.fontSize(10);
  const monthReference=month?new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'T12:00:00Z')):'';
  const details=[
   'Rechnungsnummer: '+reference,'Rechnungsdatum: '+date(invoice.issue_date),
   monthReference?'Leistungsmonat: '+monthReference:date(invoice.service_date)?'Leistungsdatum: '+date(invoice.service_date):'',
   date(invoice.due_date)?'Fällig am: '+date(invoice.due_date):'',
   invoice.reference_invoice_number?'Ersatz für Rechnung '+clean(invoice.reference_invoice_number):'',
   invoice.customer_name&&invoice.customer_name!==invoice.payer_name?'Kunde / Patient: '+clean(invoice.customer_name):'',
   invoice.customer_address&&invoice.customer_address!==invoice.payer_address?'Kundenanschrift: '+clean(invoice.customer_address):''
  ].filter(Boolean).join('\n');
  text(details,x,356,right-x);
  let y=tableHead(doc.y+16);
  const next=(withHead=false)=>{
   addPage();doc.fontSize(12).fillColor('#151515');
   text(title+' '+reference,x,43,right-x);
   line(66);
   return withHead?tableHead(78):82;
  };
  for(const item of items){
   const label=clean(item.description);
   const units=quantity.format(Number(item.quantity))+' '+clean(item.unit);
   const values=[units,euros.format(Number(item.unit_gross)),quantity.format(Number(item.vat_rate))+' %',euros.format(Number(item.gross_total))];
   doc.fontSize(8.5);
   const widths=[44,63,34,62];
   const xValues=[337,382,446,481];
   const height=Math.max(18,doc.heightOfString(label,{width:254})+8,...values.map((value,i)=>doc.heightOfString(value,{width:widths[i]})+8));
   if(height>bottom-100)throw Error('Eine Rechnungsposition ist für das Brieflayout zu lang.');
   if(y+height>bottom){y=next(true);doc.fontSize(8.5);}
   text(label,x+5,y+3,254);
   values.forEach((value,i)=>text(value,xValues[i],y+3,widths[i],{align:'right'}));
   y+=height;
   doc.moveTo(x,y).lineTo(right,y).strokeColor('#d7d7d7').lineWidth(0.4).stroke();
  }
  if(y+75>bottom)y=next();
  y+=13;
  for(const [label,value] of [['Netto',invoice.net_total],['MwSt.',invoice.vat_total],['Gesamtbetrag',invoice.gross_total]]){
   doc.fontSize(label==='Gesamtbetrag'?12:10);
   text(label,335,y,115);
   text(euros.format(Number(value)),450,y,98,{align:'right'});
   y+=17;
  }
  for(const paragraph of [...notes,foot].filter(Boolean)){
   doc.fontSize(9);
   const height=doc.heightOfString(paragraph,{width:right-x});
   if(height>bottom-100)throw Error('Ein Hinweis auf der Rechnung ist für das Brieflayout zu lang.');
   y+=10;
   if(y+height>bottom){y=next();doc.fontSize(9);}
   text(paragraph,x,y,right-x);
   y=doc.y+3;
  }
  doc.end();
  return await done;
 }catch(error){
  doc.destroy();
  throw error;
 }
}
