/** 探测习近平新时代中国特色社会主义思想概论 的课程ID与平台类型 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json');
const KEYWORD = process.argv[2] || '习近平';

const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));
const log = (m) => console.log(`[${new Date().toTimeString().split(' ')[0]}] ${m}`);

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const state = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : undefined;
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  let page = await context.newPage();

  await page.goto('https://cjstudy.zstu.edu.cn/student/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3);

  // 校验登录态
  const ok = await page.evaluate(async () => {
    try {
      const r = await fetch('/student/student/coursestudy/getlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'aggregation' }),
      });
      const t = await r.text();
      if (t.includes('RedirectToLogin')) return null;
      return JSON.parse(t);
    } catch { return null; }
  });

  if (!ok) { log('⚠️ 登录态失效，请先手动登录一次（运行 node chinaedu-study.js 会提示）'); await browser.close(); return; }

  // 打印课程列表详情
  log(`共 ${ok.items.length} 门课程:`);
  ok.items.forEach((c, i) => {
    log(`  [${i + 1}] ${c.courseName || c.bussinessCaseName}  courseVersionID=${c.courseVersionID || c.courseVersionId || '?'}`);
  });

  const target = ok.items.find(c => (c.courseName || c.bussinessCaseName || '').includes(KEYWORD));
  if (!target) { log(`⚠️ 未找到含「${KEYWORD}」的课程`); await browser.close(); return; }
  log(`\n✅ 目标课程: ${target.courseName || target.bussinessCaseName}`);
  log(`   courseVersionID: ${target.courseVersionID || target.courseVersionId}`);

  // 点击进入该课程，看落到哪个平台
  await page.goto('https://cjstudy.zstu.edu.cn/student/#/MyCourse', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(3);

  const pagesBefore = context.pages().length;
  const bts = await page.locator('.videolearning-bt').all();
  let clicked = false;
  for (const bt of bts) {
    const cardText = await bt.evaluate(el => {
      const card = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
      return card ? card.textContent.trim().replace(/\s+/g, ' ') : '';
    });
    if (cardText.includes(KEYWORD)) {
      await bt.click(); clicked = true;
      log(`已点击课程 (卡片: ${cardText.substring(0, 50)})`);
      break;
    }
  }
  if (!clicked) log('⚠️ 未找到课程按钮');

  await sleep(5);
  const pages1 = context.pages();
  if (pages1.length > pagesBefore) {
    for (const p of pages1) if (p.url().includes('videolearning')) { page = p; break; }
  }

  // 点确定
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

  log('\n=== 点击后所有页面 ===');
  context.pages().forEach((p, i) => log(`  [${i}] ${p.url().substring(0, 140)}`));

  // 若落到 cstore，抓课程列表
  const cstore = context.pages().find(p => p.url().includes('cstore.chinaedu.net'));
  if (cstore) {
    const cid = (cstore.url().match(/courseVersionId=([^&]+)/) || [])[1];
    log(`\n[cstore] 课程ID: ${cid}`);
    await sleep(5);
    const list = await cstore.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('a')).filter(a =>
        (a.textContent || '').trim() === '观看视频' && (a.getAttribute('onclick') || '').includes('previewActivity'));
      return btns.map((btn, idx) => {
        const oc = btn.getAttribute('onclick') || '';
        const m = oc.match(/previewActivity\(['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\)/);
        const li = btn.closest('li');
        let t = li ? (li.textContent || '').replace(/\s+/g, ' ').trim() : '';
        t = t.replace(/有效时长\/视频时长|观看视频|\d{2}:\d{2}\/\d{2}:\d{2}/g, '').trim();
        return { idx, uuid: m ? m[1] : null, title: t.substring(0, 70) };
      });
    });
    log(`[cstore] 共 ${list.length} 个视频:`);
    list.forEach(v => log(`  [${v.idx + 1}] ${v.title} (${v.uuid ? v.uuid.substring(0, 8) : '无'})`));
  } else {
    log('\n[非cstore] 走旧 iframe 平台逻辑');
  }

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
