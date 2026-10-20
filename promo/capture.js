'use strict';
/* Records real UI interactions of Anime Boosters in an isolated local demo,
   without changing production accounts, game rules, or the deployed site. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.resolve('promo/output');
const BASE = 'http://127.0.0.1:3000';
fs.mkdirSync(OUT, {recursive:true});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const data = { scenes: [], diagnostics: [] };
function log(s) { console.log('[promo]', s); data.diagnostics.push(s); }

(async () => {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox', '--disable-dev-shm-usage']});
  const ctx = await browser.newContext({
    viewport:{width:1280, height:720},
    deviceScaleFactor:1,
    reducedMotion:'no-preference',
    recordVideo:{dir:OUT, size:{width:1280,height:720}}
  });
  const register = await ctx.request.post(BASE + '/api/register', {data:{
    email:'showcase-streamer@example.test', pseudo:'DemoStream', password:'DemoPass2026',
    importGuest:false
  }});
  log('register ' + register.status() + ' ' + (await register.text()).slice(0,130));
  // Seed by legitimate free pack openings on this isolated demonstration server,
  // to give the TCG suggested deck enough actually-owned cards.
  let opened = 0;
  for(let i=0;i<100;i++) {
    const r = await ctx.request.post(BASE + '/api/open', {data:{id:'infinite'}});
    const j = await r.json().catch(() => ({}));
    if (r.ok() && Array.isArray(j.cards)) opened++;
    else log('open '+i+' '+r.status()+' '+(j.error || ''));
    if ((i+1)%10===0) await sleep(1050);
  }
  const check = await ctx.request.get(BASE + '/api/tcg');
  const tcg = await check.json().catch(()=>({}));
  log('preopened '+opened+' packs, suggested deck '+(tcg.suggested || []).length);
  const page = await ctx.newPage();
  page.on('pageerror', e => log('pageerror '+e.message.slice(0,150)));
  const started = Date.now();
  async function shot(name, callback) {
    const start = (Date.now() - started)/1000;
    try { await callback(); log(name+' OK'); }
    catch(e) { log(name+' ERROR '+e.message.slice(0,220)); await sleep(1200); }
    data.scenes.push({name,start,end:(Date.now()-started)/1000});
  }
  async function click(selector, timeout=8000) {
    const target=page.locator(selector).first();
    await target.click({timeout});
  }
  async function tab(name) {
    await click('nav button[data-tab="'+name+'"]');
    await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
    await sleep(700);
  }
  await page.goto(BASE, {waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(() => document.querySelector('#packs')?.children.length>0, null, {timeout:60000});
  await sleep(1600);
  await shot('00_BOUTIQUE_ET_BOOSTERS', async () => {
    await page.mouse.move(730,315,{steps:15}); await sleep(1900);
    await page.evaluate(() => window.scrollTo({top:520,behavior:'smooth'}));
    await sleep(2200);
    await page.evaluate(() => window.scrollTo({top:0,behavior:'smooth'}));
    await sleep(1600);
  });
  await shot('01_OUVERTURE_PACK_REELLE', async () => {
    await click('#infinite button');
    await sleep(5000);
    const flip=page.locator('#op-flip');
    if(await flip.count() && await flip.isEnabled()) await flip.click();
    else {
      const backs=page.locator('.sm-slot:not(.up)');
      for(let i=0;i<Math.min(3,await backs.count());i++)
        await backs.nth(i).click({timeout:2000}).catch(()=>{});
    }
    await sleep(5800);
    await click('#op-close');
    await sleep(900);
  });
  await shot('02_PACKS_PAR_ANIME', async () => {
    await tab('shop');
    await page.evaluate(() => document.querySelector('#anime-search')?.scrollIntoView({behavior:'smooth',block:'start'}));
    await sleep(1500);
    await page.locator('#anime-search').fill('Naruto');
    await sleep(2500);
    await page.locator('#anime-search').fill('');
    await sleep(900);
  });
  await shot('03_COLLECTION_ET_CLASSEURS', async () => {
    await tab('binder');
    await sleep(2600);
    const cover=page.locator('.binder-cv:not([data-u^="_"])').first();
    await cover.click({timeout:12000});
    await sleep(1800);
    if(await page.locator('#book-next').isVisible()) {
      await click('#book-next'); await sleep(1350);
      await click('#book-next'); await sleep(1300);
    }
    await click('#book-close'); await sleep(900);
  });
  await shot('04_CHANCES_ET_STATS', async () => {
    await tab('stats');
    await sleep(2600);
    await page.evaluate(() => document.querySelector('#rates')?.scrollIntoView({behavior:'smooth',block:'start'}));
    await sleep(2600);
  });
  await shot('05_PROFILS_JOUEURS', async () => {
    await tab('players'); await sleep(3600);
  });
  await shot('06_ARENE_TCG', async () => {
    await tab('tcg'); await sleep(3700);
  });
  await shot('07_DECK_BUILDING', async () => {
    await click('#tcg-deck-tab');
    await sleep(2200);
    const btn=page.locator('#tcg-starter-deck');
    if(await btn.count() && await btn.isEnabled()) await btn.click();
    await sleep(1900);
    await page.evaluate(() => document.querySelector('#tcg-deck-list')?.scrollIntoView({behavior:'smooth',block:'center'}));
    await sleep(2400);
    await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
  });
  await shot('08_COMBAT_CONTRE_IA', async () => {
    await click('#tcg-arena-tab');
    await sleep(750);
    const solo=page.locator('[data-create="solo"]');
    if(await solo.count() && await solo.isEnabled()) await solo.click({timeout:9000});
    await sleep(4500);
    log('battle actions '+JSON.stringify((await page.locator('#tcg-battle button').allTextContents()).slice(0,24)));
    // Real player actions through the interface; never fake board state.
    for(let i=0;i<4;i++) {
      const place=page.locator('#tcg-battle button[data-pocket-action="play"]:not([disabled])').first();
      if(!await place.count()) break;
      await place.click().catch(()=>{}); await sleep(600);
    }
    const ready=page.locator('#tcg-battle button[data-pocket-action="ready"]:not([disabled])');
    if(await ready.count()) { await ready.click(); await sleep(2800); }
    const energy=page.locator('#tcg-battle button[data-pocket-action="energy"]:not([disabled])').last();
    if(await energy.count()) { await energy.click(); await sleep(1100); }
    const attack=page.locator('#tcg-battle button[data-pocket-action="attack"]:not([disabled])').last();
    if(await attack.count()) { await attack.click(); await sleep(3500); }
    const end=page.locator('#tcg-battle button[data-pocket-action="end"]:not([disabled])');
    if(await end.count()) { await end.click(); await sleep(2500); }
    await sleep(2600);
  });
  await shot('09_MULTIJOUEUR_ET_FIN', async () => {
    await tab('tcg');
    if(await page.locator('[data-leave]').count()) {
      page.once('dialog', d => d.accept());
      await page.locator('[data-leave]').first().click().catch(()=>{});
      await sleep(700);
    }
    await sleep(1800);
    await tab('shop'); await sleep(1700);
    await page.mouse.move(610,200,{steps:15}); await sleep(700);
  });
  fs.writeFileSync(path.join(OUT,'scenes.json'),JSON.stringify(data,null,2));
  const video=page.video();
  await page.close();
  const pathWebm=await video.path();
  fs.copyFileSync(pathWebm,path.join(OUT,'full-recording.webm'));
  await ctx.close(); await browser.close();
  log('Saved full-recording.webm; '+data.scenes.length+' scenes');
})().catch(e => { console.error(e.stack); process.exitCode=1; });