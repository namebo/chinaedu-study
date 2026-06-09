#!/bin/bash
# 弘成教育(chinaedu.net) - 自动刷课启动脚本 v1.0

PROJECT_DIR=~/chinaedu-study
SCRIPT_SRC="$(dirname "$0")/chinaedu-study.js"

echo "╔══════════════════════════════════════════╗"
echo "║   弘成教育 - 自动刷课 v1.0              ║"
echo "║   自动播放 + 弹框确认 + 换课              ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# 创建项目目录
mkdir -p "$PROJECT_DIR"

# 安装依赖
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "[1/2] 安装依赖..."
  cd "$PROJECT_DIR" && npm init -y >/dev/null 2>&1 && npm install playwright 2>&1 | tail -3
else
  echo "[1/2] 依赖已安装 ✓"
fi

# 复制脚本
cp "$SCRIPT_SRC" "$PROJECT_DIR/chinaedu-study.js" 2>/dev/null
echo "[2/2] ✅ 脚本已更新 (v1.0)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查参数
if [ -z "$1" ]; then
  echo "用法: bash chinaedu-start.sh <课程URL>"
  echo ""
  echo "获取课程URL:"
  echo "  1. 登录 fjshare.chinaedu.net"
  echo "  2. 选择课程，打开视频学习页面"
  echo "  3. 复制浏览器地址栏完整URL"
  echo "  4. 将URL作为参数运行此脚本"
  echo ""
  echo "示例:"
  echo "  bash chinaedu-start.sh 'https://fjshare.chinaedu.net/course/courseWare.do?orgCode=...'"
  echo ""
  
  # 尝试读取上次保存的URL
  if [ -f "$PROJECT_DIR/last-url.txt" ]; then
    LAST_URL=$(cat "$PROJECT_DIR/last-url.txt")
    echo "检测到上次使用的URL，是否继续？(y/n)"
    echo "URL: ${LAST_URL:0:80}..."
    read -r answer
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
      echo ""
      echo "开始刷课..."
      # 保存URL
      echo "$LAST_URL" > "$PROJECT_DIR/last-url.txt"
      cd "$PROJECT_DIR" && NODE_PATH="$PROJECT_DIR/node_modules" node chinaedu-study.js "$LAST_URL"
    fi
  fi
  exit 0
fi

# 保存URL
echo "$1" > "$PROJECT_DIR/last-url.txt"

# 运行
cd "$PROJECT_DIR" && NODE_PATH="$PROJECT_DIR/node_modules" node chinaedu-study.js "$1"
