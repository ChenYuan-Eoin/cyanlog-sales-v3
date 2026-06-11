# Database Migration Scripts
# REQ: GOV-DB-001

# Local database setup
dev-setup:
	echo "🔄 Setting up local database..."
	pnpm prisma migrate dev --name init

# Deploy migrations to production
deploy:
	echo "🚀 Deploying migrations..."
	pnpm prisma migrate deploy

# Generate Prisma client (run after schema changes)
generate:
	pnpm prisma generate

# Open Prisma Studio
studio:
	pnpm prisma studio

# Run DB seed
seed:
	pnpm ts-node prisma/seed.ts

# Create a new migration
migrate-create:
	@read -p "Migration name: " name; \
	pnpm prisma migrate dev --name $$name

# Reset database (DANGER - for dev only)
reset:
	@echo "⚠️  This will reset your database!"
	@read -p "Type 'yes' to confirm: " confirm; \
	if [ "$$confirm" = "yes" ]; then \
		pnpm prisma migrate reset --force; \
	else \
		echo "Cancelled."; \
	fi

# Validate schema
validate:
	pnpm prisma validate

# Format schema
format:
	pnpm prisma format

# Full CI check
ci-check: validate format
	@echo "✅ Schema validation complete"
