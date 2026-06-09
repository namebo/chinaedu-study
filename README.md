<div align="center">

# 📚 ChinaEdu Auto Study

**浙江理工大学继续教育平台 · 自动刷课脚本**

基于 Playwright 的浏览器自动化工具，专为浙江理工大学·弘成教育（cjstudy.zstu.edu.cn）继续教育平台设计，
自动登录 → 选课 → 播放视频 → 处理弹框 → 章节自动切换，支持多层 iframe 穿透。

> ⚠️ **核心发现**：平台通过 `videolearning.html` 计时窗口计学时，必须从 zstu 主平台入口进入才能记录学习时间，直接打开 chinaedu.net 视频URL不会计学时。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.60+-2EAD33.svg)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ 功能特性

| 功能                  | 说明                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| 🎬 **自动播放**       | 检测 video.js 播放器状态，多重策略恢复暂停、定期保活、应对卡顿          |
| 💬 **弹框自动确认**   | 4 种策略检测并关闭"在线确认"弹框（#overlay），无需人工值守             |
| 📑 **章节自动切换**   | 视频播完自动跳转下一节，索引跟踪 + DOM 精准定位                        |
| 🔐 **登录持久化**     | Cookie 自动保存/加载，重启脚本无需重新登录                             |
| 🚫 **去重记录**       | 已学章节记录到本地文件，绝不重复刷同一节                               |
| 🖱️ **防挂机检测**     | 定时模拟鼠标移动，防止平台判定无操作                                   |
| 📊 **学习统计**       | 实时显示本节进度、已完成章节数和累计学习时长                           |
| 🔄 **多层 iframe**    | 自动穿透 3 层 iframe 结构，精准定位视频帧和导航帧                     |
| 🛡️ **优雅退出**       | Ctrl+C 自动保存状态，下次继续                                         |
| 🔑 **验证码支持**     | 检测到验证码时暂停，等用户手动输入后自动继续                           |
| 📺 **多页面管理**     | 自动分离计时窗口与视频页面，保持计时窗口打开不断计时                   |

## 🏗️ 平台架构

### 入口与计时机制

> ⚠️ **核心限制**：`videolearning.html` 是计时窗口，必须在 zstu 主平台入口进入才能记录学时。
> 直接打开 chinaedu.net 的播放URL不会触发学时记录。

```
┌─────────────────────────────────────────────────────────────────────┐
│  cjstudy.zstu.edu.cn/student/ (主平台)                              │
│  ├── 登录 → 获取课程列表 → 点击 .videolearning-bt 按钮              │
│  │                                                                   │
│  └── 新标签页 ┌────────────────────────────────────────────────┐    │
│               │  videolearning.html (计时窗口 ⏱️)              │    │
│               │  "请不要关闭此窗口，关闭窗口后将不会再计时"      │    │
│               │  ┌─ 点击"确定"(.openNewPage) ──────────────┐  │    │
│               │  │                                         │  │    │
│               │  │  新标签页: chinaedu.net (视频页面)       │  │    │
│               │  │  │                                     │  │    │
│               │  │  └── Frame 0: courseWare.do (笔记/弹框) │  │    │
│               │  │      │                                 │  │    │
│               │  │      └── Frame 1: play.html (导航)     │  │    │
│               │  │          ├── Unit 导航栏                │  │    │
│               │  │          ├── #overlay 在线确认弹框      │  │    │
│               │  │          │                             │  │    │
│               │  │          └── Frame 2: video.html       │  │    │
│               │  │              video.js 播放器            │  │    │
│               │  └─────────────────────────────────────────┘  │    │
│               └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## 📸 运行截图

<!-- 截图占位，后续替换 -->
<table>
  <tr>
    <td align="center"><b>终端运行</b></td>
    <td align="center"><b>章节切换</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/terminal-run.png" alt="终端运行" width="400"/></td>
    <td><img src="docs/screenshots/section-switch.png" alt="章节切换" width="400"/></td>
  </tr>
  <tr>
    <td align="center"><b>弹框自动确认</b></td>
    <td align="center"><b>学习完成统计</b></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/popup-confirm.png" alt="弹框自动确认" width="400"/></td>
    <td><img src="docs/screenshots/completion-stats.png" alt="学习完成统计" width="400"/></td>
  </tr>
</table>

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Chrome** 浏览器（已安装在系统中）
- **macOS** / Windows / Linux

### 安装

```bash
# 1. 克隆项目
git clone https://github.com/namebo/chinaedu-study.git
cd chinaedu-study

# 2. 安装依赖
npm install
```

### 使用

#### 方式一：命令行直接运行

```bash
# 不传入参数：自动选择第一个未完成的课程
node chinaedu-study.js

