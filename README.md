<div align="center">

# 📚 ChinaEdu Auto Study

**弘成教育继续教育平台 · 自动刷课脚本**

基于 Playwright 的浏览器自动化工具，专为弘成教育（chinaedu.net）继续教育平台设计，
自动播放视频、处理在线确认弹框、章节自动切换，支持多层 iframe 穿透。

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.60+-2EAD33.svg)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ 功能特性

| 功能                  | 说明                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| 🎬 **自动播放**       | 检测 video.js 播放器状态，自动播放、恢复暂停、应对卡顿                 |
| 💬 **弹框自动确认**   | 4 种策略检测并关闭"在线确认"弹框（#overlay），无需人工值守             |
| 📑 **章节自动切换**   | 视频播完自动跳转下一节，索引跟踪 + DOM 精准定位                        |
| 🔐 **登录持久化**     | Cookie 自动保存/加载，重启脚本无需重新登录                             |
| 🚫 **去重记录**       | 已学章节记录到本地文件，绝不重复刷同一节                               |
| 🖱️ **防挂机检测**     | 定时模拟鼠标移动，防止平台判定无操作                                   |
| 📊 **学习统计**       | 实时显示已完成章节数和累计学习时长                                     |
| 🔄 **多层 iframe**    | 自动穿透 3 层 iframe 结构，精准定位视频帧和导航帧                     |
| 🛡️ **优雅退出**       | Ctrl+C 自动保存状态，下次继续                                         |

## 🏗️ 平台架构

弘成教育平台使用 3 层嵌套 iframe 结构，脚本自动穿透各层：

```
┌─────────────────────────────────────────────────────┐
│  Frame 0: courseWare.do (主页面)                     │
│  ├── 笔记区域                                        │
│  ├── Bootstrap 弹框                                  │
│  │                                                   │
│  └── ┌─────────────────────────────────────────┐    │
│      │  Frame 1: play.html (课程内容)           │    │
│      │  ├── 左侧 Unit 导航栏                     │    │
│      │  ├── 右侧 .courseOpt_list 子节列表       │    │
│      │  ├── #overlay 在线确认弹框                │    │
│      │  ├── #ol-close 关闭按钮                   │    │
│      │  │                                       │    │
│      │  └── ┌─────────────────────────────┐    │    │
│      │      │  Frame 2: video.html (播放器) │    │    │
│      │      │  ├── video.js 播放器          │    │    │
│      │      │  └── #videoFrame_video_html5  │    │    │
│      │      └─────────────────────────────┘    │    │
│      └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
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
node chinaedu-study.js "https://fjshare.chinaedu.net/course/courseWare.do?orgCode=010185&courseCode=..."
```

#### 方式二：使用启动脚本

```bash
# 首次运行（传入课程URL）
bash chinaedu-start.sh 'https://fjshare.chinaedu.net/course/courseWare.do?orgCode=...'

# 后续运行（自动使用上次保存的URL）
bash chinaedu-start.sh
```

### 获取课程 URL

1. 登录你的弘成教育平台（如 `fjshare.chinaedu.net`）
2. 选择课程，进入视频学习页面
3. **复制浏览器地址栏的完整 URL**
4. 将 URL 作为参数运行脚本

> ⚠️ 课程 URL 包含认证参数（sign/timestamp/learnSessionId），可能过期。过期后需重新获取。

### 首次使用流程

1. 运行脚本，Chrome 浏览器会自动打开课程页面
2. 如果页面未正常加载，可能是需要登录或 URL 已过期
3. 手动登录/获取新 URL 后再次运行
4. 脚本自动开始播放 → 弹框确认 → 播完换节 → 全部完成 🎉
5. 之后再次运行 **无需重新登录**

## ⚙️ 配置说明

脚本顶部 `CONFIG` 对象支持自定义：

