/**
 * 探测 cstore 点击"观看视频"后的播放器结构
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json');
const OUT = path.join(process.env.HOME, 'chinaedu-study', 'cstore-player-dump.json');

function log(m) { console.log(`[${new Date().toTimeString().split(' ')[0]}] ${m}`); }
const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

(async () => {
  const browser = await chromium.launch({
    headless: false, channel: 'chrome',
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
  });
  const state = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : undefined;
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  let page = await context.newPage();

  // 直接打开 cstore 页面（登录态已保存）
  log('直接打开 cstore 页面...');
  await page.goto('https://cstore.chinaedu.net/cstore/preview/index/index.do?courseVersionId=3c8e9cea-cc5b-4bcd-977d-b7a4dc55982b',
    { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
  await sleep(6);
  log(`当前URL: ${page.url()}`);
  log(`页面文字: ${(await page.evaluate(() => document.body?.innerText || '')).replace(/\s+/g,' ').substring(0,200)}`);

  // 找到第一个"观看视频"并点击
  log('\n查找"观看视频"按钮...');
  const clickResult = await page.evaluate(() => {
    // 找到所有包含"观看视频"的可点击元素
    const all = Array.from(document.querySelectorAll('a, span, button, div, li'));
    const btns = all.filter(el => {
      const t = (el.textContent || '').trim();
      return t === '观看视频' && el.offsetWidth > 0;
    });
    if (btns.length === 0) return { found: 0 };
    // 记录元素结构
    const info = btns.map(b => ({ tag: b.tagName, cls: (b.className||'').toString(), onclick: b.getAttribute('onclick')||'', outer: b.outerHTML.substring(0,200) }));
    btns[0].click();
    return { found: btns.length, info };
  });
  log(`"观看视频"按钮数量: ${clickResult.found}`);
  if (clickResult.info) clickResult.info.forEach((b,i)=>log(`  [${i}] <${b.tag}> cls="${b.cls}" onclick="${b.onclick}"\n      ${b.outer}`));

  await sleep(8);

  // 点击后抓取所有页面的播放器结构
  log('\n=== 点击后页面状态 ===');
  const dump = { pages: [] };
  const allPages = context.pages();
  log(`标签页总数: ${allPages.length}`);
  for (let pi = 0; pi < allPages.length; pi++) {
    const p = allPages[pi];
    const pInfo = await p.evaluate(() => {
      const o = { url: location.href, videos: [], iframes: [], playerEls: [], bodyText: '' };
      document.querySelectorAll('video').forEach((v,i)=>o.videos.push({
        i, id: v.id, cls: v.className, src: (v.currentSrc||v.src||'').substring(0,180),
        paused: v.paused, dur: v.duration, cur: v.currentTime, rs: v.readyState,
      }));
      document.querySelectorAll('iframe').forEach((f,i)=>o.iframes.push({ i, id:f.id, src:(f.src||'').substring(0,180), cls:f.className }));
      // 播放器容器
      document.querySelectorAll('[class*="video"], [class*="player"], [id*="video"], [id*="player"], .prism, [class*="prism"]').forEach((el,i)=>{
        if (i<30) o.playerEls.push({ tag: el.tagName, id: el.id, cls: (el.className||'').toString().substring(0,60) });
      });
      o.bodyText = (document.body?.innerText||'').replace(/\s+/g,' ').substring(0,500);
      return o;
    }).catch(e => ({ error: e.message }));
    dump.pages.push(pInfo);
    log(`\n--- 页面[${pi}]: ${pInfo.url?.substring(0,120)}`);
    log(`  video元素: ${pInfo.videos?.length || 0}`);
    (pInfo.videos||[]).forEach(v=>log(`    video id="${v.id}" src="${v.src}" paused=${v.paused} dur=${v.dur} rs=${v.rs}`));
    log(`  iframe: ${pInfo.iframes?.length || 0}`);
    (pInfo.iframes||[]).forEach(f=>log(`    iframe id="${f.id}" src="${f.src}"`));
    log(`  播放器容器: ${pInfo.playerEls?.length || 0}`);
    (pInfo.playerEls||[]).slice(0,10).forEach(e=>log(`    <${e.tag}> id="${e.id}" cls="${e.cls}"`));
    log(`  文字: ${(pInfo.bodyText||'').substring(0,200)}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
  log(`\n✅ 已导出到 ${OUT}`);
  log('浏览器保持 90 秒，你可以手动点一下视频看效果...');
  await sleep(90);
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
