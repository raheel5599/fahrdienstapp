import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4186';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4186','--strictPort'],{env:{...process.env,VITE_BACKEND_MODE:'local'},stdio:'pipe'});
let browser;
try{
 for(let n=0;n<50;n++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 await mkdir('test-results',{recursive:true});browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 for(const [name,width,height] of [['small-mobile',320,568],['mobile',390,844],['ipad-portrait',768,1024],['ipad-landscape',1024,768],['desktop',1440,900]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/tests/ui/fixture.html?screen=dta302');
  await page.getByLabel('Krankenkasse für Datenaustausch').selectOption('dta-insurer');
  await page.getByText('1 für Testexport bereit',{exact:true}).waitFor();
  const exportButton=page.getByRole('button',{name:'§302-Testexport erstellen',exact:true});assert(await exportButton.isDisabled());
  await page.getByRole('button',{name:'Angaben prüfen',exact:true}).nth(1).click();
  const dialog=page.getByRole('dialog',{name:'Zusatzangaben für Kassenabrechnung'});
  await dialog.getByRole('group',{name:'Zielort',exact:true}).getByLabel('Postleitzahl').fill('61231');
  await dialog.getByRole('button',{name:'Zusatzangaben speichern',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: dialog overflow`);
  await page.screenshot({path:`test-results/dta302-${name}-dialog.png`});
  await dialog.getByRole('button',{name:'Zusatzangaben speichern',exact:true}).click();
  await page.getByText('2 für Testexport bereit',{exact:true}).waitFor();
  await page.getByLabel('Alle bereiten Rechnungen auswählen').check();assert(await exportButton.isDisabled());
  await page.getByLabel('Ich habe die Auswahl geprüft',{exact:false}).check();assert(!(await exportButton.isDisabled()));
  await exportButton.click();await page.getByText('2 Testdatei(en) erstellt und im Exportverlauf gespeichert. Noch nicht versandt.',{exact:true}).waitFor();
  const zip=unzipSync(new Uint8Array(await page.evaluate(()=>window.dtaArchive)));
  assert(zip.TSOL0001&&zip.TSOL0002);const text=new TextDecoder('iso-8859-1').decode(zip.TSOL0001);assert.match(text,/SLLA:21:0:0/);assert.match(text,/BES\+52,09\+5,00/);assert.match(strFromU8(zip['Hinweise.txt']),/kein versandfertiges KKS-Dateipaar/);
  const manifest=JSON.parse(strFromU8(zip['Exportprotokoll.json']));assert(!('text' in manifest.files[0]));
  await page.getByRole('button',{name:'Erneut herunterladen',exact:true}).click();assert.equal(await page.locator('body').getAttribute('data-dta-downloaded'),'2');
  await page.getByRole('heading',{name:'Kassenabrechnung',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: page overflow`);assert.deepEqual(errors,[]);
  await page.screenshot({path:`test-results/dta302-${name}.png`,fullPage:true});await page.close();
  const tabs=await browser.newPage({viewport:{width,height}});
  await tabs.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await tabs.goto(origin+'/tests/ui/fixture.html?screen=billing');
  await tabs.getByRole('button',{name:'Kassenabrechnung',exact:true}).click();
  await tabs.getByRole('heading',{name:'Kassenabrechnung',exact:true}).waitFor();
  assert.equal(await tabs.getByRole('button',{name:'Kassenabrechnung',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await tabs.getByRole('button',{name:'Belegprüfung',exact:true}).getAttribute('class'),'secondary-button');
  assert.equal(await tabs.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}: billing tabs overflow`);
  await tabs.getByRole('button',{name:'Einzelabrechnungen',exact:true}).click();
  await tabs.locator('.billing-kpis').waitFor();await tabs.close();
  console.log(`${name}: export, metadata, ZIP, billing navigation and layout passed`);
 }
}finally{await browser?.close();server.kill('SIGTERM');}
