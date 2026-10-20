const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
  fs.mkdirSync('promo/open-pack-output',{recursive:true});
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:'promo/open-pack-output',size:{width:1280,height:720}}});
  const page=await context.newPage();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  await page.goto('http://127.0.0.1:3000',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#packs')?.children.length>0,null,{timeout:55000});
  await sleep(1250);
  await page.locator('#infinite button').click();
  await sleep(1600);
  console.log('pack visible',await page.locator('.sm-pack').count());
  await page.locator('.sm-pack').click();
  console.log('pack clicked');
  await sleep(6000);
  await page.waitForFunction(()=>!!document.querySelector('.sm-slots .sm-slot')||!document.querySelector('#op-flip')?.disabled,null,{timeout:18000}).catch(()=>{});
  const b=page.locator('#op-flip');
  console.log('reveal button enabled',await b.isEnabled());
  if(await b.isEnabled()) await b.click();
  else{
    const slots=page.locator('.sm-slots .sm-slot');
    const n=await slots.count();
    for(let i=0;i<Math.min(n,5);i++){await slots.nth(i).click({timeout:2500}).catch(()=>{});await sleep(350);}
  }
  await sleep(5800);
  if(await page.locator('#op-sum').count())console.log('summary',(await page.locator('#op-sum').innerText()).slice(0,180));
  const vid=page.video();await page.close();fs.copyFileSync(await vid.path(),'promo/open-pack-output/real-pack-reveal.webm');
  await context.close();await browser.close();
})().catch(e=>{console.error(e.stack);process.exitCode=1;});