```javascript
const CONFIG = {
  // 课程URL（也可通过命令行参数传入）
  courseUrl: '',

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
  authStateFile: '~/.chinaedu-study/auth-state.json',
  learnedFile:   '~/.chinaedu-study/learned-courses.json',
  logFile:       '~/.chinaedu-study/study.log',
};
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
├── chinaedu-study.js       # 主脚本（核心逻辑）
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
│   打开课程    │────▶│  解析章节列表  │────▶│   自动播放    │
│   加载 iframe │     │  Unit + 子节  │     │   video.js   │
└──────────────┘     └──────────────┘     └──────┬───────┘
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
| **iframe 穿透**  | 自动扫描 page.frames()，按 URL 特征匹配 play.html / video.html                             |
| **弹框检测**     | #overlay 正常 display:block 但 height:0，弹框时 height>0 → 精准判断                         |
| **弹框关闭**     | 4 种策略：点击 #ol-close → 点击确定按钮 → 点击任意可见元素 → 强制隐藏 DOM                   |
| **章节导航**     | 索引跟踪模式：加载时解析全部章节 → 播完 currentSectionIdx++ → 重新扫描DOM定位 → Playwright原生click |
| **Unit 展开**    | 点击 Unit 展开子节 → 等1秒 DOM 更新 → 重新定位 section 索引 → 点击目标章节                  |
| **视频播放**     | video.play() + 大播放按钮 + 播放控制按钮，三重保障                                           |
| **卡顿检测**     | 进度不变超过 videoStuckTimeout 秒，自动尝试恢复播放                                           |
| **防挂机**       | 每 20 秒在视频区域随机位置模拟鼠标移动                                                        |
| **去重**         | 播完章节自动写入 learned-courses.json，格式 "Unit X - 章节名"                                |

## 💡 典型运行输出

```
╔══════════════════════════════════════════╗
║   弘成教育 - 自动刷课脚本 v1.1          ║
║   功能：自动播放 + 弹框确认 + 换课       ║
╚══════════════════════════════════════════╝

[17:38:02] [去重] 已加载 3 条已学记录
[17:38:02] [启动] 课程URL: https://fjshare.chinaedu.net/course/courseWare.do?orgCode=010185&...
[17:38:03] [登录] 已加载登录状态
[17:38:10] [1/3] ✅ 课程页面加载完成
[17:38:10] [课程] 标题: 浙江理工大学-大学英语1
[17:38:10] [课程] 共 24 个章节:
  [1] Unit 1 - Section 1
  [2] Unit 1 - Section 2
  ...
[17:38:12] [2/3] 开始播放视频...
[17:38:15] [3/3] 进入自动监控模式...

[17:40:05] [弹框] ⚠️ 检测到在线确认弹框！overlayH=200 closeH=30
[17:40:05] [弹框] ✅ 已关闭 (ol-close)

[17:51:30]
  ═════════════════════════════════════
  ✅ 第1节完成！+13分钟 | 累计: 13分钟
  📖 Unit 1 - Section 1
  ═════════════════════════════════════

[17:51:31] [导航] 切换到第 2/24 节: Section 2 (Unit 1)
[17:51:32] [导航] 已展开 Unit: Unit 1
[17:51:33] [导航] ✅ 已点击: Section 2

🎉🎉🎉 学习完成！🎉🎉🎉
  总计: 24 节 | 312 分钟
```

## ❓ 常见问题

<details>
<summary><b>脚本提示"未找到视频播放器"？</b></summary>

可能原因：
1. **需要登录** — 在浏览器中手动登录后，复制新的课程 URL 再运行
2. **URL 已过期** — 课程 URL 包含时效性认证参数，需要重新获取
3. **网络问题** — iframe 加载超时，检查网络连接后重试

</details>

<details>
<summary><b>视频播完不切换下一节？</b></summary>

脚本使用索引跟踪模式（v1.1+），会在加载时解析所有章节。如果章节列表解析失败（日志中显示"共 0 个章节"），说明页面结构与预期不符，请提 Issue 反馈。

</details>

<details>
<summary><b>弹框没有被自动关闭？</b></summary>

脚本检测 `#overlay` 的 `offsetHeight > 0` 来判断弹框出现。如果平台更新了弹框结构，可能需要适配。请提 Issue 附带弹框截图和 HTML 结构。

</details>

<details>
<summary><b>每次运行都要重新登录？</b></summary>

检查 `auth-state.json` 是否存在。登录状态通常有效数天，过期后需重新登录一次。脚本会在每次运行结束时自动保存最新状态。

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

### v1.1

- 🐛 修复章节名显示为 "video.m3u8" 的问题（改用索引跟踪取章节名）
- 🐛 修复视频播完后不切换下一节的问题（3 个导航策略全部依赖 CSS 类但页面无这些类）
- ✨ 新增 `sectionList` + `currentSectionIdx` 索引跟踪导航
- ✨ 章节切换改为索引驱动 + Playwright 原生 click（能触发 Vue/JS 事件）
- ✨ 支持 Unit 展开后 DOM 变化自动重新定位

### v1.0

- ✅ 初始版本
- ✅ 自动播放 video.js 视频
- ✅ 4 种策略自动关闭在线确认弹框
- ✅ 3 层 iframe 自动穿透
- ✅ 登录持久化（storageState）
- ✅ 已学章节去重
- ✅ 防挂机鼠标模拟
- ✅ 优雅退出（信号捕获）

## 🤝 相关项目

- [Auto Study](https://github.com/namebo/auto-study-project) — 杭州人社学习平台自动刷课脚本

## ⚖️ 免责声明

本项目仅供学习交流使用，请确保你的使用行为符合平台规定和相关法律法规。使用本脚本产生的一切后果由使用者自行承担。

## 📄 License

[MIT](LICENSE)
