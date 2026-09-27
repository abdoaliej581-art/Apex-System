# APEX SYSTEM — Deployment Guide

## Prerequisites
- Node.js ≥ 20
- PostgreSQL database (Supabase, Railway, Neon, or self-hosted)
- SMTP credentials (optional — mail silently skips if unconfigured)

---

## 1. Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Required
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DB_NAME"
NEXTAUTH_SECRET="generate with: openssl rand -base64 32"
NEXTAUTH_URL="https://your-domain.com"

# Optional — mail will silently skip if not set
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your@email.com"
SMTP_PASS="your-app-password"
SMTP_FROM="APEX System <your@email.com>"
```

---

## 2. First-Time Database Setup (New PostgreSQL)

```bash
# Install dependencies
npm install

# Apply the baseline migration (creates all tables)
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Seed roles, permissions, and team accounts
npm run db:seed
```

**Seeded login credentials:**

| Email | Password | Role |
|-------|----------|------|
| admin@apex.system | Apex@2026 | Super Admin |
| sales@apex.system | Apex@2026 | Sales |
| pm@apex.system | Apex@2026 | Project Manager |
| dev@apex.system | Apex@2026 | Developer |

⚠️ **Change all passwords immediately after first login.**

---

## 3. Upgrading an Existing Database

If the database already has tables (e.g., from `db:push`), mark the baseline as already applied before running new migrations:

```bash
# Mark the baseline as applied without re-running it
npx prisma migrate resolve --applied 0001_baseline

# Then deploy any future migrations normally
npx prisma migrate deploy
```

---

## 4. Future Schema Changes

Always use migrations going forward — never use `db:push` on production:

```bash
# 1. Edit prisma/schema.prisma
# 2. Create a migration (generates SQL, applies to dev DB)
npx prisma migrate dev --name describe_your_change

# 3. Deploy to production
npx prisma migrate deploy
```

---

## 5. Build & Start

```bash
# Build
npm run build

# Start (standalone)
npm start
```

Or with a process manager:

```bash
pm2 start "npm start" --name apex-system
```

---

## 6. Development

```bash
npm run dev        # Start dev server on port 3000
npm run db:push    # Push schema changes to dev DB (SQLite or Postgres)
npm run db:seed    # Re-seed roles and users
npm run db:reset   # DANGER: drops and re-creates the dev DB
```

---

## 7. Client Portal Account Setup

Portal users need a matching `User` record linked to a `Client`:

1. Go to **Settings → Users** → Create user with role `CLIENT`
2. In the user form, select the client company they belong to
3. Share the portal login URL: `https://your-domain.com`

The portal user will see only their own projects, invoices, and tickets.
