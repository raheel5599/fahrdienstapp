import {chromium,webkit} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4178','--strictPort'],{env:{...process.env,VITE_BACKEND_MODE:'local'},stdio:'pipe'});
const origin='http://127.0.0.1:4178';
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await mkdir('test-results',{recursive:true});
 const engines=process.env.UI_WEBKIT==='1'?{chromium,webkit}:{chromium};
 for(const[name,engine]of Object.entries(engines)){
 const browser=await engine.launch({headless:true});
 try{for(const[size,width,height]of[['mobile',390,844],['small-mobile',320,568],['ipad-portrait',768,1024],['ipad-landscape',1024,768],['desktop',1440,900]]){
 const page=await browser.newPage({viewport:{width,height}});
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 for(const screen of['client','invoices','receipts','billing','dispatch']){
 await page.goto(`${origin}/tests/ui/fixture.html?screen=${screen}`);
 await page.locator(screen==='client'?'.client-editor':screen==='invoices'?'.finance-row:not(.finance-head)':screen==='receipts'?'.receipt-row:not(.finance-head)':screen==='billing'?'.billing-row:not(.billing-head)':'.trip-row').waitFor();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${name}/${size}/${screen}: page overflow`);
 if(screen==='client'){
 const card=page.locator('.client-editor');const dim=await card.evaluate(el=>({h:el.clientHeight,scroll:el.scrollHeight,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom}));
 assert(dim.top>=0&&dim.bottom<=height,`${name}/${size}: dialog fits viewport`);
 if(size!=='desktop')assert(dim.scroll>dim.h,`${name}/${size}: long form scrolls`);
 await page.getByRole('button',{name:'Speichern',exact:true}).scrollIntoViewIfNeeded();
 const box=await page.getByRole('button',{name:'Speichern',exact:true}).boundingBox();assert(box.y>=0&&box.y+box.height<=height,`${name}/${size}: save reachable`);
 await page.screenshot({path:`test-results/${name}-${size}-client.png`});
 }else if(screen==='invoices'||screen==='receipts'){
 await page.getByRole('button',{name:'Vorschau',exact:true}).click();await page.getByRole('dialog').waitFor();
 const frame=page.frameLocator('iframe');await frame.getByRole('heading',{name:screen==='invoices'?'Rechnung':'Quittung',exact:true}).waitFor();
 if(screen==='invoices'){assert.match(await frame.locator('body').innerText(),/513052/);assert.match(await frame.locator('body').innerText(),/Abzug Eigenanteil/);assert.doesNotMatch(await frame.locator('body').innerText(),/FREMDRECHNUNG/);}
 assert.equal(await page.getByRole('button',{name:'Drucken / PDF',exact:true}).isEnabled(),true);
 const frameObject=page.frames().find(f=>f!==page.mainFrame());await frameObject.evaluate(()=>window.print=()=>document.body.dataset.printed='yes');
 await page.getByRole('button',{name:'Drucken / PDF',exact:true}).click();assert.equal(await frameObject.locator('body').getAttribute('data-printed'),'yes');
 assert.equal(await frameObject.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: document width`);
 await page.screenshot({path:`test-results/${name}-${size}-${screen}-preview.png`});
 await page.getByRole('dialog').getByRole('button',{name:'Vorschau schließen',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
 }else if(screen==='dispatch'){
 const edit=page.getByRole('button',{name:'Bearbeiten',exact:true});assert.equal(await edit.isVisible(),true);await edit.click();assert.equal(await page.locator('body').getAttribute('data-edited'),'yes');
 }else await page.screenshot({path:`test-results/${name}-${size}-billing.png`});
 }
 await page.goto(`${origin}/tests/ui/fixture.html?screen=settings`);await page.getByRole('button',{name:'Unternehmensdaten speichern',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: settings width`);await page.getByLabel('Firmenname',{exact:true}).fill('Geändertes Unternehmen');await page.getByRole('button',{name:'Unternehmensdaten speichern',exact:true}).click();await page.getByRole('status').waitFor();await page.getByRole('button',{name:'Vorlage ansehen',exact:true}).click();const settingsFrame=page.frameLocator('iframe');await settingsFrame.getByText('Geändertes Unternehmen',{exact:true}).first().waitFor();assert.equal(await settingsFrame.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: settings document width`);await page.screenshot({path:`test-results/${name}-${size}-company-preview.png`});
 await page.goto(`${origin}/tests/ui/fixture.html?screen=contracts`);await page.getByRole('button',{name:'Vertrag',exact:true}).click();await page.locator('.tariff-contract-modal').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: contract editor width`);
 await page.goto(`${origin}/tests/ui/fixture.html?screen=driver`);await page.locator('.driver-app').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: driver portal width`);assert.equal(await page.getByRole('button',{name:'Abmelden',exact:true}).isVisible(),true);
 await page.addInitScript(()=>localStorage.setItem('tariq-auth-session-v1',JSON.stringify({mode:'local-directory',user:{id:'ui-test',name:'Testbüro',role:'admin'},expiresAt:Date.now()+60000})));
 await page.goto(`${origin}/tests/ui/fixture.html?screen=shell`);await page.locator('.app-shell').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${name}/${size}: app shell width`);
 if(width<=1180){await page.getByRole('button',{name:'Menü öffnen'}).click();await page.getByRole('button',{name:'Rechnungen',exact:true}).click();}else await page.getByRole('button',{name:'Rechnungen',exact:true}).click();
 await page.getByRole('button',{name:'Quittungen',exact:true}).click();await page.getByRole('heading',{name:'Quittungen',exact:true}).waitFor();
 await page.close();console.log(`PASS ${name} ${size}: customer scroll, invoice/receipt preview, print, billing, dispatch`);
 }}finally{await browser.close();}
 }
}finally{server.kill('SIGTERM');}
