# CertiFlow — Production Deployment Plan

> Scale targets: **100,000 registered users**, **~10,000 DAU**, peak of **500 batches/hour** generating **30,000 PDFs + 30,000 WhatsApp messages**, and **thousands of public verifications per day** in bursts.

---

## 1. Architecture Diagram

```
                            ┌───────────────────────────────────────────┐
                            │            CloudFront CDN                 │
                            │   (static frontend, /verify page)         │
                            └────────────────┬──────────────────────────┘
                                             │
                         ┌───────────────────▼───────────────────────┐
                         │          Application Load Balancer         │
                         │   (TLS termination, path-based routing)   │
                         └────┬──────────────┬──────────────┬────────┘
                              │              │              │
                    ┌─────────▼──┐  ┌────────▼───┐  ┌──────▼───────┐
                    │  API Srv 1 │  │  API Srv 2 │  │  API Srv 3   │
                    │  (Fargate) │  │  (Fargate) │  │  (Fargate)   │
                    └─────┬──────┘  └─────┬──────┘  └──────┬───────┘
                          │               │                │
              ┌───────────▼───────────────▼────────────────▼──────┐
              │                     Redis Cluster                  │
              │  ElastiCache (2-node) — sessions, pub/sub, cache  │
              └──────────┬──────────────────────────┬─────────────┘
                         │                          │
              ┌──────────▼──────────┐    ┌──────────▼──────────────┐
              │   BullMQ Queues     │    │   SSE pub/sub channels  │
              │  cert-gen │ whatsapp│    │   (real-time events)    │
              └─────┬─────┴────┬────┘    └─────────────────────────┘
                    │          │
        ┌───────────▼──┐  ┌───▼──────────────┐
        │ Cert Workers │  │ WhatsApp Workers  │
        │ 1→50 Fargate │  │ 1→20 Fargate     │
        │ (auto-scale) │  │ (auto-scale)     │
        └───────┬──────┘  └───┬──────────────┘
                │             │
        ┌───────▼──────┐  ┌──▼──────────────┐
        │  S3 Bucket   │  │  WhatsApp API   │
        │ (PDF certs)  │  │  (external)     │
        └──────────────┘  └─────────────────┘
              │
    ┌─────────▼──────────────────────────────────────────┐
    │            PostgreSQL (RDS Multi-AZ)                │
    │  Primary (writes) ──────► Read Replica (reads)     │
    │  db.r6g.large              (verification queries)  │
    └────────────────────────────────────────────────────┘
```

---

## 2. Component Hosting (AWS)

| Component          | Service                | Spec                                                        | Why                                              |
| ------------------ | ---------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| **Frontend**       | CloudFront + S3        | Static build artifacts                                      | Global edge caching, zero server maintenance     |
| **API Servers**    | ECS Fargate            | 3 instances min, auto-scale on CPU > 60% / 500 req/s        | Stateless; Fargate = zero AMI/patching overhead  |
| **Cert Workers**   | ECS Fargate            | 1 baseline, scale 1→50 on queue depth                       | Separate task def isolates CPU-heavy PDF gen     |
| **WhatsApp Workers** | ECS Fargate          | 1 baseline, scale 1→20 on queue depth                       | I/O-bound; separate scaling profile              |
| **PostgreSQL**     | RDS PostgreSQL 16      | db.r6g.large, Multi-AZ, 100 GB gp3, 1 read replica         | Managed backups, failover, read scaling          |
| **Redis**          | ElastiCache Redis 7    | cache.r6g.large, 2-node cluster (primary + replica)         | BullMQ persistence, pub/sub, verification cache  |
| **File Storage**   | S3 Standard            | Presigned URLs for PDF access (1-hour expiry)               | Unlimited storage, IAM-controlled access         |
| **Load Balancer**  | Application LB         | TLS termination, path-based routing, WebSocket/SSE support  | Health checks, sticky sessions not needed        |
| **DNS**            | Route 53               | A-alias to CloudFront + ALB                                 | Low-latency DNS, health-check routing            |

---

## 3. Scaling Strategy

### API Servers

- **Horizontal**, stateless — no session affinity needed (JWT auth, Redis for state).
- Auto-scale on **CPU > 60%** or **request count > 500/target**.
- Min 3, max 10 instances.
- Each instance: 1 vCPU, 2 GB RAM.

### Certificate Generation Workers

- **Bottleneck**: PDF generation ~500ms per certificate using PDFKit.
- Peak demand: 30,000 PDFs in a 1-hour window → need ~500 concurrent workers.
- Auto-scale on **queue depth** (target: < 1,000 pending jobs).
- Scale range: **1 → 50 Fargate tasks**, each running 10 concurrent BullMQ workers.
- Queue backlog clearance: 50 tasks × 10 workers × 2 PDFs/s = **1,000 PDFs/s** → 30K in ~30 seconds.

### WhatsApp Delivery Workers