# 传入课程名称关键词：自动匹配课程
node chinaedu-study.js "大学英语"
```

#### 方式二：使用启动脚本

```bash
bash chinaedu-start.sh
```

### 首次使用流程

1. 运行脚本，Chrome 浏览器会自动打开 zstu 登录页
2. 脚本**自动填写账号密码登录**（修改账号请编辑脚本 `doLogin()` 函数）
3. 如遇验证码，脚本会暂停等待，请在浏览器中手动输入后登录
4. 脚本自动获取课程列表 → 选择课程 → 打开计时窗口 → 点击"确定" → 开始播放 🎉
5. 视频播放期间**请勿关闭** `videolearning.html` 页面（它是计时窗口！）
6. 之后再次运行 **无需重新登录**

> ⚠️ **计时机制**：平台要求 `videolearning.html` 页面保持打开状态才会计学时。脚本不会关闭此页面，但请不要手动切换或关闭它。

## ⚙️ 配置说明

脚本顶部 `CONFIG` 对象支持自定义：

```javascript
const CONFIG = {
  // 浙江理工大学继续教育平台
  platformUrl: 'https://cjstudy.zstu.edu.cn/student/',

  // 检查间隔（秒）
  checkInterval: 5,

  // 在线确认弹框检查间隔（秒）
  popupCheckInterval: 3,

  // 视频卡住超时（秒），进度不变超过此时间认为卡住
  videoStuckTimeout: 120,

  // 是否无头模式（false = 显示浏览器窗口）
  headless: false,

  // 防挂机：模拟鼠标移动间隔（秒）
  activityInterval: 20,

  // 文件路径（默认保存在 ~/chinaedu-study/）
  authStateFile: '~/.chinaedu-study/auth-state-zstu.json',
  learnedFile:   '~/.chinaedu-study/learned-courses.json',
  logFile:       '~/.chinaedu-study/study.log',
};
```

### 修改账号密码

编辑脚本中的 `doLogin()` 函数，修改用户名和密码：

```javascript
await el.fill('你的学号');   // 用户名
await el.fill('你的密码');   // 密码
```

### 播放速率

默认 1.0 倍速（正常速度），可取消注释修改：

```javascript
// 在 main() 函数中找到这行，取消注释并修改倍速
await setPlaybackRate(videoFrame, 1.5); // 1.5倍速（慎用，可能被检测）
```

## 📁 项目结构

```
chinaedu-study/
├── chinaedu-study.js       # 主脚本（核心逻辑 v2.0.3）
├── detect-zstu.js          # 网络请求探测脚本
├── chinaedu-start.sh       # 一键启动脚本
├── package.json            # 项目依赖
├── auth-state.json         # 登录状态（自动生成，.gitignore）
├── learned-courses.json    # 已学章节记录（自动生成，.gitignore）
├── last-url.txt            # 上次使用的课程URL（自动生成，.gitignore）
├── study.log               # 运行日志（自动生成，.gitignore）
└── node_modules/           # 依赖目录
```

## 🔧 核心流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  打开 zstu   │────▶│   自动登录    │────▶│  获取课程列表 │
│  主平台      │     │  填写账号密码 │     │  API获取/DOM │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                          ┌──────────────────────┤
                          │                      │
                          ▼                      ▼
                   ┌──────────────┐      ┌──────────────┐
                   │  选择课程    │      │  打开计时窗口 │
                   │  名称匹配    │      │  videolearning│
                   └──────────────┘      └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │  加载 iframe  │
                                          │  解析章节列表 │
                                          └──────┬───────┘
                                                 │
                          ┌──────────────────────┤
                          │                      │
                          ▼                      ▼
                   ┌──────────────┐      ┌──────────────┐
                   │  在线确认弹框  │      │   视频播完    │
                   │  4种策略关闭  │      │   切换下一节  │
                   └──────────────┘      └──────┬───────┘
                                                 │
                          全部播完 ◀──────────────┘
```

### 技术细节

