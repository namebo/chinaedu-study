/** 探测 习近平 课程的 play.html 章节导航真实结构 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json');
const OUT = path.join(process.env.HOME, 'chinaedu-study', 'xijinping-dump.json');
const KEYWORD = '习近平';
const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));
const log = (m) => console.log(`[${new Date().toTimeString().split(' ')[0]}] ${m}`);

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome',
    args: ['--no-first-run', '--disable-blink-features=AutomationControlled'] });
  const state = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : undefined;
  const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  let page = await context.newPage();

  await page.goto('https://cjstudy.zstu.edu.cn/student/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await sleep(3);
  const ok = await page.evaluate(async () => {
    try {
      const r = await fetch('/student/student/coursestudy/getlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'aggregation' }),
      });
      const t = await r.text();
      return t.includes('RedirectToLogin') ? null : JSON.parse(t);
    } catch { return null; }
  });
  if (!ok) { log('⚠️ 登录态失效'); await browser.close(); return; }

  await page.goto('https://cjstudy.zstu.edu.cn/student/#/MyCourse', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await sleep(3);

  const pagesBefore = context.pages().length;
  const bts = await page.locator('.videolearning-bt').all();
  for (const bt of bts) {
    const t = await bt.evaluate(el => {
      const c = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
      return c ? c.textContent : '';
    });
    if (t.includes(KEYWORD)) { await bt.click(); break; }
  }
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
  await sleep(8);

  // 找视频页（fjshare）
  const vpage = context.pages().find(p => p.url().includes('fjshare.chinaedu.net')) || page;
  log(`视频页: ${vpage.url().substring(0, 120)}`);
  await sleep(8);

  // 列出所有 frame
  log('\n=== 所有 frame ===');
  for (const p of context.pages()) {
    for (const f of p.frames()) {
      const u = f.url() || '';
      if (u && u !== 'about:blank') log(`  ${u.substring(0, 130)}`);
    }
  }

  // 找到 play.html 或 playFrame，抓导航结构
  for (const p of context.pages()) {
    for (const f of p.frames()) {
      const u = f.url() || '';
      if (u.includes('play.html') || u.includes('play')) {
        log(`\n=== 探测 frame: ${u.substring(0, 100)} ===`);
        const dump = await f.evaluate(() => {
          const o = { url: location.href, bodyText: '', navEls: [], allLinks: [] };
          o.bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').substring(0, 1000);
          // 所有 a 标签
          document.querySelectorAll('a').forEach(a => {
            const t = (a.textContent || '').trim();
            if (t) o.allLinks.push({ href: a.getAttribute('href') || '', text: t.substring(0, 60), cls: (a.className || '').toString().substring(0, 40) });
          });
          // 导航元素
          document.querySelectorAll('[class*="nav"], [class*="menu"], [class*="chapter"], [class*="section"], [class*="catalog"], li').forEach(el => {
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            if (t && t.length < 80 && el.children.length < 6) {
              o.navEls.push({ tag: el.tagName, cls: (el.className || '').toString().substring(0, 50), text: t });
            }
          });
          return o;
        }).catch(e => ({ error: e.message }));

        fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
        log(`已导出到 ${OUT}`);
        log(`页面文字: ${dump.bodyText?.substring(0, 400)}`);
        log(`\n所有链接 (${dump.allLinks?.length || 0}):`);
        (dump.allLinks || []).slice(0, 40).forEach((l, i) => log(`  [${i}] href="${l.href.substring(0,40)}" cls="${l.cls}" text="${l.text}"`));
        log(`\n导航元素 (${dump.navEls?.length || 0}):`);
        (dump.navEls || []).slice(0, 40).forEach((e, i) => log(`  [${i}] <${e.tag}> cls="${e.cls}" text="${e.text}"`));
      }
    }
  }

  log('\n浏览器保持 120 秒供你查看，可以手动看看左侧章节列表长什么样...');
  await sleep(120);
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
