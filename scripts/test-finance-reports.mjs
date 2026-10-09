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
   await page.screenshot({path:`test-results/${name}-${size}-finance-report.png`,fullPage:true});await page.close();console.log(`PASS ${name} ${size}: financial report totals, partial payments, category/payer/month filters, refresh, no overflow`);
  }}finally{await browser.close()}
 }
}finally{server.kill('SIGTERM')}
