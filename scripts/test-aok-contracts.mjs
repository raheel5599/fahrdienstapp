import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4187';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4187','--strictPort'],{env:{...process.env,VITE_BACKEND_MODE:'local'},stdio:'pipe'});
let browser;
try{
 for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 await mkdir('test-results',{recursive:true});browser=await chromium.launch();
 for(const [name,width,height] of [['small-mobile',320,568],['mobile',390,844],['ipad',768,1024],['desktop',1440,900]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/tests/ui/fixture.html?screen=aokcontracts');
  await page.getByRole('button',{name:'AOK Rollstuhl vorbereiten',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Vertrag bearbeiten'});
  assert.equal(await dialog.getByLabel('Vertragsnummer / Tarifkennzeichen',{exact:true}).inputValue(),'4606460');
  await dialog.getByText('Die ersten 10 Besetzt-km sind enthalten; nur zusätzliche Kilometer berechnen.',{exact:true}).first().waitFor();
  await dialog.getByRole('button',{name:'Vertrag speichern',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: contract dialog overflow`);
  await page.screenshot({path:`test-results/aok-${name}-contract-dialog.png`});await dialog.getByRole('button',{name:'Vertrag speichern',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.aokSaved==='yes');
  const saved=await page.evaluate(()=>window.savedAokContract);assert.equal(saved.contractNumber,'4606460');assert.equal(saved.serviceType,'wheelchair');assert.equal(saved.tariffLines.find(l=>l.position_code==='753000').included_km,10);
  const card=page.locator('.contract-card').filter({has:page.getByRole('heading',{name:'AOK Hessen · Rollstuhl · Wetteraukreis 2026',exact:true})});
  await card.getByText('Positionsnummern dieses Vertrags anzeigen',{exact:true}).click();await card.getByLabel('Behandlung für Positionsnummern').selectOption('20');await card.getByText('750120',{exact:true}).waitFor();assert.equal(await card.getByText('513020',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: catalogue overflow`);await page.screenshot({path:`test-results/aok-${name}-catalogue.png`,fullPage:true});
  await page.goto(origin+'/tests/ui/fixture.html?screen=aokbilling');await page.getByRole('button',{name:'Prüfen',exact:true}).click();
  const billing=page.getByRole('dialog',{name:'Abrechnung prüfen'});await billing.getByLabel('Behandlung gemäß Verordnung').selectOption('20');
  const options=await billing.getByLabel('Position aus dem gewählten Vertrag').locator('option').allTextContents();assert(options.some(s=>s.includes('513020')));assert(!options.some(s=>s.includes('7501')));
  await billing.getByLabel('Position aus dem gewählten Vertrag').selectOption('5130XX');await billing.getByRole('button',{name:'Neu berechnen & speichern',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: billing overflow`);
  await page.screenshot({path:`test-results/aok-${name}-billing.png`});await billing.getByRole('button',{name:'Neu berechnen & speichern',exact:true}).click();await page.waitForFunction(()=>document.body.dataset.aokBillingSaved==='yes');
  const input=await page.evaluate(()=>window.aokBillingInput);assert.equal(input.contractId,'aok-sitzend');assert.equal(input.positionCode,'5130XX');assert.equal(input.treatmentCode,'20');assert.deepEqual(errors,[]);await page.close();console.log(`${name}: AOK presets, catalogue and billing selection passed`);
 }
}finally{await browser?.close();server.kill('SIGTERM');}
