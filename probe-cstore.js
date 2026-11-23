/**
 * 探测 cstore.chinaedu.net（大学英语2 新平台）页面结构
 * 复用已保存的登录态，自动进入 大学英语2 → 抓取视频播放页 DOM
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json');
const OUT = path.join(process.env.HOME, 'chinaedu-study', 'cstore-dump.json');

function log(m) { console.log(`[${new Date().toTimeString().split(' ')[0]}] ${m}`); }
const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'],
  });
  const state = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : undefined;
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  let page = await context.newPage();

  log('打开主平台...');
  await page.goto('https://cjstudy.zstu.edu.cn/student/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3);

  // 若需登录，等用户手动登录
  const needLogin = await page.evaluate(() => document.querySelectorAll('input[type="password"]').length > 0);
  if (needLogin) {
    log('⚠️ 需要手动登录，请在浏览器中登录（最多等3分钟）...');
    for (let i = 0; i < 36; i++) {
      await sleep(5);
      const ok = await page.evaluate(async () => {
        try {
          const r = await fetch('/student/student/coursestudy/getlist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'aggregation' }),
          });
          const t = await r.text();
          if (t.includes('RedirectToLogin')) return false;
          return JSON.parse(t).items?.length > 0;
        } catch { return false; }
      });
      if (ok) { log('✅ 登录成功'); break; }
    }
  }

  // 进入课程列表
  log('进入课程列表...');
  await page.goto('https://cjstudy.zstu.edu.cn/student/#/MyCourse', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(3);

  // 点击 大学英语2
  log('查找 大学英语2 的课程按钮...');
  const pagesBefore = context.pages().length;
  const bts = await page.locator('.videolearning-bt').all();
  let clicked = false;
  for (const bt of bts) {
    const cardText = await bt.evaluate(el => {
      const card = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
      return card ? card.textContent.trim().replace(/\s+/g, ' ') : '';
    });
    if (cardText.includes('大学英语2')) {
      await bt.click();
      clicked = true;
      log(`已点击 大学英语2 (卡片: ${cardText.substring(0, 40)})`);
      break;
    }
  }
  if (!clicked) { log('⚠️ 未找到 大学英语2 按钮'); }

  await sleep(5);
  // 切到计时窗口
  const pages1 = context.pages();
  if (pages1.length > pagesBefore) {
    for (const p of pages1) if (p.url().includes('videolearning')) { page = p; break; }
  }
  log(`当前页: ${page.url().substring(0, 100)}`);

  // 点确定
  log('查找并点击"确定"...');
  for (let i = 0; i < 10; i++) {
    const r = await page.evaluate(() => {
      const s = document.querySelector('.openNewPage');
      if (s && s.offsetWidth > 0) { s.click(); return true; }
      return false;
    }).catch(() => false);
    if (r) { log('✅ 已点击确定'); break; }
    await sleep(2);
  }

  await sleep(6);

  // 找到 cstore 页面
  let cstorePage = null;
  for (const p of context.pages()) {
    if (p.url().includes('cstore.chinaedu.net')) { cstorePage = p; break; }
  }
  if (!cstorePage) {
    log('⚠️ 未找到 cstore 页面，所有页面:');
    context.pages().forEach((p, i) => log(`  [${i}] ${p.url()}`));
  } else {
    log(`✅ 找到 cstore 页面: ${cstorePage.url()}`);
  }

  // 等待视频页加载
  await sleep(8);

  // 抓取 cstore 页面的完整结构
  const dump = { url: '', videoElements: [], playButtons: [], chapters: [], iframes: [], bodyText: '' };
  if (cstorePage) {
    const target = cstorePage;
    dump.url = target.url();
    const info = await target.evaluate(() => {
      const out = { url: location.href, videoElements: [], playButtons: [], chapters: [], iframes: [], bodyText: '' };
      // video 元素
      document.querySelectorAll('video').forEach((v, i) => {
        out.videoElements.push({
          idx: i, id: v.id, cls: v.className, src: (v.currentSrc || v.src || '').substring(0, 150),
          paused: v.paused, duration: v.duration, currentTime: v.currentTime, readyState: v.readyState,
        });
      });
      // 播放按钮
      document.querySelectorAll('[class*="play"], button, .btn, [onclick*="play"]').forEach((el, i) => {
        const t = (el.textContent || '').trim();
        if (t.length < 20) out.playButtons.push({ idx: i, tag: el.tagName, cls: (el.className||'').toString().substring(0,60), text: t });
      });
      // 章节/目录列表
      document.querySelectorAll('li, .item, [class*="chapter"], [class*="section"], [class*="catalog"], [class*="menu"], [class*="nav"]').forEach((el) => {
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (t && t.length < 100 && el.children.length < 5) {
          out.chapters.push({ tag: el.tagName, cls: (el.className||'').toString().substring(0,60), text: t, onclick: (el.getAttribute('onclick')||'').substring(0,80) });
        }
      });
      // iframe
      document.querySelectorAll('iframe').forEach((f, i) => {
        out.iframes.push({ idx: i, id: f.id, src: (f.src||'').substring(0,150), cls: f.className });
      });
      out.bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').substring(0, 800);
      return out;
    });
    Object.assign(dump, info);
    // 去重章节
    const seen = new Set();
    dump.chapters = dump.chapters.filter(c => { if (seen.has(c.text)) return false; seen.add(c.text); return true; });

    fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
    log(`\n✅ 已导出结构到 ${OUT}`);
    log(`\n=== 页面信息 ===`);
    log(`URL: ${dump.url}`);
    log(`\n视频元素 (${dump.videoElements.length}):`);
    dump.videoElements.forEach(v => log(`  video[${v.idx}] id="${v.id}" src="${v.src}" paused=${v.paused} dur=${v.duration}`));
    log(`\niframe (${dump.iframes.length}):`);
    dump.iframes.forEach(f => log(`  iframe[${f.idx}] id="${f.id}" src="${f.src}"`));
    log(`\n播放按钮 (${dump.playButtons.length}):`);
    dump.playButtons.slice(0, 20).forEach(b => log(`  <${b.tag}> cls="${b.cls}" text="${b.text}"`));
    log(`\n章节/列表项 (${dump.chapters.length}):`);
    dump.chapters.slice(0, 40).forEach((c, i) => log(`  [${i}] <${c.tag}> cls="${c.cls}" text="${c.text.substring(0, 60)}"`));
    log(`\n页面文字: ${dump.bodyText.substring(0, 400)}`);
  }

  log('\n浏览器保持打开 60 秒供你查看...');
  await sleep(60);
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
