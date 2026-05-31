#!/bin/bash
# Deploy script for Production
# REQ: GOV-DEPLOY-001

set -e

echo "🚀 Starting deployment..."

# 1. Validation
echo "📦 Running validations..."
make -C prisma validate
make -C prisma format
pnpm tsc --noEmit
pnpm lint

# 2. Database migration
echo "🗄️  Deploying database migrations..."
make -C prisma deploy

# 3. Build application
echo "🔨 Building application..."
rm -rf .next
pnpm build

# 4. Health check (if URL provided)
if [ -n "$HEALTH_CHECK_URL" ]; then
  echo "🏥 Running health check..."
  sleep 5
  curl -sf "$HEALTH_CHECK_URL" || {
    echo "❌ Health check failed!"
    exit 1
  }
fi

echo "✅ Deployment complete!"
