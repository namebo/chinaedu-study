/** 抓取大学英语2 全部视频 uuid，生成去重文件的「已学」部分 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const AUTH = path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json');
const OUT = path.join(process.env.HOME, 'chinaedu-study', 'cstore-learned.json');
const DONE_COUNT = parseInt(process.argv[2] || '9', 10);
const COURSE_ID = '3c8e9cea-cc5b-4bcd-977d-b7a4dc55982b';

const sleep = (s) => new Promise(r => setTimeout(r, s * 1000));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const state = fs.existsSync(AUTH) ? JSON.parse(fs.readFileSync(AUTH, 'utf8')) : undefined;
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  await page.goto(`https://cstore.chinaedu.net/cstore/preview/index/index.do?courseVersionId=${COURSE_ID}`,
    { waitUntil: 'networkidle', timeout: 40000 });
  await sleep(5);

  const list = await page.evaluate(() => {
    const out = [];
    const btns = Array.from(document.querySelectorAll('a')).filter(a =>
      (a.textContent || '').trim() === '观看视频' && (a.getAttribute('onclick') || '').includes('previewActivity'));
    btns.forEach((btn, idx) => {
      const oc = btn.getAttribute('onclick') || '';
      const m = oc.match(/previewActivity\(['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\)/);
      const li = btn.closest('li');
      let title = li ? (li.textContent || '').replace(/\s+/g, ' ').trim() : '';
      title = title.replace(/有效时长\/视频时长|观看视频|\d{2}:\d{2}\/\d{2}:\d{2}/g, '').trim();
      out.push({ idx, uuid: m ? m[1] : null, title: title.substring(0, 80) });
    });
    return out;
  });

  console.log(`抓到 ${list.length} 个视频，标记前 ${DONE_COUNT} 个为已学`);
  const data = list.slice(0, DONE_COUNT).map(v => ({
    key: `${COURSE_ID}:${v.uuid}`,
    uuid: v.uuid,
    courseId: COURSE_ID,
    title: v.title,
    date: new Date().toISOString(),
    note: '补录（上次已完成）',
  })).filter(v => v.uuid);

  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`✅ 已写入 ${data.length} 条到 ${OUT}`);
  data.forEach((v, i) => console.log(`  [${i + 1}] ${v.title} (${v.uuid.substring(0, 8)}...)`));
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
