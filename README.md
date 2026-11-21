# CertiFlow

## Requirements note

Training centres need to submit candidate batches for certification. District officers review each batch, with agreement from two different officers. Batches of 50 or more candidates also need quality review, and the state office makes the final decision. Candidates need a certificate they can download, while employers and the public need a way to verify one without signing in.

The workflow records decisions and supports corrections, certificate cancellation, and delivery retries. A spreadsheet is accepted only when all its candidate rows pass validation. When a batch is sent back and resubmitted, earlier decisions remain in the audit history but are superseded, and review starts again at the district stage.

## What this project does

CertiFlow is a certificate issuance and verification application for a fictional skills programme. It includes:

- Role-based screens for a training centre, district officers, the quality team, and state office.
- Spreadsheet batch upload, validation, review, approval, rejection, and send-back flows.
- Certificate PDF generation and a local stand-in for WhatsApp delivery.
- A public certificate verification page that does not require an account.
- Audit history and live UI notifications.

## Technology and design

- **Frontend:** React, TypeScript, and Vite.
- **Backend:** Node.js, Express, and TypeScript.
- **Database:** PostgreSQL with Prisma migrations.
- **Background work:** BullMQ and Redis for certificate generation and WhatsApp delivery retries.
- **Local runtime:** Docker Compose starts the database, Redis, API, frontend, WhatsApp mock, and demo-data seed.

PostgreSQL is the source of truth. Approval decisions are written in transactions that lock the batch row, and a database index prevents duplicate active decisions by the same reviewer at the same stage. Certificate and message jobs run in the background so these slower operations do not block an approval request. The WhatsApp mock stores idempotency keys in Redis and simulates failures and timeouts.

  The local backend runs the API and workers together, and PDFs are stored in a Docker volume. The deployment proposal describes how these components could be separated and operated at scale.

## Run locally

Install Docker Desktop with Docker Compose, then run this from the repository root:

```powershell
docker compose up --build
```

Wait for `Seed completed` in the logs, then open [http://localhost](http://localhost). For detailed instructions, demo credentials, and troubleshooting, see [SETUP.md](./SETUP.md).

## Demo accounts

The local demo seeds six users, all with the password `password123`. A demo user switcher is available in the application.

| Name | Email | Role |
| --- | --- | --- |
| Anika | `anika@certiflow.in` | Training centre |
| Dev | `dev@certiflow.in` | District officer |
| Meera | `meera@certiflow.in` | District officer |
| Kabir | `kabir@certiflow.in` | District officer |
| Neha | `neha@certiflow.in` | Quality team |
| Farah | `farah@certiflow.in` | State office |

The user switcher is intended only for the local demo and is disabled by default outside demo configuration.

## Tests and checks

From the `backend` directory:

```powershell
npm test
npm run build
```

The automated tests cover spreadsheet validation without partial writes, duplicate and concurrent district approvals, and privacy-safe verification after cancellation. These tests do not replace a full browser walkthrough against Docker services.

## AI assistance

AI tools were used during some parts development. I reviewed the generated changes and checked them with the automated tests, TypeScript builds, Prisma validation, and a local Docker Compose startup. I will explain the implementation and its limitations during review.

## Known limitations

- WhatsApp is simulated; there is no real messaging account or provider integration.
- External message delivery cannot be guaranteed exactly once unless the real provider offers idempotency or delivery reconciliation.
- Local PDFs and database data are stored in Docker volumes. Removing volumes deletes that data.
- Redis Pub/Sub notifications are best-effort. The UI refetches current data after reconnecting rather than replaying missed events.
- Production monitoring, rate limiting, private object storage, and independent worker deployment are proposals in [DEPLOYMENT.md](./DEPLOYMENT.md), not features of the local demo.

## Deployment plan

See [DEPLOYMENT.md](./DEPLOYMENT.md) for a proposed production architecture, scaling approach, failure handling, access controls, monitoring, and an indicative cost range.
