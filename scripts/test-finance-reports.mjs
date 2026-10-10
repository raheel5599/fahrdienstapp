import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4179','--strictPort'],{env:{...process.env,VITE_BACKEND_MODE:'local'},stdio:'pipe'}),origin='http://127.0.0.1:4179';
try{
 for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 await mkdir('test-results',{recursive:true});
 for(const [name,engine] of Object.entries(process.env.UI_WEBKIT==='1'?{chromium,webkit}:{chromium})){
  const browser=await engine.launch();
  try{for(const [size,width,height] of [['mobile',390,844],['small-mobile',320,568],['ipad-portrait',768,1024],['ipad-landscape',1024,768],['desktop',1440,900]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
   await page.goto(origin+'/tests/ui/fixture.html?screen=financereports');
   await page.getByRole('heading',{name:'Rechnungen & Kostenträger',exact:true}).waitFor();
   await page.getByLabel('Rechnungsmonat',{exact:true}).fill('2026-09');
   await page.getByText('100,00 €',{exact:true}).first().waitFor();await page.getByText('56,50 €',{exact:true}).first().waitFor();
   await page.getByLabel('Rechnungsart',{exact:true}).selectOption('own_share');await page.getByRole('heading',{name:'RE-REPORT-2 · Testpatient',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'RE-REPORT-1 · Testkrankenkasse',exact:true}).count(),0);
   await page.getByLabel('Rechnungsart',{exact:true}).selectOption('');await page.getByLabel('Kostenträger im Bericht',{exact:true}).selectOption('insurer:report-insurer');await page.getByRole('heading',{name:'RE-REPORT-1 · Testkrankenkasse',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'RE-REPORT-2 · Testpatient',exact:true}).count(),0);
   await page.getByLabel('Rechnungsmonat',{exact:true}).fill('2026-10');await page.getByText('Keine Rechnungsbelege für diese Auswahl.',{exact:true}).waitFor();await page.getByText('50,00 €',{exact:true}).waitFor();
   await page.getByLabel('Kostenträger im Bericht',{exact:true}).selectOption('');await page.getByLabel('Rechnungsmonat',{exact:true}).fill('2026-09');await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-report-refreshed'),'yes');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: overflow`);assert.deepEqual(errors,[]);
   await page.screenshot({path:`test-results/${name}-${size}-finance-report.png`,fullPage:true});
   await page.goto(origin+'/tests/ui/fixture.html?screen=accounting');await page.getByLabel('Zahlungsmonat',{exact:true}).fill('2026-09');await page.getByText('80,00 €',{exact:true}).waitFor();
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'CSV herunterladen',exact:true}).click();const csv=await download;assert.equal(csv.suggestedFilename(),'Zahlungsuebersicht-2026-09.csv');
   await page.getByRole('button',{name:'Ausgabe erfassen',exact:true}).click();await page.getByRole('button',{name:'Ausgabe speichern',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-accounting-requests'),null);
   await page.getByLabel('Ausgabenbetrag €',{exact:true}).fill('12,50');await page.getByLabel('Zahlungsempfänger',{exact:true}).fill('Testwerkstatt');await page.getByLabel('Tatsächliches Zahlungsdatum',{exact:true}).fill('2026-09-20');await page.getByLabel('Beleg- / Zahlungsreferenz',{exact:true}).fill('USEREXP-1');await page.getByLabel('Beschreibung der Zahlung',{exact:true}).fill('Werkstatt bezahlt');await page.getByRole('dialog').getByRole('checkbox').check();await page.evaluate(()=>window.accountingFail=true);await page.getByRole('button',{name:'Ausgabe speichern',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();await page.getByRole('button',{name:'Ausgabe speichern',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText('67,50 €',{exact:true}).waitFor();const ids=JSON.parse(await page.locator('body').getAttribute('data-accounting-requests'));assert.equal(ids[0],ids[1]);
   await page.locator('.batch-card').filter({hasText:'USEREXP-1'}).getByRole('button',{name:'Fehlerhafte Erfassung aufheben',exact:true}).click();await page.getByRole('button',{name:'Korrektur speichern',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-accounting-cancelled'),null);await page.getByLabel('Korrekturgrund',{exact:true}).fill('Doppelt eingetragen');await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('button',{name:'Korrektur speichern',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByText('80,00 €',{exact:true}).waitFor();
   for(const ref of ['RE-LEGACY-1','ST-TEST-1']){await page.locator('.batch-card').filter({hasText:ref}).getByRole('button',{name:'Zahlungsdatum ergänzen',exact:true}).click();await page.getByLabel('Tatsächliches Zahlungsdatum',{exact:true}).fill('2026-09-15');await page.getByLabel('Beleg- / Zahlungsreferenz',{exact:true}).fill('DATE-'+ref);await page.getByLabel('Beschreibung der Zahlung',{exact:true}).fill('Banknachweis geprüft');await page.getByRole('dialog').getByRole('checkbox').check();await page.getByRole('button',{name:'Zahlungsdatum speichern',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})}
   await page.getByText('120,00 €',{exact:true}).waitFor();await page.getByLabel('Zahlungsart filtern',{exact:true}).selectOption('cash');await page.getByText('10,00 €',{exact:true}).first().waitFor();await page.getByLabel('Zahlungsart filtern',{exact:true}).selectOption('');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);await page.screenshot({path:`test-results/${name}-${size}-accounting.png`,fullPage:true});await page.close();console.log(`PASS ${name} ${size}: invoice reports and accounting: totals, filters, expenses, retry, corrections, actual dates, CSV, no overflow`);
  }}finally{await browser.close()}
 }
}finally{server.kill('SIGTERM')}