| 环节             | 策略                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **视频播放**     | 点击视频区域激活 + video.play() + 大播放按钮 + 控制栏按钮，四重保障   |
| **播放保活**     | 每 30 秒定期调用 play()，防止被平台暂停后无法恢复                     |
| **卡顿检测**     | 进度不变超过 videoStuckTimeout 秒，自动尝试恢复播放 + load 重载        |
| **弹框检测**     | #overlay 正常 display:block 但 height:0，弹框时 height>0 → 精准判断                         |
| **弹框关闭**     | 4 种策略：点击 #ol-close → 点击确定按钮 → 点击任意可见元素 → 强制隐藏 DOM                   |
| **章节导航**     | 索引跟踪模式：加载时解析全部章节 → 播完 currentSectionIdx++ → 重新扫描DOM定位 → Playwright原生click |
| **Unit 展开**    | 点击 Unit 展开子节 → 等1秒 DOM 更新 → 重新定位 section 索引 → 点击目标章节                  |
| **验证码处理**   | 检测 15 种常见验证码元素，发现后暂停脚本等待用户手动输入，最多等 5 分钟 |
| **多页面管理**   | timingPage（计学时）+ videoPage（操作视频），分离管理互不干扰          |
| **确定弹框**     | 自动点击 `.openNewPage` 确定按钮，打开 chinaedu.net 视频页面           |
| **防挂机**       | 每 20 秒在视频区域随机位置模拟鼠标移动                                                        |
| **去重**         | 播完章节自动写入 learned-courses.json，格式 "Unit X - 章节名"                                |

## 💡 典型运行输出

```
╔══════════════════════════════════════════╗
║  浙江理工·弘成教育 - 自动刷课 v2.0.3    ║
║  必须从 zstu 平台入口进入，才能计学时     ║
╚══════════════════════════════════════════╝

[17:38:02] [去重] 已加载 3 条已学记录
[17:38:03] [1/5] 打开 zstu 主平台...
[17:38:05] [登录] 已加载登录状态
[17:38:06] [2/5] 获取课程列表...
[17:38:08] [3/5] 共 8 门课程:
  [1] 大学英语1
  [2] 大学英语2
  [3] 计算机基础
  ...
[17:38:08] [3/5] 选中课程: 大学英语1
[17:38:09] [3/5] 已点击课程学习按钮 #1
[17:38:12] [3/5] ✅ 已切换到计时窗口
[17:38:15] [4/5] ✅ 已点击"确定"，进入在线看课
[17:38:16] [4/5] ✅ 视频页面已在新标签页打开
[17:38:18] [4/5] ✅ 视频播放器已就绪
[17:38:18] [课程] 共 24 个章节:
  [1] Unit 1 - Section 1
  [2] Unit 1 - Section 2
  ...
[17:38:20] [5/5] 开始播放...
[17:38:23] [监控] 进入自动监控模式...
[17:38:23] [监控] 📺 计时窗口保持打开中...

[17:40:05] [弹框] ⚠️ 检测到在线确认弹框！overlayH=200 closeH=30
[17:40:05] [弹框] 已关闭 (ol-close)

[17:40:16] [状态] paused=false ended=false readyState=4 time=02:30/14:45
[17:40:16] [播放] 定期保活 (02:30/14:45)

[17:51:30]
  ═════════════════════════════════════
  ✅ 第1节完成！+14分钟 | 累计: 14分钟
  📖 Unit 1 - Section 1
  ═════════════════════════════════════

[17:51:31] [导航] 切换到第 2/24 节: Section 2 (Unit 1)
[17:51:32] [导航] 已展开 Unit: Unit 1
[17:51:33] [导航] 已点击: Section 2

🎉🎉🎉 学习完成！🎉🎉🎉
  总计: 24 节 | 336 分钟
```

## ❓ 常见问题

<details>
<summary><b>视频暂停后无法恢复？</b></summary>

v2.0.3 已修复。脚本现在使用四重策略恢复播放：点击视频区域激活 → 点击大播放按钮 → 点击控制栏播放按钮 → 调用 video.play()。同时每 30 秒定期保活，防止平台自动暂停后无法恢复。

</details>

<details>
<summary><b>刷了视频但学时没增加？</b></summary>

**这是最常见的问题！** 原因：脚本必须从 `cjstudy.zstu.edu.cn` 主平台入口进入，打开 `videolearning.html` 计时窗口才能记录学时。

直接打开 `fjshare.chinaedu.net` 的视频URL不会触发学时记录。

v2.0+ 已修复此问题，脚本会自动走 zstu 入口流程。

</details>

<details>
<summary><b>点击"确定"弹框后卡住？</b></summary>

v2.0.2 已修复。点击"确定"后会弹出新标签页（chinaedu.net），脚本现在会自动检测并切换到新标签页作为视频页面，同时保持原计时窗口打开。

</details>

<details>
<summary><b>登录时需要验证码？</b></summary>

v2.0.1 已支持。脚本检测到验证码后会暂停并提示你在浏览器中手动输入，输入完成后脚本自动继续。最多等待 5 分钟。

</details>

<details>
<summary><b>"请求课件地址不存在"？</b></summary>

这是因为直接构建 videolearning.html URL 缺少 sign 参数。v2.0.1 已修复，改为点击 `.videolearning-bt` 按钮让前端生成完整 URL。

