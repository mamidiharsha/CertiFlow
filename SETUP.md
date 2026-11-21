# CertiFlow Setup Guide

This guide covers the recommended Docker setup and an optional development setup with hot reload. The Docker route is closest to the demo environment.

## Requirements

- Docker Desktop with Docker Compose v2.
- Node.js 20+ and npm 9+ only if using the development setup or running backend tests outside Docker.
- Ports 80, 3000, 3001, 5432, and 6379 available for the full Docker setup.

## Run the complete application with Docker

1. Open PowerShell in the repository folder:

   ```powershell
   Set-Location C:\path\to\CertiFlow
   ```

2. Build the images and start the services:

   ```powershell
   docker compose up --build
   ```

   To run it in the background instead:

   ```powershell
   docker compose up --build -d
   ```

3. Wait until the `seed` service reports `Seed completed`. It applies Prisma migrations and creates the demo users. The seed container then exits successfully; that is expected.

4. Open the application at [http://localhost](http://localhost).

| Address | Purpose |
| --- | --- |
| [http://localhost](http://localhost) | Web application |
| [http://localhost/verify](http://localhost/verify) | Public certificate verification |
| [http://localhost:3000/api/health](http://localhost:3000/api/health) | Backend health check |
| [http://localhost:3001/health](http://localhost:3001/health) | WhatsApp mock health check |

### Stop the application

Use `Ctrl+C` if Compose is running in the foreground. If it is running in the background:

```powershell
docker compose down
```

This keeps named volumes, including database data and generated PDFs. **Do not add `-v` unless you intend to delete those volumes and their data.**

## Demo credentials and walkthrough

Every seeded user uses the password `password123`. You can sign in with these accounts or use the demo user switcher in the app.

| Name | Email | Role |
| --- | --- | --- |
| Anika | `anika@certiflow.in` | Training centre |
| Dev | `dev@certiflow.in` | District officer |
| Meera | `meera@certiflow.in` | District officer |
| Kabir | `kabir@certiflow.in` | District officer |
| Neha | `neha@certiflow.in` | Quality team |
| Farah | `farah@certiflow.in` | State office |

Suggested demo:

1. Sign in as Anika. Upload a spreadsheet and submit the resulting batch for approval. Required columns are `name`, `phone`, `course`, and `score`; use a 10-digit phone number and a score from 0 to 100. Invalid rows are reported, and the batch is not partially saved.
2. Open that batch as Dev and approve it.
3. Switch to Meera and approve the same batch. Two different district officers are required.
4. For a batch with 50 or more candidates, switch to Neha and approve it at quality review. Smaller batches skip this stage.
5. Switch to Farah and give final approval. Certificate creation and WhatsApp delivery are background tasks, so allow a short time for them to complete.
6. Look up the certificate number in the certificate list, then verify it at [http://localhost/verify](http://localhost/verify) without signing in.
7. Optionally test sending a batch back for correction and resubmitting it as Anika. On resubmission, prior decisions remain in the audit history but are marked superseded, and the approval process restarts with district review.
8. Optionally cancel an issued certificate as Farah and verify it again. The public page should report that it is cancelled.

The WhatsApp mock deliberately simulates delivery failures and timeouts. Check delivery status in the application and use the available retry action if a delivery fails.

## Development setup (hot reload)

Use this route if you want to run the frontend and backend directly on your machine while Docker provides PostgreSQL and Redis.

1. Start the development infrastructure from the repository root:

   ```powershell
   docker compose -f docker-compose.dev.yml up -d
   ```

2. In a new PowerShell window, configure and start the backend:

   ```powershell
   Set-Location C:\path\to\CertiFlow\backend
   Copy-Item .env.example .env
   npm install
   npx prisma migrate deploy
   npx prisma db seed
   npm run dev
   ```

   The backend listens at `http://localhost:3000`.

3. In another PowerShell window, start the frontend:

   ```powershell
   Set-Location C:\path\to\CertiFlow\frontend
   npm install
   npm run dev
   ```

   Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The Vite configuration proxies API requests to the backend.

4. If you want to exercise background WhatsApp delivery in development, start the mock in another window:

   ```powershell
   Set-Location C:\path\to\CertiFlow\backend
   npm run mock-whatsapp
   ```

   The mock listens at `http://localhost:3001`. Ensure the backend `.env` points `WHATSAPP_API_URL` at this local mock.

## Run backend checks

```powershell
Set-Location C:\path\to\CertiFlow\backend
npm test
npm run build
```

To validate the Prisma schema:

```powershell
npx prisma validate
```

## Troubleshooting

### Docker is not recognized or unavailable

Start Docker Desktop, wait until its engine is running, then open a new PowerShell terminal and check:

```powershell
docker version
docker compose version
```

### Check containers and logs

```powershell
docker compose ps --all
docker compose logs --tail 100 seed backend frontend
```

The `seed` service should exit with code 0 after migrations and demo data are applied. Backend and frontend should remain running.

### A port is already in use

Check the port (for example, port 3000) in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
```

Stop the conflicting application or adjust the host-side port mapping in `docker-compose.yml`.

### Build or startup problem

Review the relevant service logs, then rebuild without deleting stored data:

```powershell
docker compose down
docker compose up --build
```

`docker compose down -v` deletes the database, Redis, and generated-certificate volumes. Use it only when intentionally resetting the local environment.

### WhatsApp delivery does not succeed immediately

This is expected sometimes: the local mock intentionally simulates failures and timeouts. Check delivery status and backend logs; retry from the state-office certificate screen when available.

### Live updates are missing

Check that the backend is running. Notifications are best-effort while connected; after reconnecting, the application refreshes its current data.
