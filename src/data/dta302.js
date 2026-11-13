import {supabase} from '../lib/supabase.js';
import {APP_CONFIG} from '../config/app.js';
import {zipSync,strToU8} from 'fflate';
import {latin1} from '../../supabase/functions/_shared/dta302.js';
async function invoke(body){
 const {data,error}=await supabase.functions.invoke('manage-dta302',{body:{businessUnitCode:APP_CONFIG.businessUnitCode,...body}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message||'Kassenabrechnung nicht erreichbar. Backend-Funktion und Datenbankmigration prüfen.');}
 if(data?.error)throw Error(data.error);
 return data;
}
export const dta302Api={
 inspect:insurerId=>invoke({action:'inspect',insurerId}),
 saveRoute:(insurerId,route)=>invoke({action:'save_route',insurerId,route}),
 saveMetadata:(insurerId,caseId,metadata)=>invoke({action:'save_metadata',insurerId,caseId,metadata}),
 export:(insurerId,entries,requestId)=>invoke({action:'export',mode:'test',insurerId,entries,requestId}),
 download:id=>invoke({action:'download',id}),
};
export function dta302Archive(result){
 const entries={};
 for(const file of result.files){
  if(!/^TSOL0\d{3}$/.test(file.physicalName)||entries[file.physicalName])throw Error('Ungültiger oder doppelter Dateiname.');
  entries[file.physicalName]=latin1(file.text);
 }
 entries['Exportprotokoll.json']=strToU8(JSON.stringify({id:result.id,createdAt:result.createdAt,mode:'test',files:result.files.map(({text,...metadata})=>metadata)},null,2));
 entries['Hinweise.txt']=strToU8('§302-Kassenabrechnung – TESTEXPORT\n\nUnverschlüsselte Nutzdaten mit Testindikator 0; keine Zahlung und keine tatsächliche Übermittlung.\nJe vorhandener Rechnung eine eigene Datei. Rechnungsnummern und Beträge bleiben erhalten.\nVor Weitergabe: Test mit der Datenannahmestelle abstimmen, Verschlüsselung/Signatur und Auftragsdatei über einen geeigneten Übermittlungsdienst erstellen.\nOriginalbelege separat nach Vorgaben der Annahmestelle einreichen.\nDieses ZIP ist kein versandfertiges KKS-Dateipaar. Es enthält personenbezogene Abrechnungsdaten.\n');
 return zipSync(entries);
}
export function downloadDta302(result){
 const url=URL.createObjectURL(new Blob([dta302Archive(result)],{type:'application/zip'}));
 const link=document.createElement('a');link.href=url;link.download=`Kassenabrechnung_TEST_${result.id}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