- I/O-bound (HTTP calls to WhatsApp API, ~200ms each).
- Auto-scale on **queue depth** separately from cert workers.
- Scale range: **1 → 20 Fargate tasks**.
- BullMQ rate limiter: max 100 messages/second (WhatsApp API rate limit).

### Verification Endpoint

- **Redis cache** (TTL 5 min for ACTIVE, no cache for CANCELLED) absorbs burst reads.
- **Read replica** handles cache-miss queries — no load on primary.
- Expected: 95%+ cache hit rate during bursts (certificate numbers are shared/linked).

### Database

- **Write path**: Primary only. PgBouncer connection pooling (pool_mode=transaction, max 100 connections).
- **Read path**: Verification queries → read replica. Dashboard aggregations → read replica.
- **Indexing**: certificate_number (unique), batch status, delivery idempotency_key.

---

## 4. Failure Handling

| Failure                     | Detection                     | Response                                                                                     |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| **Worker crash**            | BullMQ stalled job detection  | Auto-retry with exponential backoff (1m, 5m, 30m). Job visibility timeout = 60s.             |
| **Redis restart**           | ElastiCache failover          | BullMQ queues are durable (Redis AOF persistence). SSE clients auto-reconnect in 5s.         |
| **PostgreSQL failover**     | RDS Multi-AZ automatic        | 60–120s failover. Connection pool retries. Write operations fail fast with retry hint.        |
| **WhatsApp API outage**     | HTTP 5xx / timeout            | Exponential backoff (1m, 5m, 30m). Dead letter queue after 3 failures. Manual retry dashboard. |
| **S3 unavailable**          | HTTP error on presigned URL   | PDFs are regenerable from DB data. Queue a re-generation job on access failure.               |
| **ALB health check fail**   | /health endpoint              | Unhealthy instance removed from target group. ECS replaces it.                                |
| **Slow DB queries**         | P95 latency > 500ms alert     | PgBouncer limits concurrency. Read replica absorbs read load. Query plan analysis.            |

### Dead Letter Queue (DLQ) Strategy

```
WhatsApp Queue ──3 failures──► DLQ
                                │
                                ▼
                   Admin Dashboard: manual retry
                   Alerting: PagerDuty notification
```

- DLQ jobs retain full context (certificate ID, phone, message).
- Admin dashboard allows bulk retry or individual re-dispatch.
- DLQ depth > 100 triggers PagerDuty alert.

---

## 5. Certificate Storage

| Aspect               | Implementation                                                     |
| --------------------- | ------------------------------------------------------------------ |
| **Storage**           | S3 Standard, server-side encryption (AES-256)                      |
| **Access**            | Presigned URLs with 1-hour expiry, generated on-demand              |
| **Public access**     | Disabled. All access via presigned URLs only.                       |
| **Bucket policy**     | Deny all public access. IAM role for backend/workers only.          |
| **Audit**             | S3 access logging enabled. Download events logged to AuditLog table. |
| **Lifecycle**         | No automatic deletion. Archive to S3 Glacier after 2 years.         |
| **Re-generation**     | PDFs can be regenerated from DB data if S3 object is lost.          |

### Presigned URL Flow

```
Client ──GET /api/certificates/:id/download──► API Server
                                                   │
                                     Generate presigned URL (1h TTL)
                                                   │
                                     302 Redirect ─► S3 (direct download)
```

---

## 6. Monitoring & Alerting

### Metrics (Prometheus + Grafana)

| Metric                        | Source          | Dashboard Panel          |
| ----------------------------- | --------------- | ------------------------ |
| Request latency (P50/P95/P99) | API servers     | API Performance          |
| Request error rate             | API servers     | API Health               |
| Queue depth (cert/whatsapp)    | Redis/BullMQ    | Queue Monitor            |
| Jobs processed/min             | Workers         | Worker Throughput        |
| Delivery success rate          | WhatsApp worker | Delivery Dashboard       |
| DB connection pool usage       | PgBouncer       | Database Health          |
| Cache hit rate                 | Redis           | Verification Performance |
| Active SSE connections         | API servers     | Real-time Status         |

### Logging

- **Format**: Structured JSON (timestamp, level, service, requestId, userId, message, metadata).
- **Destination**: CloudWatch Logs → CloudWatch Insights for querying.
- **Retention**: 30 days hot, 1 year archived.
- **Correlation**: Every request gets a unique `requestId` header, propagated through queues.

### Alerts (PagerDuty)

| Alert                           | Threshold        | Severity  | Action                               |
| ------------------------------- | ---------------- | --------- | ------------------------------------ |
| Queue depth > 10,000            | 5 min sustained  | P2        | Scale workers, investigate backlog   |
| API error rate > 5%             | 5 min window     | P1        | Investigate, check dependencies      |
| Delivery failure rate > 10%     | 15 min window    | P2        | Check WhatsApp API, review DLQ       |
| DLQ depth > 100                 | Any              | P2        | Manual triage required               |
| DB CPU > 80%                    | 10 min sustained | P2        | Scale read replica, check queries    |
| DB connection pool exhausted    | Any              | P1        | Increase pool, check connection leaks|
| Health check failures           | 3 consecutive    | P1        | Auto-replaced by ECS, investigate    |
| Batch stuck (SLA breached)      | Hourly check     | P3        | Notify approvers, escalate           |

