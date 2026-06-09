/**
 * 弘成教育(chinaedu.net) - 自动刷课脚本 v1.1
 * 
 * 功能：
 *   1. ✅ 自动播放视频（video.js 播放器）
 *   2. ✅ 自动处理"在线确认"弹框（#overlay + #ol-close）
 *   3. ✅ 视频播完自动切换下一节（索引跟踪 + Playwright原生点击）
 *   4. ✅ 防挂机：定时模拟鼠标移动
 *   5. ✅ 去重：已学课程记录，不重复刷
 *   6. ✅ 登录持久化：storageState 保存 Cookie
 * 
 * 平台页面结构（3层 iframe）：
 *   Frame 0: 主页面 courseWare.do — 笔记区域、Bootstrap 弹框
 *   Frame 1: 课程内容 play.html — 章节导航、#overlay 在线确认弹框
 *   Frame 2: 视频播放器 video.html — video.js 播放器（#videoFrame_video_html5_api）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const CONFIG = {
  // 课程URL（从平台获取，含所有认证参数）
  courseUrl: '',
  
  // 如果没有具体课程URL，可以设置平台首页（需手动登录后获取课程）
  platformHome: 'https://fjshare.chinaedu.net',
  
  // 检查间隔（秒）
  checkInterval: 5,
  
  // 在线确认弹框检查间隔（秒）
  popupCheckInterval: 3,
  
  // 视频卡住超时（秒）- 进度不变超过此时间认为卡住
  videoStuckTimeout: 120,
  
  // 是否显示浏览器界面
  headless: false,
  
  // 防挂机：模拟鼠标移动间隔（秒）
  activityInterval: 20,
  
  // 登录状态保存路径
  authStateFile: path.join(process.env.HOME, 'chinaedu-study', 'auth-state.json'),
  
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
let sectionList = [];          // 章节列表（含 unit 和 section 名）
let currentSectionIdx = 0;     // 当前播放章节索引

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
    log(`[去重] ✅ 已保存: ${sectionName}`);
  } catch (e) {
    log(`[去重] 保存失败: ${e.message}`);
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
      return {
        paused: video.paused,
        ended: video.ended,
        currentTime: video.currentTime,
        duration: video.duration || 0,
        readyState: video.readyState,
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
      
      // 如果已暂停，播放
      if (video.paused) {
        video.play().catch(() => {});
        
        // 也尝试点击大播放按钮
        const bigPlayBtn = document.querySelector('.vjs-big-play-button');
        if (bigPlayBtn && bigPlayBtn.offsetWidth > 0) {
          bigPlayBtn.click();
        }
        
        // 也尝试点击播放控制按钮
        const playBtn = document.querySelector('.vjs-play-control');
        if (playBtn) playBtn.click();
      }
      
      return { ok: true, paused: video.paused, currentTime: video.currentTime };
    });
    return result.ok;
  } catch (e) {
    log(`[播放] 异常: ${e.message}`);
    return false;
  }
}

async function setPlaybackRate(videoFrame, rate) {
  if (!videoFrame) return;
  try {
    await videoFrame.evaluate((r) => {
      const video = document.querySelector('#videoFrame_video_html5_api');
      if (video) video.playbackRate = r;
    }, rate);
  } catch {}
}

// ============ 在线确认弹框处理 ============
// 弹框结构：play.html 中的 #overlay（正常时 display:block 但 height:0）
// 弹框出现时 #overlay height > 0，#ol-close 也会变高
// 关闭方式：点击 #ol-close 或 overlay 内按钮
async function checkAndClosePopup(playFrame, mainPage) {
  if (!playFrame) return false;
  
  try {
    const popupInfo = await playFrame.evaluate(() => {
      const overlay = document.querySelector('#overlay');
      const olClose = document.querySelector('#ol-close');
      if (!overlay) return { exists: false };
      
      // 关键判断：overlay 的 height > 0 说明弹框出现
      const overlayH = overlay.offsetHeight;
      const closeH = olClose ? olClose.offsetHeight : 0;
      const hasContent = overlay.innerHTML.trim().length > 0;
      const isPopup = overlayH > 10 || closeH > 5 || (hasContent && overlay.style.display !== 'none');
      
      return {
        exists: true,
        isPopup,
        overlayH,
        closeH,
        hasContent,
        text: overlay.textContent.trim().substring(0, 200),
        innerHTML: overlay.innerHTML.substring(0, 500),
      };
    });
    
    if (popupInfo.isPopup) {
      log(`[弹框] ⚠️ 检测到在线确认弹框！overlayH=${popupInfo.overlayH} closeH=${popupInfo.closeH}`);
      if (popupInfo.text) log(`[弹框] 内容: ${popupInfo.text.substring(0, 80)}`);
      
      // 多种策略关闭弹框
      const closed = await playFrame.evaluate(() => {
        // 策略1：点击 #ol-close
        const closeBtn = document.querySelector('#ol-close');
        if (closeBtn && closeBtn.offsetHeight > 0) {
          closeBtn.click();
          return 'ol-close';
        }
        
        // 策略2：点击 overlay 内的确定/继续/确认按钮
        const overlay = document.querySelector('#overlay');
        if (overlay) {
          const btns = overlay.querySelectorAll('button, a, .btn, [role="button"]');
          for (const btn of btns) {
            if (btn.offsetHeight > 0) {
              const text = btn.textContent.trim();
              if (text.includes('确定') || text.includes('继续') || text.includes('确认') || text.includes('是') || text.includes('关闭')) {
                btn.click();
                return 'button: ' + text.substring(0, 20);
              }
            }
          }
          // 策略3：点击 overlay 内任何可点击元素
          for (const btn of btns) {
            if (btn.offsetHeight > 0) {
              btn.click();
              return 'any-button';
            }
          }
        }
        
        // 策略4：直接隐藏 overlay
        if (overlay) {
          overlay.style.display = 'none';
          overlay.style.height = '0';
          if (closeBtn) { closeBtn.style.display = 'none'; closeBtn.style.height = '0'; }
          return 'force-hide';
        }
        
        return null;
      });
      
      if (closed) {
        log(`[弹框] ✅ 已关闭 (${closed})`);
        // 关闭弹框后确保视频继续播放
        const videoFrame = getVideoFrame(mainPage);
        if (videoFrame) await playVideo(videoFrame);
      }
      return true;
    }
  } catch (e) {
    // 静默忽略
  }
  
  // 也检查主页面中的 Bootstrap 弹框（在线确认可能也在主页面）
  try {
    const mainDialog = await mainPage.evaluate(() => {
      const modals = document.querySelectorAll('.modal.fade.in, .modal.fade.show');
      for (const modal of modals) {
        if (modal.offsetWidth > 0 && modal.offsetHeight > 0) {
          const text = modal.textContent.trim();
          // 关闭任何可见弹框（含"确定"按钮的）
          const btn = modal.querySelector('.btn-primary, .btn-confirm, button:visible, .btn');
          if (btn && btn.offsetWidth > 0) {
            btn.click();
            return text.substring(0, 50);
          }
        }
      }
      return null;
    });
    if (mainDialog) {
      log(`[弹框] ✅ 关闭主页面弹框: ${mainDialog}`);
      return true;
    }
  } catch {}
  
  return false;
}

// ============ 课程导航 ============
// 实际页面结构（play.html 中的导航）：
//   左侧栏：Unit 1 → 子节(1,2,3,4) | Unit 2 → 子节 | ...
//   右侧栏：当前Unit的子节列表 .courseOpt_list li
//   链接都是 javascript:; （SPA路由，需JS点击触发）
//   需要先点击 Unit 展开子节，再点击具体子节

// 获取所有课程节（按Unit分组）
async function getAllSections(playFrame) {
  if (!playFrame) return [];
  try {
    return await playFrame.evaluate(() => {
      const sections = [];
      // 左侧导航中的所有链接
      const links = document.querySelectorAll('a[href="javascript:;"]');
      let currentUnit = '';
      for (const link of links) {
        const text = link.textContent.trim();
        if (!text || text === '首页' || text === '课程讲解' || text === '展开' || text === '更多' || text === '目录' || text === '视频' || text === '语音') continue;
        
        if (text.startsWith('Unit ')) {
          currentUnit = text;
        } else if (currentUnit && !text.startsWith('Unit')) {
          // 这是子节
          sections.push({ unit: currentUnit, section: text });
        }
      }
      return sections;
    });
  } catch { return []; }
}

// 获取当前正在播放的章节名（备用，优先用 sectionList[currentSectionIdx]）
async function getCurrentSectionName(playFrame) {
  if (!playFrame) return '';
  try {
    return await playFrame.evaluate(() => {
      // 右侧栏当前选中的资源按钮
      const resBtns = document.querySelectorAll('.resBtn, a.resBtn, .courseOpt_list li a');
      for (const btn of resBtns) {
        if (btn.className.includes('cur') || btn.className.includes('active') || btn.className.includes('on')) {
          return btn.textContent.trim();
        }
      }
      return '';
    });
  } catch { return ''; }
}

// 点击下一个章节（基于索引跟踪，不再依赖 CSS 类检测当前节）
async function clickNextSection(playFrame) {
  if (!playFrame) return false;
  
  currentSectionIdx++;
  if (currentSectionIdx >= sectionList.length) {
    log('[导航] ⚠️ 已到达最后一节');
    return false;
  }
  
  const target = sectionList[currentSectionIdx];
  log(`[导航] 切换到第 ${currentSectionIdx + 1}/${sectionList.length} 节: ${target.section} (${target.unit})`);
  
  try {
    // 重新扫描 DOM 找到目标链接的当前索引（DOM 可能因展开/折叠而变化）
    const linkInfo = await playFrame.evaluate((tgt) => {
      const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
      let unitIdx = -1;
      let sectionIdx = -1;
      let inTargetUnit = false;
      
      for (let i = 0; i < allLinks.length; i++) {
        const text = allLinks[i].textContent.trim();
        if (text === tgt.unit) {
          unitIdx = i;
          inTargetUnit = true;
        } else if (text.startsWith('Unit ')) {
          inTargetUnit = false;
        } else if (inTargetUnit && text === tgt.section) {
          sectionIdx = i;
          break;
        }
      }
      
      return { unitIdx, sectionIdx, found: sectionIdx >= 0 };
    }, target);
    
    if (!linkInfo.found) {
      log(`[导航] ⚠️ DOM中未找到章节链接: ${target.section}`);
      // 尝试模糊匹配
      const fallbackInfo = await playFrame.evaluate((tgt) => {
        const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
        let unitIdx = -1;
        let sectionIdx = -1;
        let inTargetUnit = false;
        
        for (let i = 0; i < allLinks.length; i++) {
          const text = allLinks[i].textContent.trim();
          if (text.includes(tgt.unit.replace('Unit ', '')) || text === tgt.unit) {
            unitIdx = i;
            inTargetUnit = true;
          } else if (text.startsWith('Unit ')) {
            inTargetUnit = false;
          } else if (inTargetUnit && text.includes(tgt.section)) {
            sectionIdx = i;
            break;
          }
        }
        
        return { unitIdx, sectionIdx, found: sectionIdx >= 0 };
      }, target);
      
      if (!fallbackInfo.found) {
        log(`[导航] ❌ 无法定位章节: ${target.section}`);
        return false;
      }
      linkInfo.unitIdx = fallbackInfo.unitIdx;
      linkInfo.sectionIdx = fallbackInfo.sectionIdx;
    }
    
    // Step 1: 点击 Unit 展开子节（Playwright 原生点击，能触发 Vue/JS 事件）
    if (linkInfo.unitIdx >= 0) {
      try {
        await playFrame.locator('a[href="javascript:;"]').nth(linkInfo.unitIdx).click({ timeout: 3000 });
        log(`[导航] 已展开 Unit: ${target.unit}`);
      } catch {}
      await sleep(1);
      
      // 展开后 DOM 可能变化，重新获取 section 索引
      const updatedIdx = await playFrame.evaluate((tgt) => {
        const allLinks = Array.from(document.querySelectorAll('a[href="javascript:;"]'));
        for (let i = 0; i < allLinks.length; i++) {
          if (allLinks[i].textContent.trim() === tgt.section) return i;
        }
        return -1;
      }, target);
      if (updatedIdx >= 0) linkInfo.sectionIdx = updatedIdx;
    }
    
    // Step 2: 点击章节链接（Playwright 原生点击）
    try {
      await playFrame.locator('a[href="javascript:;"]').nth(linkInfo.sectionIdx).click({ timeout: 5000 });
      log(`[导航] ✅ 已点击: ${target.section}`);
      return true;
    } catch (clickErr) {
      // Fallback: evaluate 点击
      log(`[导航] 原生点击失败，尝试 evaluate 点击...`);
      await playFrame.evaluate((idx) => {
        const links = document.querySelectorAll('a[href="javascript:;"]');
        if (links[idx]) links[idx].click();
      }, linkInfo.sectionIdx);
      log(`[导航] ✅ 已点击(evaluate): ${target.section}`);
      return true;
    }
  } catch (e) {
    log(`[导航] ❌ 点击异常: ${e.message}`);
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
          const x = rect.left + Math.random() * rect.width;
          const y = rect.top + Math.random() * rect.height;
          video.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
        }
      });
    }
  } catch {}
}

// ============ 保存/加载登录状态 ============
async function saveAuthState(context) {
  try {
    const state = await context.storageState();
    const dir = path.dirname(CONFIG.authStateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.authStateFile, JSON.stringify(state, null, 2));
    log('[登录] ✅ 已保存登录状态');
  } catch (e) {
    log(`[登录] 保存状态失败: ${e.message}`);
  }
}

// ============ 主函数 ============
async function main() {
  // 初始化日志
  const logDir = path.dirname(CONFIG.logFile);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  logStream = fs.createWriteStream(CONFIG.logFile, { flags: 'a' });
  
  log('');
  log('╔══════════════════════════════════════════╗');
  log('║   弘成教育 - 自动刷课脚本 v1.1          ║');
  log('║   功能：自动播放 + 弹框确认 + 换课       ║');
  log('╚══════════════════════════════════════════╝');
  log('');
  
  // 加载去重记录
  loadLearned();
  
  // 读取课程URL（命令行参数或配置）
  const courseUrl = process.argv[2] || CONFIG.courseUrl;
  if (!courseUrl) {
    log('❌ 请提供课程URL！');
    log('');
    log('用法: node chinaedu-study.js <课程URL>');
    log('');
    log('课程URL示例:');
    log('  https://fjshare.chinaedu.net/course/courseWare.do?orgCode=...&courseCode=...&userId=...');
    log('');
    log('获取方法: 登录平台 → 选课 → 打开课程 → 复制浏览器地址栏URL');
    process.exit(1);
  }
  
  log(`[启动] 课程URL: ${courseUrl.substring(0, 80)}...`);
  
  // 启动浏览器
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    channel: 'chrome',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=TranslateUI',
    ],
  });
  
  // 加载登录状态
  let savedState = null;
  if (fs.existsSync(CONFIG.authStateFile)) {
    try {
      savedState = JSON.parse(fs.readFileSync(CONFIG.authStateFile, 'utf8'));
      log('[登录] 已加载登录状态');
    } catch {
      log('[登录] 登录状态文件损坏，将重新登录');
    }
  }
  
  const context = await browser.newContext({
    storageState: savedState || undefined,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  
  // 信号处理：Ctrl+C 时保存登录状态
  const cleanup = async (signal) => {
    log(`\n[${signal}] 正在保存状态并退出...`);
    await saveAuthState(context);
    await browser.close();
    process.exit(0);
  };
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  
  const page = await context.newPage();
  
  // 导航到课程页面
  log('[1/3] 打开课程页面...');
  try {
    await page.goto(courseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    log(`[1/3] 页面加载超时，继续执行: ${e.message}`);
  }
  
  await sleep(5);
  
  // 等待 iframe 加载
  log('[1/3] 等待课程内容加载...');
  let videoFrame = null;
  let playFrame = null;
  let retries = 0;
  
  while (retries < 20) {
    videoFrame = getVideoFrame(page);
    playFrame = getPlayFrame(page);
    if (videoFrame && playFrame) break;
    await sleep(2);
    retries++;
  }
  
  if (!videoFrame) {
    log('[1/3] ⚠️ 未找到视频播放器，可能需要登录或URL已过期');
    log('[1/3] 请在浏览器中手动登录后，复制新的课程URL');
    
    // 保存当前状态并保持浏览器打开
    await saveAuthState(context);
    log('[1/3] 浏览器保持打开，请手动操作后按 Ctrl+C 退出');
    await sleep(999999);
  }
  
  log('[1/3] ✅ 课程页面加载完成');
  
  // 打印课程信息
  const courseTitle = await playFrame.evaluate(() => document.title).catch(() => '');
  log(`[课程] 标题: ${courseTitle}`);
  
  // 获取章节列表
  const sections = await getAllSections(playFrame);
  sectionList = sections;    // 存入全局，供导航使用
  currentSectionIdx = 0;     // 从第1节开始
  if (sections.length > 0) {
    log(`[课程] 共 ${sections.length} 个章节:`);
    sections.slice(0, 10).forEach((s, i) => {
      log(`  [${i + 1}] ${s.unit} - ${s.section.substring(0, 50)}`);
    });
    if (sections.length > 10) log(`  ... 还有 ${sections.length - 10} 个章节`);
  } else {
    log('[课程] ⚠️ 未解析到章节列表，将尝试逐节导航');
  }
  
  // 点击播放
  log('[2/3] 开始播放视频...');
  await playVideo(videoFrame);
  await sleep(3);
  
  // 设置播放速率（可选，1.0 为正常速度）
  // await setPlaybackRate(videoFrame, 1.5); // 1.5倍速（慎用，可能被检测）
  
  // 保存登录状态
  await saveAuthState(context);
  
  // ============ 主循环 ============
  log('[3/3] 进入自动监控模式...');
  log('');
  
  let activityTimer = 0;
  let popupCheckTimer = 0;
  
  while (true) {
    await sleep(CONFIG.checkInterval);
    activityTimer += CONFIG.checkInterval;
    popupCheckTimer += CONFIG.checkInterval;
    
    // 1. 定期检查弹框（每3秒）
    if (popupCheckTimer >= CONFIG.popupCheckInterval) {
      popupCheckTimer = 0;
      await checkAndClosePopup(playFrame, page);
    }
    
    // 2. 定期模拟鼠标活动（防挂机）
    if (activityTimer >= CONFIG.activityInterval) {
      activityTimer = 0;
      await simulateActivity(page);
    }
    
    // 3. 检查视频状态
    const videoInfo = await getVideoInfo(videoFrame);
    if (!videoInfo) {
      // 视频帧可能已刷新，重新获取
      videoFrame = getVideoFrame(page);
      playFrame = getPlayFrame(page);
      continue;
    }
    
    // 视频暂停了？尝试恢复播放
    if (videoInfo.paused && !videoInfo.ended) {
      log(`[播放] 视频已暂停 (${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)})，尝试恢复...`);
      await playVideo(videoFrame);
      await sleep(2);
    }
    
    // 视频卡住检测
    if (Math.abs(videoInfo.currentTime - lastVideoTime) < 0.5 && !videoInfo.paused && !videoInfo.ended) {
      stuckCounter++;
      if (stuckCounter > CONFIG.videoStuckTimeout / CONFIG.checkInterval) {
        log('[播放] ⚠️ 视频进度卡住，尝试刷新...');
        await playVideo(videoFrame);
        stuckCounter = 0;
      }
    } else {
      stuckCounter = 0;
    }
    lastVideoTime = videoInfo.currentTime;
    
    // 视频播放结束
    if (videoInfo.ended || (videoInfo.duration > 0 && videoInfo.currentTime >= videoInfo.duration - 1)) {
      completedSections++;
      // 优先用跟踪的章节名（可靠），fallback 到 DOM 检测
      const sectionName = (currentSectionIdx < sectionList.length)
        ? `${sectionList[currentSectionIdx].unit} - ${sectionList[currentSectionIdx].section}`
        : await getCurrentSectionName(playFrame);
      const minutes = Math.round(videoInfo.duration / 60);
      totalStudyMinutes += minutes;
      
      // 保存去重记录
      saveLearned(sectionName || `Section-${completedSections}`);
      
      log('');
      log('  ═════════════════════════════════════');
      log(`  ✅ 第${completedSections}节完成！+${minutes}分钟 | 累计: ${totalStudyMinutes}分钟`);
      if (sectionName) log(`  📖 ${sectionName}`);
      log('  ═════════════════════════════════════');
      log('');
      
      // 切换到下一节
      const hasNext = await clickNextSection(playFrame);
      if (!hasNext) {
        log('[完成] 🎉 所有章节已学完！');
        break;
      }
      
      // 等待新视频加载
      await sleep(5);
      videoFrame = getVideoFrame(page);
      playFrame = getPlayFrame(page);
      
      // 播放新视频
      if (videoFrame) {
        await playVideo(videoFrame);
        lastVideoTime = -1;
        stuckCounter = 0;
      }
      
      // 保存登录状态
      await saveAuthState(context);
    }
    
    // 每30秒打印一次进度
    if (videoInfo.duration > 0 && Date.now() % 30000 < CONFIG.checkInterval * 1000) {
      const progress = ((videoInfo.currentTime / videoInfo.duration) * 100).toFixed(1);
      log(`[进度] ${formatTime(videoInfo.currentTime)}/${formatTime(videoInfo.duration)} (${progress}%) | 已完成${completedSections}节 | 累计${totalStudyMinutes}分钟`);
    }
  }
  
  // 完成
  log('');
  log('🎉🎉🎉 学习完成！🎉🎉🎉');
  log(`  总计: ${completedSections} 节 | ${totalStudyMinutes} 分钟`);
  
  await saveAuthState(context);
  await browser.close();
  if (logStream) logStream.end();
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
