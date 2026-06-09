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
      log('  ╔══════════════════════════════════════════════╗');
      log('  ║  ⚠️  检测到验证码！请手动完成登录：          ║');
      log('  ║  1. 在浏览器中输入验证码                     ║');
      log('  ║  2. 点击登录按钮                             ║');
      log('  ║  3. 脚本会自动检测登录成功并继续              ║');
      log('  ╚══════════════════════════════════════════════╝');
      log('');

      // 等待用户手动登录，最多等5分钟
      for (let i = 0; i < 60; i++) {
        await sleep(5);
        const currentUrl = page.url();
        if (!currentUrl.includes('/login') && !currentUrl.includes('Login')) {
          log('[登录] ✅ 登录成功！');
          return true;
        }
        // 也检测页面内容变化（SPA可能不跳转URL）
        const stillLogin = await page.evaluate(() => {
          return document.querySelectorAll('input[type="password"]').length > 0;
        });
        if (!stillLogin) {
          log('[登录] ✅ 登录成功！（检测到密码框消失）');
          return true;
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
      const links = document.querySelectorAll('a[href="javascript:;"]');
      let currentUnit = '';
      for (const link of links) {
        const text = link.textContent.trim();
        if (!text || text === '首页' || text === '课程讲解' || text === '展开' || text === '更多' || text === '目录' || text === '视频' || text === '语音') continue;
        if (text.startsWith('Unit ')) {
          currentUnit = text;
        } else if (currentUnit && !text.startsWith('Unit')) {
          sections.push({ unit: currentUnit, section: text });
        }
      }
      return sections;
    });
  } catch { return []; }
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
      const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
      let unitIdx = -1, sectionIdx = -1;
      let inTargetUnit = false;
      for (let i = 0; i < allLinks.length; i++) {
        const text = allLinks[i].textContent.trim();
        if (text === tgt.unit) { unitIdx = i; inTargetUnit = true; }
        else if (text.startsWith('Unit ')) { inTargetUnit = false; }
        else if (inTargetUnit && text === tgt.section) { sectionIdx = i; break; }
      }
      return { unitIdx, sectionIdx, found: sectionIdx >= 0 };
    }, target);

    if (!linkInfo.found) {
      log(`[导航] ⚠️ 未找到章节链接`);
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

  // 检查是否需要登录
  const needLogin = await page.evaluate(() => {
    return document.querySelectorAll('input[type="password"]').length > 0;
  });

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

  // 策略1: 通过 API 获取课程列表
  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('/student/student/coursestudy/getlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'aggregation' }),
      });
      return res.json();
    });

    if (response && response.items && response.items.length > 0) {
      log(`[3/5] 共 ${response.items.length} 门课程:`);
      response.items.forEach((c, i) => {
        const name = c.courseName || c.bussinessCaseName || '未知课程';
        log(`  [${i + 1}] ${name}`);
      });

      // 选择课程
      let selectedCourse = null;
      if (targetCourseName) {
        selectedCourse = response.items.find(c => {
          const name = (c.courseName || c.bussinessCaseName || '').toLowerCase();
          return name.includes(targetCourseName.toLowerCase());
        });
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
          for (let i = 0; i < allBts.length; i++) {
            const bt = allBts[i];
            // 找到按钮所在的课程卡片，获取课程名
            const cardText = await bt.evaluate(el => {
              // 向上找课程卡片容器
              const card = el.closest('[class*="course"]') || el.parentElement?.parentElement?.parentElement;
              return card ? card.textContent.trim().substring(0, 100) : '';
            });
            if (cardText.includes(targetCourseName)) {
              await bt.click();
              log(`[3/5] 已点击课程: ${courseName} (匹配关键词)`);
              courseClicked = true;
              break;
            }
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
    log('[3/5] ⚠️ 无法自动进入课程');
    log('[3/5] 请手动在浏览器中点击课程进入');
    log('[3/5] 进入视频播放页后，按 Enter 继续脚本...');
    // 等待用户按 Enter
    process.stdin.once('data', () => {});
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
          return true;
        }
        const tipWin = document.querySelector('.tip-win');
        if (tipWin && tipWin.offsetWidth > 0) {
          const anyClickable = tipWin.querySelector('span, a, button');
          if (anyClickable) { anyClickable.click(); return true; }
        }
        return false;
      });

      if (clicked) {
        log('[4/5] ✅ 已点击"确定"，进入在线看课');
        break;
      }

      if (attempt < 9) await sleep(2);
    } catch {}
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

  let videoFrame = null;
  let playFrame = null;
  let retries = 0;

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

    await sleep(3);
    retries++;
    if (retries % 5 === 0) {
      log(`[4/5] 还在等待视频播放器... (${retries}/30)`);
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
    sections.slice(0, 10).forEach((s, i) => {
      log(`  [${i + 1}] ${s.unit} - ${s.section.substring(0, 50)}`);
    });
    if (sections.length > 10) log(`  ... 还有 ${sections.length - 10} 个`);
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