### Health Checks

Every service exposes `GET /health`:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "checks": {
    "database": "connected",
    "redis": "connected",
    "queues": "active"
  }
}
```

---

## 7. Cost Estimate

| Component                | Service                 | Monthly Cost | Notes                                |
| ------------------------ | ----------------------- | ------------ | ------------------------------------ |
| **API Servers**          | ECS Fargate (3 tasks)   | $150         | 1 vCPU, 2 GB each                   |
| **Cert Workers**         | ECS Fargate (1–50)      | $150         | Average 5 tasks; spikes at peak     |
| **WhatsApp Workers**     | ECS Fargate (1–20)      | $100         | Average 3 tasks                     |
| **PostgreSQL**           | RDS db.r6g.large Multi-AZ | $200       | Includes read replica               |
| **Redis**                | ElastiCache cache.r6g.large | $100     | 2-node cluster                      |
| **S3 Storage**           | S3 Standard             | $20          | ~10 GB (100K certs × 100 KB)        |
| **CloudFront**           | CDN                     | $30          | Static frontend, low transfer       |
| **ALB**                  | Application LB          | $20          | Fixed cost + LCU                    |
| **Data Transfer**        | AWS                     | $20          | Internal mostly free                |
| **Monitoring**           | CloudWatch + Grafana    | $30          | Logs, metrics, dashboards           |
| **Total (steady state)** |                         | **~$820/mo** |                                      |
| **Total (sustained peak)** |                       | **~$1,500/mo** | Workers scaled to max              |

### Trade-offs

- **Fargate vs EC2**: Fargate costs ~30% more but eliminates all patching, AMI management, and capacity planning. For a team of this size, ops savings outweigh cost.
- **RDS vs self-managed PostgreSQL**: RDS costs more but provides automated backups, failover, and patching.
- **ElastiCache vs self-managed Redis**: Same reasoning — operational simplicity wins for a small team.

### Cost Optimisation Path

1. **Reserved Instances**: Commit to 1-year RI for RDS and ElastiCache → ~40% savings (~$120/mo saved).
2. **Fargate Spot**: Use Spot for workers (interruptible, jobs are idempotent) → ~70% savings on worker compute.
3. **S3 Intelligent-Tiering**: Auto-archive old certificates → negligible storage costs.
4. **With optimisations**: Total drops to **~$550/mo** steady state.

---

## 8. Security Considerations

| Aspect                  | Implementation                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| **TLS**                 | Enforced at ALB (ACM certificate). HTTP → HTTPS redirect.                   |
| **Authentication**      | JWT with httpOnly cookies. Token expiry: 24h. No refresh tokens (hackathon). |
| **Authorization**       | RBAC middleware on every route. Role checks in business logic.               |
| **Secrets**             | AWS Secrets Manager for JWT_SECRET, DB credentials. Not in env vars.         |
| **Network**             | VPC with private subnets for DB/Redis. API servers in public subnet.         |
| **Input Validation**    | Zod schemas on every endpoint. Parameterised queries via Prisma (no SQL injection). |
| **Rate Limiting**       | ALB-level rate limiting. Per-IP throttle on /verify (1000 req/min).          |
| **Audit Trail**         | Every mutation logged with userId, action, IP, timestamp. Immutable.         |

---

## 9. Deployment Pipeline

```
  Developer Push
       │
       ▼
  GitHub Actions CI
  ├─ Lint + Type Check
  ├─ Unit Tests (Vitest)
  ├─ Build Docker Images
  └─ Push to ECR
       │
       ▼
  Staging Deploy (auto)
  ├─ Run Prisma Migrations
  ├─ Smoke Tests
  └─ Manual QA Gate
       │
       ▼
  Production Deploy (manual approval)
  ├─ Blue/Green via ECS
  ├─ Prisma Migrate Deploy
  ├─ Health Check Validation
  └─ Rollback on failure
```

### Database Migrations

- Prisma migrations are **forward-only** in production.
- Run `npx prisma migrate deploy` as a pre-deploy step (ECS task).
- Breaking schema changes require a two-phase approach: add new columns first, deploy code, then remove old columns.

---

## 10. Disaster Recovery

| Scenario              | RTO       | RPO       | Strategy                                                |
| --------------------- | --------- | --------- | ------------------------------------------------------- |
| **Single AZ outage**  | < 2 min   | 0         | Multi-AZ RDS failover, ECS re-places tasks              |
| **Region outage**     | < 1 hour  | < 5 min   | Cross-region RDS replica, S3 cross-region replication    |
| **Data corruption**   | < 30 min  | < 1 hour  | RDS point-in-time recovery (5-min granularity)           |
| **Full rebuild**      | < 2 hours | < 1 hour  | Infrastructure as Code (Terraform), automated seeding    |
