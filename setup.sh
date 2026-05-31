#!/bin/bash

set -euo pipefail

echo "🚀 Cyanlog Sales Platform - 开发环境初始化脚本"
echo "================================================"
echo "⚠️  注意: 该脚本是历史脚手架入口，不是当前默认开发路径"
echo "   当前业务开发请进入 /Users/nsss/Price-v3/cyanlog-sales-v3"
echo ""
read -p "如需继续执行历史脚手架，请确认继续 (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消。"
    exit 0
fi

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Node.js
echo ""
echo "📋 检查环境..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装${NC}"
    echo "请安装 Node.js 18+ : https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 版本过低: $(node --version)${NC}"
    echo "请升级到 Node.js 18+"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠️  pnpm 未安装，正在安装...${NC}"
    npm install -g pnpm
fi
echo -e "${GREEN}✅ pnpm $(pnpm --version)${NC}"

# 检查 git
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git 未安装${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Git $(git --version)${NC}"

echo ""
echo "📦 创建 Next.js 项目..."
echo "================================================"

# 项目目录
PROJECT_NAME="cyanlog-sales-v3"
USE_EXISTING_PROJECT=false

# 检查目录是否存在
if [ -d "$PROJECT_NAME" ]; then
    echo -e "${YELLOW}⚠️  目录 $PROJECT_NAME 已存在${NC}"
    read -p "是否删除并重新创建? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$PROJECT_NAME"
    else
        echo "使用现有目录继续..."
        cd "$PROJECT_NAME"
        USE_EXISTING_PROJECT=true
    fi
fi

if [ "$USE_EXISTING_PROJECT" = false ] && [ ! -d "$PROJECT_NAME" ]; then
    # 使用 create-next-app
    echo "正在初始化 Next.js 项目..."
    pnpm create next-app@14 "$PROJECT_NAME" \
        --typescript \
        --tailwind \
        --eslint \
        --app \
        --no-src-dir \
        --import-alias "@/*" \
        --turbopack

    cd "$PROJECT_NAME"
fi

echo ""
echo "🔧 安装依赖..."
echo "================================================"

# 安装 shadcn 组件
echo "安装 shadcn/ui..."
pnpm dlx shadcn@latest init --yes --defaults

# 安装核心组件
echo "安装 UI 组件..."
pnpm dlx shadcn@latest add button input card dialog sheet tabs table dropdown-menu select textarea badge avatar -y

# 安装其他依赖
echo "安装工具库..."
pnpm add zustand @tanstack/react-query axios react-hook-form zod @hookform/resolvers react-dropzone mammoth pdf-parse date-fns lodash-es clsx tailwind-merge

# 安装 Supabase 客户端
pnpm add @supabase/supabase-js

# 安装类型定义
pnpm add -D @types/lodash-es @types/node @types/react @types/react-dom

echo ""
echo "📁 创建项目结构..."
echo "================================================"

# 创建目录结构
mkdir -p app/api/{auth,contracts,quotes,config}
mkdir -p "app/(auth)/login" "app/(auth)/register"
mkdir -p "app/(dashboard)/dashboard" "app/(dashboard)/contracts" "app/(dashboard)/quotes" "app/(dashboard)/admin"
mkdir -p components/{ui,forms,business,layout}
mkdir -p lib/{api,utils,hooks}
mkdir -p types
mkdir -p supabase/migrations

echo ""
echo "📝 创建配置文件..."
echo "================================================"

# 创建 .env.local
cat > .env.local << 'EOF'
# Supabase 配置 (云端或本地)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODAwMDAwMDAsImV4cCI6MTk5NTYwMDAwMH0.placeholder
SUPABASE_SERVICE_ROLE_KEY=placeholder

# 认证
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret-change-this-in-production
JWT_SECRET=your-jwt-secret-min-32-chars-change-this

# 本地 AI 模型 (OpenAI 兼容接口)
LOCAL_MODEL_URL=http://localhost:1234/v1
LOCAL_MODEL_NAME=local-model

# 云端模型备用（可选）
# CLOUD_API_KEY=your-cloud-api-key
# CLOUD_MODEL_NAME=claude-opus-4

# 应用配置
APP_BASE_URL=http://localhost:3000
NODE_ENV=development
EOF

# 创建数据库初始化 SQL
cat > supabase/migrations/001_initial_schema.sql << 'EOF'
-- 用户表扩展
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SALES',
  dept_id UUID,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 合同表
CREATE TABLE IF NOT EXISTS contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  parsed_text TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 审核结果表
CREATE TABLE IF NOT EXISTS contract_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  results JSONB,
  ai_result JSONB,
  rule_version INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- 报价单表
CREATE TABLE IF NOT EXISTS quotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_no TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  subtotal DECIMAL(15,2) DEFAULT 0,
  tax_amount DECIMAL(15,2) DEFAULT 0,
  discount_amount DECIMAL(15,2) DEFAULT 0,
  total_amount DECIMAL(15,2) DEFAULT 0,
  status TEXT DEFAULT 'DRAFT',
  valid_until DATE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 报价单项表
CREATE TABLE IF NOT EXISTS quote_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) DEFAULT 0,
  line_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- 启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;

-- 创建更新触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EOF

echo ""
echo "✨ 初始化完成！"
echo "================================================"
echo ""
echo -e "${GREEN}项目已创建在: $(pwd)${NC}"
echo ""
echo "下一步操作:"
echo ""
echo "1. 准备数据服务 (二选一):"
echo "   A. 本地: docker compose -f ../docker-compose.yml up -d"
echo "      （提供 Postgres + Supabase Auth 最小链路 + Redis + MinIO）"
echo "   B. 云端: 访问 https://supabase.com 创建项目并更新 .env.local"
echo ""
echo "2. 启动开发服务器:"
echo "   pnpm dev"
echo ""
echo "3. 打开浏览器访问 http://localhost:3000"
echo ""
echo -e "${YELLOW}注意: 请根据 FREEZE-SPEC.md 进行开发${NC}"
