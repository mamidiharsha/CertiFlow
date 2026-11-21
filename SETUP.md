# CertiFlow — Setup Guide

## Prerequisites

| Tool             | Version | Purpose                     |
| ---------------- | ------- | --------------------------- |
| **Node.js**      | 20+     | Backend & frontend runtime  |
| **npm**          | 9+      | Package manager             |
| **Docker**       | 24+     | Container runtime           |
| **Docker Compose** | v2+   | Multi-container orchestration |

---

## Option 1 — Quick Start with Docker (Recommended)

One command starts the entire stack: PostgreSQL, Redis, backend, frontend, WhatsApp mock, and seeds demo data.

```bash
docker compose up --build
```

| URL                        | Service              |
| -------------------------- | -------------------- |
| http://localhost            | Frontend (via Nginx) |
| http://localhost:3000       | Backend API          |
| http://localhost:3001       | WhatsApp Mock        |
| http://localhost/verify     | Public Verification  |

The `seed` container runs once at startup, applies migrations, and loads demo data.  
Wait for the log line `✅ Seed completed` before using the app.

---

## Option 2 — Development Setup (Hot Reload)

### 1. Start infrastructure services

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts PostgreSQL (port 5432) and Redis (port 6379) only.

### 2. Start the backend

```bash
cd backend
npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Backend is running at **http://localhost:3000**.

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend is running at **http://localhost:5173** (Vite dev server with hot reload).  
The Vite config proxies `/api` to the backend automatically.

### 4. (Optional) Start the WhatsApp mock

```bash
cd backend
npm run mock-whatsapp
```

WhatsApp mock is running at **http://localhost:3001**.

---

## Running Tests

```bash
cd backend
npm test
```

Tests use Vitest and cover the approval workflow, certificate generation, and API endpoints.

---

## Demo Users

All demo users share the password **`password123`**.  
You can also use the **Demo User Switcher** (floating panel in the bottom-right corner) to switch instantly.

| Name     | Email                | Role               | Scope                       |
| -------- | -------------------- | ------------------ | --------------------------- |
| Anika    | anika@certiflow.in   | CENTRE             | Pragati Skills Academy, Pune |
| Dev      | dev@certiflow.in     | DISTRICT_OFFICER   | Pune district               |
| Meera    | meera@certiflow.in   | DISTRICT_OFFICER   | Pune district               |
| Kabir    | kabir@certiflow.in   | DISTRICT_OFFICER   | Pune district               |
| Neha     | neha@certiflow.in    | QUALITY_TEAM       | All large batches           |
| Farah    | farah@certiflow.in   | STATE_OFFICE       | All batches (final approval)|

### Demo Walk-through

1. **Log in as Anika** → Upload an Excel file or view the pre-seeded batches → Submit for approval.
2. **Switch to Dev** → Review the batch → Approve.
3. **Switch to Meera** → Approve the same batch (quorum = 2 district officers).
4. If the batch has ≥ 50 candidates, **switch to Neha** → Quality review → Approve.
5. **Switch to Farah** → Final state approval → Certificates are generated and delivered.
6. Open **http://localhost/verify** → Enter a certificate number to verify.

---

## Environment Variables

Copy the example file and customise if needed:

```bash
cp .env.example .env
```

See [`.env.example`](.env.example) for all variables and their defaults.

---

## Troubleshooting

### Port already in use

```bash
# Check what is using the port
# Windows
netstat -ano | findstr :3000
# macOS / Linux
lsof -i :3000
```

### Database connection refused

Make sure PostgreSQL is running:

```bash
docker compose -f docker-compose.dev.yml ps
```

If the container is not healthy, check logs:

```bash
docker compose -f docker-compose.dev.yml logs postgres
```

### Prisma migration errors

Reset the database and re-seed:

```bash
cd backend
npx prisma migrate reset --force
```

### Docker build fails

Clear Docker cache and rebuild:

```bash
docker compose down -v
docker compose up --build --force-recreate
```

### SSE events not arriving

- Check that the backend is running and healthy.
- In production (Docker), nginx must be configured without buffering for `/api/events/` — this is already handled in the provided `nginx.conf`.
- In dev mode, the Vite proxy handles SSE forwarding automatically.

### WhatsApp mock not responding

The mock server randomly returns errors (~30% of the time) on purpose to test retry logic. Check the backend logs for BullMQ retry behaviour.
