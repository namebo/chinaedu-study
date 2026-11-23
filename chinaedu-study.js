/**
 * 浙江理工大学·弘成教育 - 自动刷课脚本 v2.0.3
 *
 * 核心策略：必须从 cjstudy.zstu.edu.cn 主平台入口进入
 * videolearning.html 是计时窗口，必须保持打开才能计学时
 *
 * v2.0.3 修复：
 *   - 修复视频暂停后无法恢复播放的问题
 *   - 增强 playVideo()：先点击视频区域激活，再调用 play()
 *   - 优先使用 Video.js 播放器状态（paused/ended）
 *   - 增加定期保活机制（每30秒尝试一次播放）
 *   - 改进卡顿检测（不依赖 paused 状态）
 *
 * 平台架构：
 *   cjstudy.zstu.edu.cn（主平台）
 *     → 点击课程 → 打开 videolearning.html（计时窗口，必须保持）
 *       → 内嵌 iframe → fjshare.chinaedu.net（视频播放器）
 *
 * 用法：
 *   node chinaedu-study.js           # 自动选择第一个未完成的课程
 *   node chinaedu-study.js "大学英语"  # 按名称关键词匹配课程
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const CONFIG = {
  // 浙江理工大学继续教育平台
  platformUrl: 'https://cjstudy.zstu.edu.cn/student/',

  // 检查间隔（秒）
  checkInterval: 5,

  // 在线确认弹框检查间隔（秒）
  popupCheckInterval: 3,

  // 视频卡住超时（秒）
  videoStuckTimeout: 120,

  // 是否显示浏览器界面
  headless: false,

  // 防挂机：模拟鼠标移动间隔（秒）
  activityInterval: 20,

  // 登录状态保存路径
  authStateFile: path.join(process.env.HOME, 'chinaedu-study', 'auth-state-zstu.json'),

  // 已学记录文件
  learnedFile: path.join(process.env.HOME, 'chinaedu-study', 'learned-courses.json'),

  // 日志文件
  logFile: path.join(process.env.HOME, 'chinaedu-study', 'study.log'),
};

// ============ 全局状态 ============
let completedSections = 0;
let totalStudyMinutes = 0;
let lastVideoTime = -1;
let stuckCounter = 0;
let learnedSections = new Set();
let learnedData = [];
let logStream = null;
let sectionList = [];
let currentSectionIdx = 0;
let context_global = null;   // 全局 context 引用（cstore 模式需要）

// cstore 模式的登录状态保存（复用 saveAuthState 需要 context）
async function saveAuthStateAsync(ctx) {
  if (ctx && typeof saveAuthState === 'function') {
    return await saveAuthState(ctx);
  }
}

// ============ 工具函数 ============
function log(msg) {
  const now = new Date();
  const ts = now.toTimeString().split(' ')[0];
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function sleep(sec) {
  return new Promise(r => setTimeout(r, sec * 1000));
}

// ============ 去重管理 ============
function loadLearned() {
  try {
    if (fs.existsSync(CONFIG.learnedFile)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.learnedFile, 'utf8'));
      if (Array.isArray(data)) {
        learnedData = data;
        data.forEach(item => {
          const name = typeof item === 'string' ? item : item.name;
          if (name) learnedSections.add(name);
        });
        log(`[去重] 已加载 ${learnedSections.size} 条已学记录`);
      }
    } else {
      learnedData = [];
      const dir = path.dirname(CONFIG.learnedFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG.learnedFile, '[]');
    }
  } catch (e) {
    log(`[去重] 加载失败: ${e.message}`);
  }
}

function saveLearned(sectionName) {
  if (!sectionName || learnedSections.has(sectionName)) return;
  learnedSections.add(sectionName);
  learnedData.push({ name: sectionName, date: new Date().toISOString(), ts: Date.now() });
  try {
    fs.writeFileSync(CONFIG.learnedFile, JSON.stringify(learnedData, null, 2));
    log(`[去重] 已保存: ${sectionName}`);
  } catch (e) {
    log(`[去重] 保存失败: ${e.message}`);
  }
}

// ============ 登录 ============
async function doLogin(page) {
  log('[登录] 尝试自动登录...');
  try {
    const usernameSelectors = [
      'input[name="username"]', 'input[name="userName"]', 'input[name="user"]',
      '#username', '#userName', 'input[type="text"]',
    ];
    const passwordSelectors = [
      'input[name="password"]', 'input[name="pwd"]', '#password', 'input[type="password"]',
    ];

    let filledUser = false;
    for (const sel of usernameSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill('2698352231');
        filledUser = true;
        break;
      }
    }

    let filledPass = false;
    for (const sel of passwordSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.fill('352231');
        filledPass = true;
        break;
      }
    }

    // 检测是否有验证码
    const hasCaptcha = await page.evaluate(() => {
      // 常见验证码元素
      const captchaSelectors = [
        'input[name*="code"]', 'input[name*="verify"]', 'input[name*="captcha"]',
        '#code', '#verifyCode', '#captcha', '#valicode',
        'img[src*="code"]', 'img[src*="captcha"]', 'img[src*="verify"]',
        '.captcha', '.verify-code', '.code-img',
        'canvas[class*="code"]', 'canvas[class*="captcha"]',
      ];
      for (const sel of captchaSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0) return true;
      }
      return false;
    });

    if (hasCaptcha) {
      log('');
      log('  ╔══════════════════════════════════════════════════════╗');
      log('  ║  ⚠️  检测到验证码，请手动完成登录（最多等5分钟）      ║');
      log('  ║                                                      ║');
      log('  ║  1. 在浏览器里输入验证码                             ║');
      log('  ║  2. 点击「登录」按钮                                 ║');
      log('  ║  3. 登录成功后脚本会自动继续（会校验登录态）          ║');
      log('  ╚══════════════════════════════════════════════════════╝');
      log('');

      // 等待用户手动登录，最多等5分钟
      for (let i = 0; i < 60; i++) {
        await sleep(5);
        // 校验方式：密码框消失 + 课程列表 API 返回正常JSON（双重校验，避免误判）
        const noPassword = await page.evaluate(() => {
          return document.querySelectorAll('input[type="password"]').length === 0;
        });
        if (!noPassword) continue;

        // 二次校验：调用课程列表 API，确认登录态有效
        const apiOk = await page.evaluate(async () => {
          try {
            const res = await fetch('/student/student/coursestudy/getlist', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: 'aggregation' }),
            });
            const text = await res.text();
            if (text.includes('RedirectToLogin')) return false;
            const json = JSON.parse(text);
            return !!(json && (json.items || json.data));
          } catch {
            return false;
          }
        });

        if (apiOk) {
          log('[登录] ✅ 登录成功（已验证登录态有效）');
          return true;
        } else if (i % 3 === 0) {
          log(`[登录] 密码框已消失，但登录态尚未生效，继续等待... (${i * 5}s)`);
        }
      }
      log('[登录] ⏰ 等待超时（5分钟），请重新运行');
      return false;
    }

    if (filledUser && filledPass) {
      // 无验证码，自动点击登录
      const btnSelectors = [
        'button[type="submit"]', 'input[type="submit"]', '.login-btn',
        'button:has-text("登录")', 'button:has-text("登 录")',
      ];
      for (const sel of btnSelectors) {
        try {
          await page.click(sel, { timeout: 2000 });
          log('[登录] 已点击登录按钮');
          break;
        } catch {}
      }
      await sleep(5);

      // 检查是否已登录
      const currentUrl = page.url();
      if (!currentUrl.includes('/login')) {
        log('[登录] ✅ 登录成功');
        return true;
      }
    }
  } catch (e) {
    log(`[登录] 自动登录失败: ${e.message}`);
  }
  return false;
}

// ============ 保存/加载登录状态 ============
async function saveAuthState(context) {
  try {
    const state = await context.storageState();
    const dir = path.dirname(CONFIG.authStateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.authStateFile, JSON.stringify(state, null, 2));
    log('[登录] 已保存登录状态');
  } catch (e) {
    log(`[登录] 保存状态失败: ${e.message}`);
  }
}

// ============ Frame 查找 ============
function findFrame(page, urlPattern) {
  return page.frames().find(f => f.url().includes(urlPattern));
}

function getVideoFrame(page) {
  return findFrame(page, 'video.html');
}

function getPlayFrame(page) {
  return findFrame(page, 'play.html');
}

// ============ 视频操作 ============
async function getVideoInfo(videoFrame) {
  if (!videoFrame) return null;
  try {
    return await videoFrame.evaluate(() => {
      const video = document.querySelector('#videoFrame_video_html5_api');
      if (!video) return null;
      
      // 也检查 Video.js 播放器状态
      let playerState = {};
      if (window.videojs) {
        try {
          const player = window.videojs.players?.videoFrame_video;
          if (player) {
            playerState = {
              playerPaused: player.paused(),
              playerEnded: player.ended(),
            };
          }
        } catch {}
      }
      
      return {
        paused: video.paused,
        ended: video.ended,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        readyState: video.readyState,
        ...playerState,
      };
    });
  } catch (e) {
    return null;
  }
}

async function playVideo(videoFrame) {
  if (!videoFrame) return false;
  try {
    const result = await videoFrame.evaluate(() => {
      const video = document.querySelector('#videoFrame_video_html5_api');
      if (!video) return { ok: false, reason: 'no video element' };

      // 策略1: 先点击视频区域激活（有些网站需要用户交互）
      const videoDiv = document.querySelector('#videoFrame_video');
      if (videoDiv) {
        videoDiv.click();
        // 派发鼠标事件
        videoDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        videoDiv.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        videoDiv.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }

      // 策略2: 点击大播放按钮（暂停时显示）
      const bigPlayBtn = document.querySelector('.vjs-big-play-button');
      if (bigPlayBtn && bigPlayBtn.offsetWidth > 0) {
        bigPlayBtn.click();
      }

      // 策略3: 点击控制栏播放按钮
      const playBtn = document.querySelector('.vjs-play-control');
      if (playBtn) {
        playBtn.click();
      }

      // 策略4: 直接调用 play()
      if (video.paused) {
        const promise = video.play();
        if (promise) {
          promise.catch(() => {});
        }
      }

      return { ok: true, paused: video.paused, currentTime: video.currentTime };
    });
    return result.ok;
  } catch (e) {
    log(`[播放] 异常: ${e.message}`);
    return false;
  }
}

// ============ 在线确认弹框处理 ============
async function checkAndClosePopup(playFrame, mainPage) {
  if (!playFrame) return false;
  try {
    const popupInfo = await playFrame.evaluate(() => {
      const overlay = document.querySelector('#overlay');
      const olClose = document.querySelector('#ol-close');
      if (!overlay) return { exists: false };
      const overlayH = overlay.offsetHeight;
      const closeH = olClose ? olClose.offsetHeight : 0;
      const hasContent = overlay.innerHTML.trim().length > 0;
      const isPopup = overlayH > 10 || closeH > 5 || (hasContent && overlay.style.display !== 'none');
      return { exists: true, isPopup, overlayH, closeH };
    });

    if (popupInfo.isPopup) {
      log(`[弹框] ⚠️ 检测到在线确认弹框！overlayH=${popupInfo.overlayH} closeH=${popupInfo.closeH}`);
      const closed = await playFrame.evaluate(() => {
        const closeBtn = document.querySelector('#ol-close');
        if (closeBtn && closeBtn.offsetHeight > 0) {
          closeBtn.click();
          return 'ol-close';
        }
        const overlay = document.querySelector('#overlay');
        if (overlay) {
          overlay.style.display = 'none';
          overlay.style.height = '0';
          return 'force-hide';
        }
        return null;
      });
      if (closed) {
        log(`[弹框] 已关闭 (${closed})`);
        const videoFrame = getVideoFrame(mainPage);
        if (videoFrame) await playVideo(videoFrame);
      }
      return true;
    }
  } catch {}
  return false;
}

// ============ 章节列表获取 ============
async function getAllSections(playFrame) {
  if (!playFrame) return [];
  try {
    return await playFrame.evaluate(() => {
      const sections = [];

      // 过滤黑名单文字
      const blackList = ['首页', '课程讲解', '展开', '更多', '目录', '视频', '语音',
        '登录', '退出', '个人中心', '注销', '返回', '上一页', '下一页', '关闭'];

      // ——— 策略1：a[href="javascript:;"]，识别"第X讲"为 unit，子节为 section ———
      const links1 = document.querySelectorAll('a[href="javascript:;"]');
      let currentUnit = '';
      for (const link of links1) {
        const text = link.textContent.trim();
        if (!text || text.length > 80 || blackList.includes(text)) continue;
        // "第X讲" 或 "专题X" 或 "Unit X" 或 "第X章" 作为 unit
        if (text.match(/^第\d+讲/) || text.match(/^专题[一二三四五六七八九十\d]+/) ||
            text.match(/^(Unit|unit|UNIT)\s*\d+/i) || text.match(/^第\d+章/) || text.match(/^第\d+单元/)) {
          currentUnit = text;
        } else if (currentUnit && !text.startsWith('http')) {
          sections.push({ unit: currentUnit, section: text });
        }
      }
      if (sections.length > 0) return sections;

      // ——— 策略2：列表结构 li / .chapter / .section ———
      const listItems = document.querySelectorAll(
        '.chapter-list li, .section-list li, .catalog li, .nav-list li, ' +
        '.course-nav li, .lesson-list li, ul.chapters li, ol.chapters li, ' +
        '[class*="chapter"] li, [class*="section"] li, [class*="catalog"] li'
      );
      if (listItems.length > 0) {
        let unit = '章节';
        for (const li of listItems) {
          const text = li.textContent.trim();
          if (!text || blackList.includes(text)) continue;
          const cls = li.className || '';
          if (cls.includes('unit') || cls.includes('chapter') || cls.includes('title') ||
              text.match(/^第\d+讲/) || text.match(/^专题/) || text.match(/^Unit\s*\d+/i)) {
            unit = text.substring(0, 60);
          } else {
            sections.push({ unit, section: text.substring(0, 80) });
          }
        }
        if (sections.length > 0) return sections;
      }

      // ——— 策略3：所有 a 标签，按内容过滤 ———
      const allLinks = document.querySelectorAll('a');
      let unit3 = '章节';
      for (const a of allLinks) {
        const text = a.textContent.trim();
        const href = a.getAttribute('href') || '';
        if (!text || text.length > 80 || blackList.includes(text) || text.startsWith('http')) continue;
        if (href.startsWith('http') && !href.includes('javascript')) continue;
        if (text.match(/^第\d+讲/) || text.match(/^专题/) || text.match(/^Unit\s*\d+/i) || text.match(/^第\d+章/)) {
          unit3 = text.substring(0, 60);
        } else if (text.length > 2) {
          sections.push({ unit: unit3, section: text });
        }
      }
      return sections;
    });
  } catch (e) {
    return [];
  }
}

// ============ cstore 平台：获取视频列表 ============
async function getCstoreSections(page) {
  return await page.evaluate(() => {
    const sections = [];
    // "观看视频" 按钮: <a onclick="previewActivity('1','<uuid>')" class="btnw80 majorButton fl">观看视频</a>
    const btns = Array.from(document.querySelectorAll('a')).filter(a => {
      const t = (a.textContent || '').trim();
      return t === '观看视频' && (a.getAttribute('onclick') || '').includes('previewActivity');
    });

    // 从按钮向前回溯找到所属 Unit 标题
    const allLis = Array.from(document.querySelectorAll('li'));
    btns.forEach((btn, idx) => {
      // 找到包含该按钮的 li（章节行）
      let chapterLi = btn.closest('li');
      if (!chapterLi) return;

      // 章节标题：该 li 里的文字（去掉时长/按钮部分）
      let title = (chapterLi.textContent || '').replace(/\s+/g, ' ').trim();
      title = title.replace(/有效时长\/视频时长|观看视频|\d{2}:\d{2}\/\d{2}:\d{2}/g, '').trim();

      // Unit 标题：向前找最近的 .oneChapter li
      let unit = 'Unit';
      let prev = chapterLi.previousElementSibling;
      while (prev) {
        if (prev.className && prev.className.includes('oneChapter')) {
          unit = (prev.textContent || '').trim().substring(0, 60);
          break;
        }
        prev = prev.previousElementSibling;
      }

      // 提取 uuid
      const onclick = btn.getAttribute('onclick') || '';
      const m = onclick.match(/previewActivity\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)/);
      const uuid = m ? m[2] : null;

      sections.push({
        index: idx,
        unit,
        section: title.substring(0, 80),
        uuid,
        onclick,
      });
    });
    return sections;
  });
}

// ============ cstore 平台：播放器操作 ============
async function getCstoreVideoInfo(page) {
  try {
    return await page.evaluate(() => {
      const video = document.querySelector('#video_div_video_html5_api')
        || document.querySelector('.vjs-tech')
        || document.querySelector('video');
      if (!video) return null;
      let playerState = {};
      if (window.videojs) {
        try {
          const ids = Object.keys(window.videojs.players || {});
          for (const id of ids) {
            const pl = window.videojs.players[id];
            if (pl && pl.el && pl.el().contains(video)) {
              playerState = { playerPaused: pl.paused(), playerEnded: pl.ended() };
              break;
            }
          }
        } catch {}
      }
      return {
        paused: video.paused, ended: video.ended,
        currentTime: video.currentTime, duration: video.duration || 0,
        readyState: video.readyState, ...playerState,
      };
    });
  } catch { return null; }
}

async function cstorePlayVideo(page) {
  try {
    const r = await page.evaluate(() => {
      const video = document.querySelector('#video_div_video_html5_api')
        || document.querySelector('.vjs-tech') || document.querySelector('video');
      if (!video) return { ok: false };
      // 点击大播放按钮
      const bigBtn = document.querySelector('.vjs-big-play-button');
      if (bigBtn && bigBtn.offsetWidth > 0) bigBtn.click();
      // 点击控制栏播放
      const ctrl = document.querySelector('.vjs-play-control');
      if (ctrl) ctrl.click();
      // Video.js API
      if (window.videojs) {
        try {
          const ids = Object.keys(window.videojs.players || {});
          for (const id of ids) {
            const pl = window.videojs.players[id];
            if (pl && pl.paused()) pl.play().catch(() => {});
          }
        } catch {}
      }
      if (video.paused) { const pr = video.play(); if (pr && pr.catch) pr.catch(() => {}); }
      return { ok: true, paused: video.paused, t: video.currentTime };
    });
    return r.ok;
  } catch { return false; }
}

// ============ cstore 平台：主流程 ============
async function runCstoreMode(cstorePage, timingPage) {
  let page = cstorePage;

  // 若当前在列表页，先进入第一个视频
  const isVideoPage = () => page.url().includes('/activity/video/preview');
  if (!isVideoPage()) {
    log('[cstore] 当前在课程列表页，准备进入第一个视频...');
    const sections = await getCstoreSections(page);
    log(`[cstore] 共发现 ${sections.length} 个视频:`);
    sections.slice(0, 20).forEach((s, i) => log(`  [${i + 1}] ${s.unit} - ${s.section}${s.uuid ? '' : ' (无uuid)'}`));
    if (sections.length === 0) { log('[cstore] ⚠️ 未找到视频列表'); return false; }
    if (sections.length > 20) log(`  ... 还有 ${sections.length - 20} 个`);

    // 点击第一个"观看视频"
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a')).find(a =>
        (a.textContent || '').trim() === '观看视频' && (a.getAttribute('onclick') || '').includes('previewActivity'));
      if (btn) btn.click();
    });
    log('[cstore] 已点击第一个「观看视频」');
    await sleep(6);
    // 等视频页加载
    for (let i = 0; i < 20; i++) {
      if (isVideoPage()) break;
      await sleep(2);
    }
    log(`[cstore] 当前页: ${page.url().substring(0, 110)}`);
  }

  // 等待播放器
  log('[cstore] 等待播放器加载...');
  let info = null;
  for (let i = 0; i < 30; i++) {
    info = await getCstoreVideoInfo(page);
    if (info && info.duration > 0) break;
    await sleep(2);
  }
  if (!info) { log('[cstore] ⚠️ 未找到播放器'); return false; }
  log(`[cstore] ✅ 播放器就绪，时长 ${formatTime(info.duration)}（${Math.round(info.duration/60)}分钟）`);

  // 获取章节列表（回到列表页获取？不，视频页可能有导航；这里用保存的列表）
  // 先在视频页尝试获取当前视频标题
  const currentTitle = await page.evaluate(() => {
    const el = document.querySelector('.chapterTitle, .videoTitle, h1, h2, .title');
    return el ? (el.textContent || '').trim().substring(0, 80) : '';
  });
  log(`[cstore] 当前视频: ${currentTitle || '(未识别)'}`);

  // 开始播放
  log('[cstore] 开始播放...');
  await cstorePlayVideo(page);
  await sleep(3);

  // 统计信息从计时窗口读取
  log('');
  log('[cstore] 📺 计时窗口保持打开中，进入监控...');
  log('');

  let lastTime = -1;
  let stuck = 0;
  let playCounter = 0;
  let reportedSections = 0;

  while (true) {
    await sleep(CONFIG.checkInterval);
    playCounter++;

    // 页面可能被切换（用户手动点别的），保持跟踪 cstore 视频页
    if (!isVideoPage()) {
      const vp = context_pages_find_video();
      if (vp) page = vp;
    }

    const vinfo = await getCstoreVideoInfo(page);
    if (!vinfo) {
      log('[cstore] 播放器丢失，等待...');
      await sleep(3);
      continue;
    }

    const isPaused = vinfo.playerPaused !== undefined ? vinfo.playerPaused : vinfo.paused;
    const isEnded = vinfo.playerEnded !== undefined ? vinfo.playerEnded : vinfo.ended;

    // 状态日志（每30秒）
    if (playCounter % 6 === 0) {
      log(`[cstore状态] paused=${vinfo.paused} ended=${vinfo.ended} rs=${vinfo.readyState} ${formatTime(vinfo.currentTime)}/${formatTime(vinfo.duration)}`);
    }

    // 暂停恢复 / 定期保活
    if ((isPaused || playCounter % 6 === 0) && !isEnded) {
      if (isPaused) log(`[cstore] 视频暂停 ${formatTime(vinfo.currentTime)}，恢复...`);
      await cstorePlayVideo(page);
    }

    // 卡顿检测
    if (vinfo.currentTime > 0 && vinfo.currentTime < vinfo.duration - 1) {
      if (Math.abs(vinfo.currentTime - lastTime) < 0.5) {
        stuck++;
        if (stuck > CONFIG.videoStuckTimeout / CONFIG.checkInterval) {
          log('[cstore] 视频卡住，尝试恢复...');
          await cstorePlayVideo(page);
          stuck = 0;
        }
      } else stuck = 0;
    }
    lastTime = vinfo.currentTime;

    // 进度
    if (Date.now() % 30000 < CONFIG.checkInterval * 1000) {
      const pct = ((vinfo.currentTime / vinfo.duration) * 100).toFixed(1);
      log(`[cstore进度] ${formatTime(vinfo.currentTime)}/${formatTime(vinfo.duration)} (${pct}%)`);
    }

    // 视频结束
    if (isEnded || (vinfo.duration > 0 && vinfo.currentTime >= vinfo.duration - 2)) {
      completedSections++;
      reportedSections++;
      const mins = Math.round(vinfo.duration / 60);
      totalStudyMinutes += mins;
      log('');
      log('  ═════════════════════════════════════');
      log(`  ✅ 第${completedSections}节完成！+${mins}分钟 | 累计: ${totalStudyMinutes}分钟`);
      log('  ═════════════════════════════════════');
      log('');
      await saveAuthStateAsync(context_global);
      // 回到列表页，点下一个"观看视频"
      const advanced = await cstoreNextVideo(page);
      if (!advanced) {
        log('[cstore] 🎉 所有视频已学完！');
        return true;
      }
      // 等待新视频加载
      for (let i = 0; i < 20; i++) {
        const ni = await getCstoreVideoInfo(page);
        if (ni && ni.duration > 0 && ni.currentTime < 5) break;
        await sleep(2);
      }
      await cstorePlayVideo(page);
      lastTime = -1; stuck = 0; playCounter = 0;
    }
  }
}

// 辅助：查找 cstore 视频页
function context_pages_find_video() {
  for (const p of context_global.pages()) {
    if (p.url().includes('cstore.chinaedu.net') && p.url().includes('/activity/video/preview')) return p;
  }
  return null;
}

// 辅助：跳到下一个视频（回列表页点击下一个未完成的"观看视频"）
async function cstoreNextVideo(page) {
  // 从视频页返回列表：点"返回"按钮或改 URL
  const backResult = await page.evaluate(() => {
    // 常见返回按钮
    const sels = ['.back', '.fanhui', '[class*="back"]', 'a:has-text("返回")'];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 0) { el.click(); return 'clicked:' + sel; }
    }
    return null;
  }).catch(() => null);

  if (!backResult) {
    // 用 history.back()
    await page.evaluate(() => history.back()).catch(() => {});
  }
  await sleep(4);

  // 若还在视频页，尝试改 URL 到列表页
  if (page.url().includes('/activity/video/preview')) {
    const base = page.url().split('/cstore/preview/')[0];
    // 无法确定列表 URL，尝试 back 两次
    await page.evaluate(() => history.back()).catch(() => {});
    await sleep(3);
  }
  if (!page.url().includes('index.do')) {
    await page.evaluate(() => history.back()).catch(() => {});
    await sleep(3);
  }

  // 现在应在列表页，找下一个"观看视频"（第 completedSections 个）
  const targetIdx = completedSections;  // 已完成N节，下一个是索引N
  const clicked = await page.evaluate((idx) => {
    const btns = Array.from(document.querySelectorAll('a')).filter(a =>
      (a.textContent || '').trim() === '观看视频' && (a.getAttribute('onclick') || '').includes('previewActivity'));
    if (idx >= btns.length) return { ok: false, total: btns.length };
    btns[idx].click();
    return { ok: true, total: btns.length, idx };
  }, targetIdx);

  if (!clicked.ok) {
    if (targetIdx >= clicked.total) {
      log(`[cstore] 已到最后一个视频（共${clicked.total}个）`);
    } else {
      log(`[cstore] ⚠️ 未找到第${targetIdx + 1}个视频`);
    }
    return false;
  }
  log(`[cstore] ▶️ 进入第${targetIdx + 1}/${clicked.total}个视频`);
  await sleep(5);
  return true;
}

// ============ 诊断：打印页面链接结构 ============
async function diagnoseSections(playFrame) {
  if (!playFrame) return;
  try {
    const info = await playFrame.evaluate(() => {
      // 获取所有可见链接
      const links = Array.from(document.querySelectorAll('a')).map(a => ({
        href: a.getAttribute('href') || '',
        text: a.textContent.trim().substring(0, 60),
        cls: a.className.substring(0, 40),
        visible: a.offsetWidth > 0,
      })).filter(l => l.text.length > 0 && l.visible);

      // 获取列表元素
      const listEls = Array.from(document.querySelectorAll(
        'ul li, ol li, [class*="chapter"] *, [class*="section"] *, [class*="catalog"] *, [class*="nav"] *'
      )).slice(0, 30).map(el => ({
        tag: el.tagName,
        text: el.textContent.trim().substring(0, 60),
        cls: el.className.substring(0, 40),
      })).filter(e => e.text.length > 0);

      return { links: links.slice(0, 30), listEls: listEls.slice(0, 20) };
    });

    log('[诊断] ====== playFrame 页面结构 ======');
    log(`[诊断] 可见链接 (${info.links.length}):`);
    info.links.forEach((l, i) => {
      log(`  [${i}] href="${l.href.substring(0, 50)}" class="${l.cls}" text="${l.text}"`);
    });
    log(`[诊断] 列表元素 (${info.listEls.length}):`);
    info.listEls.forEach((e, i) => {
      log(`  [${i}] <${e.tag}> class="${e.cls}" text="${e.text}"`);
    });
    log('[诊断] ============================');
  } catch (e) {
    log(`[诊断] 异常: ${e.message}`);
  }
}

// ============ 点击下一个章节 ============
async function clickNextSection(playFrame) {
  if (!playFrame) return false;
  currentSectionIdx++;
  if (currentSectionIdx >= sectionList.length) {
    log('[导航] 已到达最后一节');
    return false;
  }

  const target = sectionList[currentSectionIdx];
  log(`[导航] 切换到第 ${currentSectionIdx + 1}/${sectionList.length} 节: ${target.section} (${target.unit})`);

  try {
    const linkInfo = await playFrame.evaluate((tgt) => {
      // 判断文字是否是 unit 标题
      function isUnitTitle(text) {
        return text.match(/^第\d+讲/) || text.match(/^专题[一二三四五六七八九十\d]+/) ||
               text.match(/^(Unit|unit|UNIT)\s*\d+/i) || text.match(/^第\d+章/) || text.match(/^第\d+单元/);
      }

      const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
      let unitIdx = -1, sectionIdx = -1;
      let inTargetUnit = false;
      for (let i = 0; i < allLinks.length; i++) {
        const text = allLinks[i].textContent.trim();
        if (text === tgt.unit) { unitIdx = i; inTargetUnit = true; }
        else if (isUnitTitle(text)) { inTargetUnit = false; }
        else if (inTargetUnit && text === tgt.section) { sectionIdx = i; break; }
      }
      return { unitIdx, sectionIdx, found: sectionIdx >= 0 };
    }, target);

    if (!linkInfo.found) {
      log(`[导航] ⚠️ 未找到章节链接，尝试重新加载章节列表`);
      // 重新获取章节列表再试一次
      const newSections = await getAllSections(playFrame);
      if (newSections.length > sectionList.length) {
        sectionList = newSections;
        log(`[导航] 重新加载到 ${sectionList.length} 个章节`);
      }
      return false;
    }

    // Step 1: 展开 Unit
    if (linkInfo.unitIdx >= 0) {
      try {
        await playFrame.locator('a[href="javascript:;"]').nth(linkInfo.unitIdx).click({ timeout: 3000 });
      } catch {}
      await sleep(1);
      const updatedIdx = await playFrame.evaluate((tgt) => {
        const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
        for (let i = 0; i < allLinks.length; i++) {
          if (allLinks[i].textContent.trim() === tgt.section) return i;
        }
        return -1;
      }, target);
      if (updatedIdx >= 0) linkInfo.sectionIdx = updatedIdx;
    }

    // Step 2: 点击章节
    try {
      await playFrame.locator('a[href="javascript:;"]').nth(linkInfo.sectionIdx).click({ timeout: 5000 });
      log(`[导航] 已点击: ${target.section}`);
      return true;
    } catch {
      await playFrame.evaluate((idx) => {
        const links = document.querySelectorAll('a[href="javascript:;"]');
        if (links[idx]) links[idx].click();
      }, linkInfo.sectionIdx);
      log(`[导航] 已点击(evaluate): ${target.section}`);
      return true;
    }
  } catch (e) {
    log(`[导航] ❌ 异常: ${e.message}`);
    return false;
  }
}

// ============ 防挂机 ============
async function simulateActivity(page) {
  try {
    const videoFrame = getVideoFrame(page);
    if (videoFrame) {
      await videoFrame.evaluate(() => {
        const video = document.querySelector('#videoFrame_video');
        if (video) {
          const rect = video.getBoundingClientRect();
          video.dispatchEvent(new MouseEvent('mousemove', {
            clientX: rect.left + Math.random() * rect.width,
            clientY: rect.top + Math.random() * rect.height,
            bubbles: true
          }));
        }
      });
    }
  } catch {}
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ============ 主函数 ============
async function main() {
  const logDir = path.dirname(CONFIG.logFile);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(CONFIG.logFile, { flags: 'a' });

  log('');
  log('╔══════════════════════════════════════════╗');
  log('║  浙江理工·弘成教育 - 自动刷课 v2.0.3    ║');
  log('║  必须从 zstu 平台入口进入，才能计学时     ║');
  log('╚══════════════════════════════════════════╝');
  log('');

  loadLearned();

  // 启动浏览器
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    channel: 'chrome',
    args: [
      '--no-first-run', '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  // 加载登录状态
  let savedState = null;
  if (fs.existsSync(CONFIG.authStateFile)) {
    try {
      savedState = JSON.parse(fs.readFileSync(CONFIG.authStateFile, 'utf8'));
      log('[登录] 已加载登录状态');
    } catch {
      log('[登录] 登录状态文件损坏');
    }
  }

  const context = await browser.newContext({
    storageState: savedState || undefined,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  context_global = context;  // 供 cstore 模式使用

  // 信号处理
  process.on('SIGINT', async () => {
    log('\n[SIGINT] 正在保存状态并退出...');
    await saveAuthState(context);
    await browser.close();
    if (logStream) logStream.end();
    process.exit(0);
  });

  let page = await context.newPage();

  // ============ Step 1: 打开主平台 ============
  log('[1/5] 打开 zstu 主平台...');
  try {
    await page.goto(CONFIG.platformUrl, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    log(`[1/5] 页面加载超时: ${e.message}`);
  }
  await sleep(3);

  // 检查是否需要登录（密码框存在 或 登录态失效）
  let needLogin = await page.evaluate(() => {
    return document.querySelectorAll('input[type="password"]').length > 0;
  });

  // 即使没有密码框，也校验登录态是否有效
  if (!needLogin) {
    const sessionValid = await page.evaluate(async () => {
      try {
        const res = await fetch('/student/student/coursestudy/getlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'aggregation' }),
        });
        const text = await res.text();
        if (text.includes('RedirectToLogin')) return false;
        const json = JSON.parse(text);
        return !!(json && (json.items || json.data));
      } catch {
        return false;
      }
    });
    if (!sessionValid) {
      log('[登录] ⚠️ 登录状态已失效，需要重新登录');
      needLogin = true;
      // 跳转到登录页
      try {
        await page.goto('https://cjstudy.zstu.edu.cn/student/', { waitUntil: 'networkidle', timeout: 30000 });
      } catch {}
      await sleep(3);
    }
  }

  if (needLogin) {
    const loggedIn = await doLogin(page);
    if (!loggedIn) {
      log('[1/5] ⚠️ 请手动在浏览器中登录');
      log('[1/5] 登录后按 Ctrl+C 退出并重新运行脚本');
      await new Promise(() => {});
    }
  }

  await saveAuthState(context);
  log('[1/5] ✅ 已登录');

  // ============ Step 2: 获取课程列表 ============
  log('[2/5] 获取课程列表...');
  await sleep(2);

  // 尝试点击"课程"或"学习"导航项
  try {
    const navItems = await page.locator('a[href*="Course"], a[href*="Study"], a:has-text("课程"), a:has-text("学习"), .el-menu-item:has-text("课程"), .el-menu-item:has-text("学习")').all();
    for (const item of navItems) {
      const text = await item.textContent();
      if (text && (text.includes('课程') || text.includes('学习') || text.includes('Study') || text.includes('MyCourse'))) {
        await item.click();
        log(`[2/5] 已点击导航: ${text.trim()}`);
        break;
      }
    }
  } catch (e) {
    log(`[2/5] 导航点击异常: ${e.message}`);
  }

  await sleep(3);

  // 如果还在首页，尝试直接跳转到课程列表页面
  const currentUrl = page.url();
  if (!currentUrl.includes('MyCourse') && !currentUrl.includes('Course')) {
    log('[2/5] 尝试直接导航到课程列表...');
    try {
      await page.goto('https://cjstudy.zstu.edu.cn/student/#/MyCourse', { waitUntil: 'networkidle', timeout: 20000 });
    } catch {}
    await sleep(3);
  }

  // ============ Step 3: 选择课程 ============
  log('[3/5] 查找课程...');
  await sleep(2);

  // 尝试从命令行参数获取课程，或者自动选择第一个课程
  const targetCourseName = process.argv[2];
  let courseClicked = false;

  // 策略1: 通过 API 获取课程列表（带重试 + 登录态校验）
  try {
    let response = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const raw = await page.evaluate(async () => {
        try {
          const res = await fetch('/student/student/coursestudy/getlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'aggregation' }),
            credentials: 'include',
          });
          return await res.text();
        } catch (e) {
          return '__FETCH_ERROR__:' + e.message;
        }
      });

      if (raw.includes('RedirectToLogin')) {
        log(`[3/5] 第${attempt}次获取失败：登录态失效（RedirectToLogin）`);
        if (attempt < 3) {
          log('[3/5] 等待登录态生效后重试...');
          await sleep(5);
        }
        continue;
      }
      if (raw.startsWith('__FETCH_ERROR__')) {
        log(`[3/5] 第${attempt}次请求异常: ${raw.replace('__FETCH_ERROR__:', '')}`);
        await sleep(3);
        continue;
      }
      try {
        response = JSON.parse(raw);
        break;
      } catch {
        log(`[3/5] 第${attempt}次返回非JSON: ${raw.substring(0, 80)}`);
        await sleep(3);
      }
    }

    if (!response) {
      throw new Error('课程列表 API 三次重试均失败（登录态可能失效）');
    }

    if (response && response.items && response.items.length > 0) {
      log(`[3/5] 共 ${response.items.length} 门课程:`);
      response.items.forEach((c, i) => {
        const name = c.courseName || c.bussinessCaseName || '未知课程';
        log(`  [${i + 1}] ${name}`);
      });

      // 选择课程
      let selectedCourse = null;
      if (targetCourseName) {
        const target = targetCourseName.toLowerCase().replace(/\s+/g, '');
        const getName = (c) => (c.courseName || c.bussinessCaseName || '').replace(/\s+/g, '');
        // 优先级1：完全相等
        selectedCourse = response.items.find(c => getName(c).toLowerCase() === target);
        // 优先级2：卡片名称包含关键词（关键词是完整课程名的一部分）
        if (!selectedCourse) {
          selectedCourse = response.items.find(c => getName(c).toLowerCase().includes(target));
        }
        // 优先级3：关键词包含课程名（如传"大学英语"匹配"大学英语2"时取第一个）
        if (!selectedCourse) {
          selectedCourse = response.items.find(c => target.includes(getName(c).toLowerCase()) && getName(c).length > 2);
        }
      }
      if (!selectedCourse) {
        // 默认选择第一个未完成的
        selectedCourse = response.items.find(c => {
          const name = c.courseName || c.bussinessCaseName || '';
          return !learnedSections.has(name);
        }) || response.items[0];
      }

      const courseName = selectedCourse.courseName || selectedCourse.bussinessCaseName;
      log(`[3/5] 选中课程: ${courseName}`);

      // 在页面上找到该课程的 .videolearning-bt 按钮并点击
      // 页面结构: <div class="coursePic"><a class="videolearning-bt" title="课程学习"><img ...></a></div>
      await sleep(2);
      try {
        const pagesBefore = context.pages().length;

        // 先找到包含课程名的卡片，然后在其中点击 .videolearning-bt
        const allBts = await page.locator('.videolearning-bt').all();
        log(`[3/5] 找到 ${allBts.length} 个课程学习按钮`);

        if (targetCourseName && allBts.length > 0) {
          // 有关键词：找匹配课程名的按钮
          // 优先级：完全包含 > 去掉空格包含 > 逐字包含
          const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase();
          const targetNorm = norm(targetCourseName);
          let bestIdx = -1;
          const cardTexts = [];
          for (let i = 0; i < allBts.length; i++) {
            const bt = allBts[i];
            const cardText = await bt.evaluate(el => {
              const card = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
              return card ? card.textContent.trim().replace(/\s+/g, ' ').substring(0, 150) : '';
            });
            cardTexts.push(cardText);
            if (bestIdx === -1 && norm(cardText).includes(targetNorm)) bestIdx = i;
          }
          log(`[3/5] 课程卡片: ${cardTexts.map((t, i) => `#${i + 1}="${t.substring(0, 25)}"`).join(' | ')}`);
          if (bestIdx >= 0) {
            await allBts[bestIdx].click();
            log(`[3/5] 已点击课程: ${courseName} (匹配 "${targetCourseName}" 于卡片#${bestIdx + 1})`);
            courseClicked = true;
          } else {
            log(`[3/5] ⚠️ 没有卡片匹配 "${targetCourseName}"，将使用 API 选中的课程`);
          }
        }

        // 没匹配到或没有关键词：点击第一个未学过的 .videolearning-bt
        if (!courseClicked && allBts.length > 0) {
          for (let i = 0; i < allBts.length; i++) {
            const bt = allBts[i];
            const cardText = await bt.evaluate(el => {
              const card = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
              return card ? card.textContent.trim().substring(0, 100) : '';
            });
            // 检查是否已学过
            const isLearned = learnedSections.has(cardText) || (courseName && cardText.includes(courseName) && learnedSections.has(courseName));
            if (!isLearned || i === allBts.length - 1) {
              await bt.click();
              log(`[3/5] 已点击课程学习按钮 #${i + 1} (卡片: ${cardText.substring(0, 40)})`);
              courseClicked = true;
              break;
            }
          }
        }

        if (courseClicked) {
          await sleep(5);

          // 检查是否弹出了新标签页
          const allPages = context.pages();
          if (allPages.length > pagesBefore) {
            for (const p of allPages) {
              if (p.url().includes('videolearning')) {
                page = p;
                log(`[3/5] ✅ 已切换到计时窗口`);
                break;
              }
            }
          } else if (page.url().includes('videolearning')) {
            log(`[3/5] ✅ 当前页已跳转到计时窗口`);
          }
        }
      } catch (e) {
        log(`[3/5] 点击课程失败: ${e.message}`);
      }

      // 如果点击失败，fallback
      if (!courseClicked) {
        const courseVersionId = selectedCourse.courseVersionID;
        const teachplanCourseVersionId = selectedCourse.teachplanCourseVersionId || selectedCourse.id;
        if (courseVersionId) {
          log(`[3/5] ⚠️ 按钮点击失败，尝试直接构建URL（可能缺少sign参数）`);
          const studyUrl = `https://cjstudy.zstu.edu.cn/student/videolearning.html#Subpage/StudentVersionVideo?courseVersionId=${courseVersionId}&teachplanCourseVersionId=${teachplanCourseVersionId}`;
          await page.goto(studyUrl, { waitUntil: 'networkidle', timeout: 30000 });
          courseClicked = true;
        }
      }
    }
  } catch (e) {
    log(`[3/5] API获取课程失败: ${e.message}`);
  }

  // 策略2: 如果API失败，尝试DOM点击
  if (!courseClicked) {
    log('[3/5] 尝试从页面点击课程...');
    try {
      const courseLinks = await page.locator('a, .course-item, .course-card, [class*="course"]').all();
      for (const link of courseLinks) {
        const href = await link.getAttribute('href') || '';
        if (href.includes('videolearning') || href.includes('courseVersionId')) {
          await link.click();
          log('[3/5] 已点击课程链接');
          courseClicked = true;
          break;
        }
      }
    } catch (e) {
      log(`[3/5] 点击课程失败: ${e.message}`);
    }
  }

  if (!courseClicked) {
    log('');
    log('  ╔══════════════════════════════════════════════════════╗');
    log('  ║  ⚠️  无法自动进入课程，需要手动操作                   ║');
    log('  ║                                                      ║');
    log('  ║  【如果浏览器停在登录页】                             ║');
    log('  ║    手动输入账号密码 + 验证码，点登录                  ║');
    log('  ║  【如果已登录】                                       ║');
    log('  ║    点击「大学英语2」课程 → 点「课程学习」按钮         ║');
    log('  ║                                                      ║');
    log('  ║  完成后回到终端按 Enter 继续脚本                      ║');
    log('  ╚══════════════════════════════════════════════════════╝');
    log('');

    // 等待用户按 Enter（60秒后自动继续，容错）
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      process.stdin.once('data', finish);
      setTimeout(finish, 300000); // 最多等5分钟
    });

    // 用户按 Enter 后，重新检测当前页面是否已进入计时窗口/视频页
    await sleep(2);
    const allPagesNow = context.pages();
    for (const p of allPagesNow) {
      if (p.url().includes('videolearning')) {
        page = p;
        log('[3/5] ✅ 检测到计时窗口，继续');
        break;
      }
    }
  }

  await sleep(5);

  // ============ Step 4: 等待 iframe 加载 ============
  log('[4/5] 等待视频播放器加载...');

  // 处理 videolearning.html 页面的"确定"弹框
  // 弹框结构: <div class="tip-win"><span class="openNewPage">确定</span></div>
  // 点击"确定"会弹出新标签页 → chinaedu.net 视频播放页
  // ⚠️ videolearning.html 是计时窗口，必须保持打开！
  const timingPage = page;  // 保存计时窗口引用
  log('[4/5] 检查确认弹框...');
  const pagesBeforeConfirm = context.pages().length;

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const clicked = await page.evaluate(() => {
        const span = document.querySelector('.openNewPage');
        if (span && span.offsetWidth > 0) {
          span.click();
          return { clicked: true, by: 'openNewPage' };
        }
        const tipWin = document.querySelector('.tip-win');
        if (tipWin && tipWin.offsetWidth > 0) {
          const anyClickable = tipWin.querySelector('span, a, button');
          if (anyClickable) { anyClickable.click(); return { clicked: true, by: 'tip-win' }; }
        }
        return { clicked: false };
      });

      if (clicked.clicked) {
        log(`[4/5] ✅ 已点击"确定"(${clicked.by})，进入在线看课`);
        break;
      }

      // 首次和最后一次尝试时输出诊断
      if (attempt === 0 || attempt === 9) {
        const diag = await page.evaluate(() => {
          const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').substring(0, 300);
          const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
            src: (f.src || '').substring(0, 100),
            id: f.id,
            cls: f.className,
          }));
          const candidates = Array.from(document.querySelectorAll('[class*="tip"], [class*="win"], [class*="confirm"], [class*="dialog"], button, .btn'))
            .slice(0, 20)
            .map(el => ({
              tag: el.tagName,
              cls: (el.className || '').toString().substring(0, 50),
              text: (el.textContent || '').trim().substring(0, 40),
              visible: el.offsetWidth > 0,
            }))
            .filter(e => e.text || e.cls);
          return { url: location.href.substring(0, 150), bodyText, iframes, candidates };
        });
        log(`[4/5] 🔍 诊断 (尝试${attempt + 1}/10):`);
        log(`  URL: ${diag.url}`);
        log(`  页面文字: ${diag.bodyText}`);
        log(`  iframe数量: ${diag.iframes.length}`);
        diag.iframes.forEach((f, i) => log(`    iframe[${i}] src="${f.src}" id="${f.id}" cls="${f.cls}"`));
        log(`  候选点击元素: ${diag.candidates.length}`);
        diag.candidates.forEach((c, i) => log(`    [${i}] <${c.tag}> cls="${c.cls}" text="${c.text}" visible=${c.visible}`));
      }

      if (attempt < 9) await sleep(2);
    } catch (e) {
      if (attempt === 0) log(`[4/5] 弹框检测异常: ${e.message}`);
    }
  }

  await sleep(5);

  // 点击确定后，检查是否弹出了新标签页（chinaedu.net 视频播放页）
  const allPagesAfter = context.pages();
  let videoPage = null;
  if (allPagesAfter.length > pagesBeforeConfirm) {
    for (const p of allPagesAfter) {
      if (p.url().includes('chinaedu.net') || p.url().includes('courseWare')) {
        videoPage = p;
        log(`[4/5] ✅ 视频页面已在新标签页打开`);
        break;
      }
    }
  }

  // 如果没有新标签页，可能在 videolearning.html 内嵌了 iframe
  if (!videoPage) {
    log('[4/5] 未检测到新标签页，在当前页查找 iframe...');
    videoPage = page;
  }

  // 保存计时窗口引用（后续操作中不要关闭它）
  log(`[4/5] 📺 计时窗口: ${timingPage.url().substring(0, 60)}... (保持打开)`);

  // ========== 优先检测 cstore 平台（大学英语2 等新课程）==========
  // cstore.chinaedu.net 是单页应用，没有 iframe，用 video.js 播放器
  const cstorePageEarly = context.pages().find(p => p.url().includes('cstore.chinaedu.net'));
  if (cstorePageEarly) {
    log('');
    log('[平台] 🔍 检测到 cstore 平台（新课程类型），切换到 cstore 模式');
    log(`[平台] ${cstorePageEarly.url().substring(0, 110)}`);
    const result = await runCstoreMode(cstorePageEarly, timingPage);
    if (!result) {
      log('[平台] ⚠️ cstore 模式运行结束');
    }
    await saveAuthState(context);
    await browser.close();
    if (logStream) logStream.end();
    return;
  }

  let videoFrame = null;
  let playFrame = null;
  let retries = 0;
  let lastDiagRetry = -1;

  while (retries < 30) {
    videoFrame = findFrame(videoPage, 'video.html');
    playFrame = findFrame(videoPage, 'play.html');
    if (videoFrame && playFrame) break;

    // 也检查 videolearning.html 的 iframe（可能没弹新标签页而是内嵌）
    if (!videoFrame && !playFrame && videoPage !== timingPage) {
      videoFrame = findFrame(timingPage, 'video.html');
      playFrame = findFrame(timingPage, 'play.html');
      if (videoFrame && playFrame) {
        videoPage = timingPage;
        break;
      }
    }

    // 诊断：每 10 次输出所有页面的 frame 清单
    if (retries % 10 === 0 && retries !== lastDiagRetry) {
      lastDiagRetry = retries;
      log(`[4/5] 🔍 Frame 诊断 (第${retries}次):`);
      const allPages = context.pages();
      log(`  标签页总数: ${allPages.length}`);
      allPages.forEach((p, pi) => {
        log(`  --- 页面[${pi}]: ${p.url().substring(0, 120)}`);
        const frames = p.frames();
        frames.forEach((f, fi) => {
          log(`      frame[${fi}] url="${(f.url() || '').substring(0, 130)}"`);
        });
      });
    }

    await sleep(3);
    retries++;
    if (retries % 5 === 0) {
      log(`[4/5] 还在等待视频播放器... (${retries}/30)`);
    }
  }

  // 兜底：如果按 video.html/play.html 找不到，尝试宽松匹配
  if (!videoFrame && videoPage) {
    log('[4/5] 尝试宽松匹配 frame...');
    const allFrames = [];
    for (const p of context.pages()) {
      for (const f of p.frames()) allFrames.push({ page: p, frame: f, url: f.url() || '' });
    }
    // 找含 video/player/play 的 frame
    const videoLike = allFrames.find(x => /video|player|m3u8|\.mp4/i.test(x.url));
    const playLike = allFrames.find(x => /play|nav/i.test(x.url) && x !== videoLike);
    if (videoLike) {
      videoFrame = videoLike.frame;
      videoPage = videoLike.page;
      playFrame = playLike ? playLike.frame : videoLike.frame;
      log(`[4/5] ✅ 宽松匹配到视频frame: ${videoLike.url.substring(0, 100)}`);
    }
  }

  if (!videoFrame) {
    log('[4/5] ⚠️ 未找到视频播放器');
    log('[4/5] 请确认已进入正确的课程视频页面');
    await saveAuthState(context);
    await new Promise(() => {});
  }

  log('[4/5] ✅ 视频播放器已就绪');

  // 获取章节列表
  const sections = await getAllSections(playFrame);
  sectionList = sections;
  currentSectionIdx = 0;
  if (sections.length > 0) {
    log(`[课程] 共 ${sections.length} 个章节:`);
    sections.slice(0, 15).forEach((s, i) => {
      log(`  [${i + 1}] ${s.unit} - ${s.section.substring(0, 50)}`);
    });
    if (sections.length > 15) log(`  ... 还有 ${sections.length - 15} 个`);
  } else {
    log('[课程] ⚠️ 未识别章节列表，开始诊断...');
    await diagnoseSections(playFrame);
    log('[课程] 将以单节模式运行，视频播完后等待手动切换');
  }

  // ============ Step 5: 开始播放 ============
  log('[5/5] 开始播放...');
  await playVideo(videoFrame);
  await sleep(3);
  await saveAuthState(context);

  // ============ 主循环 ============
  log('[监控] 进入自动监控模式...');
  log('[监控] 📺 计时窗口保持打开中...');
  log('');

  let activityTimer = 0;
  let popupCheckTimer = 0;
  let playAttemptCounter = 0;

  while (true) {
    await sleep(CONFIG.checkInterval);
    activityTimer += CONFIG.checkInterval;
    popupCheckTimer += CONFIG.checkInterval;

    // 检查弹框（在视频页面上）
    if (popupCheckTimer >= CONFIG.popupCheckInterval) {
      popupCheckTimer = 0;
      await checkAndClosePopup(playFrame, videoPage);
    }

    // 防挂机（在视频页面上）
    if (activityTimer >= CONFIG.activityInterval) {
      activityTimer = 0;
      await simulateActivity(videoPage);
    }

    // 检查视频状态
    const videoInfo = await getVideoInfo(videoFrame);
    if (!videoInfo) {
      videoFrame = findFrame(videoPage, 'video.html');
      playFrame = findFrame(videoPage, 'play.html');
      continue;
    }

    // 打印详细状态（每30秒）
    playAttemptCounter++;
    if (playAttemptCounter % 6 === 0) {
      log(`[状态] paused=${videoInfo.paused} ended=${videoInfo.ended} readyState=${videoInfo.readyState} time=${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)}`);
      if (videoInfo.playerPaused !== undefined) {
        log(`[状态] Video.js player: paused=${videoInfo.playerPaused} ended=${videoInfo.playerEnded}`);
      }
    }

    // 暂停恢复（检测暂停 OR 每30秒强制尝试一次）
    // 优先使用 Video.js 播放器状态
    const isPaused = videoInfo.playerPaused !== undefined ? videoInfo.playerPaused : videoInfo.paused;
    const isEnded = videoInfo.playerEnded !== undefined ? videoInfo.playerEnded : videoInfo.ended;
    const shouldResume = isPaused || (playAttemptCounter % 6 === 0 && videoInfo.currentTime > 0 && videoInfo.currentTime < videoInfo.duration - 1);
    if (shouldResume && !isEnded) {
      if (isPaused) {
        log(`[播放] 视频已暂停 (${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)})，恢复...`);
      } else if (playAttemptCounter % 6 === 0) {
        log(`[播放] 定期保活 (${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)})`);
      }
      await playVideo(videoFrame);
      await sleep(1);
      
      // 额外尝试：直接用 Video.js API 播放
      try {
        await videoFrame.evaluate(() => {
          if (window.videojs) {
            const player = window.videojs.players?.videoFrame_video;
            if (player && player.paused()) {
              player.play().catch(() => {});
            }
          }
        });
      } catch {}
      await sleep(1);
    }

    // 卡顿检测（不依赖 paused 状态，直接检测 currentTime 是否增加）
    if (videoInfo.currentTime > 0 && videoInfo.currentTime < videoInfo.duration - 1) {
      if (Math.abs(videoInfo.currentTime - lastVideoTime) < 0.5) {
        stuckCounter++;
        if (stuckCounter > CONFIG.videoStuckTimeout / CONFIG.checkInterval) {
          log(`[播放] 视频卡住 (${formatTime(videoInfo.currentTime)} 不再增加)，尝试恢复...`);
          await playVideo(videoFrame);
          // 尝试重新加载视频
          try {
            await videoFrame.evaluate(() => {
              const video = document.querySelector('#videoFrame_video_html5_api');
              if (video) {
                video.load();
                video.play().catch(() => {});
              }
            });
          } catch {}
          stuckCounter = 0;
        }
      } else {
        stuckCounter = 0;
      }
    }
    lastVideoTime = videoInfo.currentTime;

    // 视频结束（优先使用 Video.js 状态）
    if (isEnded || (videoInfo.duration > 0 && videoInfo.currentTime >= videoInfo.duration - 1)) {
      completedSections++;
      const sectionName = (currentSectionIdx < sectionList.length)
        ? `${sectionList[currentSectionIdx].unit} - ${sectionList[currentSectionIdx].section}`
        : `Section-${completedSections}`;
      const minutes = Math.round(videoInfo.duration / 60);
      totalStudyMinutes += minutes;

      saveLearned(sectionName);

      log('');
      log('  ═════════════════════════════════════');
      log(`  ✅ 第${completedSections}节完成！+${minutes}分钟 | 累计: ${totalStudyMinutes}分钟`);
      log(`  📖 ${sectionName}`);
      log('  ═════════════════════════════════════');
      log('');

      // 切换下一节
      const hasNext = await clickNextSection(playFrame);
      if (!hasNext) {
        log('[完成] 🎉 所有章节已学完！');
        break;
      }

      await sleep(5);
      videoFrame = findFrame(videoPage, 'video.html');
      playFrame = findFrame(videoPage, 'play.html');

      if (videoFrame) {
        await playVideo(videoFrame);
        lastVideoTime = -1;
        stuckCounter = 0;
      }

      await saveAuthState(context);
    }

    // 进度打印
    if (videoInfo.duration > 0 && Date.now() % 30000 < CONFIG.checkInterval * 1000) {
      const progress = ((videoInfo.currentTime / videoInfo.duration) * 100).toFixed(1);
      const currentMin = Math.floor(videoInfo.currentTime / 60);
      const totalMin = Math.floor(videoInfo.duration / 60);
      const studyMin = totalStudyMinutes + currentMin;
      log(`[进度] ${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)} (${progress}%) | 已完成${completedSections}节 | 本节${currentMin}/${totalMin}分钟 | 累计约${studyMin}分钟`);
    }
  }

  log('');
  log('🎉🎉🎉 学习完成！🎉🎉🎉');
  log(`  总计: ${completedSections} 节 | ${totalStudyMinutes} 分钟`);

  await saveAuthState(context);
  await browser.close();
  if (logStream) logStream.end();
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