</details>

<details>
<summary><b>脚本提示"未找到视频播放器"？</b></summary>

可能原因：
1. **计时窗口未正确加载** — 检查浏览器是否已导航到 `videolearning.html`
2. **iframe 加载超时** — 网络较慢时，等待时间不够。脚本会自动重试
3. **页面结构变化** — 如果平台更新了页面结构，可能需要适配。请提 Issue

</details>

<details>
<summary><b>视频播完不切换下一节？</b></summary>

脚本使用索引跟踪模式，会在加载时解析所有章节。如果章节列表解析失败（日志中显示"共 0 个章节"），说明页面结构与预期不符，请提 Issue 反馈。

</details>

<details>
<summary><b>弹框没有被自动关闭？</b></summary>

脚本检测 `#overlay` 的 `offsetHeight > 0` 来判断弹框出现。如果平台更新了弹框结构，可能需要适配。请提 Issue 附带弹框截图和 HTML 结构。

</details>

<details>
<summary><b>每次运行都要重新登录？</b></summary>

检查 `auth-state-zstu.json` 是否存在。登录状态通常有效数天，过期后需重新登录一次。脚本会在每次运行结束时自动保存最新状态。

</details>

<details>
<summary><b>Ctrl+C 退出后进度会丢失吗？</b></summary>

不会。脚本捕获 SIGINT/SIGTERM 信号，退出前自动保存登录状态。已完成的章节记录在 `learned-courses.json` 中，不会丢失。

</details>

<details>
<summary><b>支持无头模式吗？</b></summary>

设置 `headless: true` 即可，但建议首次运行保留浏览器窗口，以便观察状态和手动登录。

</details>

<details>
<summary><b>可以加速播放吗？</b></summary>

可以，但不推荐。取消注释 `setPlaybackRate` 行并设置倍速（如 1.5）。注意：倍速播放可能被平台检测到，导致学时无效。

</details>

## 📝 更新日志

### v2.0.3

- 🐛 修复视频暂停后无法恢复播放的问题（四重策略：点击视频区域 + 大播放按钮 + 控制栏 + video.play()）
- ✨ 新增 Video.js 播放器状态优先检测（paused/ended）
- ✨ 新增定期保活机制（每 30 秒强制尝试一次播放）
- ✨ 新增详细状态日志（paused/ended/readyState）
- 🐛 修复卡顿检测误判（不再依赖 paused 状态，直接检测 currentTime）
- ✨ 改进进度显示：显示本节时间和累计估算时间

### v2.0.2

- 🐛 修复点击"确定"弹框后脚本卡住的问题
- ✨ 分离 timingPage（计时窗口）和 videoPage（视频页面）
- ✨ 自动点击 `.openNewPage` 确定按钮
- ✨ 自动检测并切换到 chinaedu.net 新标签页

### v2.0.1

- 🐛 修复直接构建 videolearning.html URL 缺少 sign 参数导致"请求课件地址不存在"
- ✨ 改为点击 `.videolearning-bt` 按钮让前端生成完整 URL
- ✨ 新增验证码检测，暂停等用户手动输入

### v2.0

- 🔥 **重大重构**：改为从 zstu 主平台入口进入，修复"刷了但不计学时"的核心问题
- 🔥 发现计时机制：`videolearning.html` 是计时窗口，必须保持打开
- ✨ 自动登录 zstu 平台（内置账号密码，可配置）
- ✨ 通过 API 自动获取课程列表
- ✨ 自动选择第一个未完成的课程
- ✨ 支持通过命令行参数传入课程名称关键词匹配
- 🐛 修复直接打开 chinaedu.net URL 不计学时的问题

### v1.1

- 🐛 修复章节名显示为 "video.m3u8" 的问题
- 🐛 修复视频播完后不切换下一节的问题
- ✨ 新增 `sectionList` + `currentSectionIdx` 索引跟踪导航
- ✨ 支持 Unit 展开后 DOM 变化自动重新定位

### v1.0

- ✅ 初始版本
- ✅ 自动播放 video.js 视频
- ✅ 4 种策略自动关闭在线确认弹框
- ✅ 3 层 iframe 自动穿透
- ✅ 登录持久化
- ✅ 已学章节去重
- ✅ 防挂机鼠标模拟
- ✅ 优雅退出

## 🤝 相关项目

- [Auto Study](https://github.com/namebo/auto-study-project) — 杭州人社学习平台自动刷课脚本

## ⚖️ 免责声明

本项目仅供学习交流使用，请确保你的使用行为符合平台规定和相关法律法规。使用本脚本产生的一切后果由使用者自行承担。

## 📄 License

[MIT](LICENSE)
