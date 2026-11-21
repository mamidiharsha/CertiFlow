# CertiFlow Production Deployment Plan

> **Status:** This document proposes a production architecture; it is not deployed infrastructure or a load-test result. The current Docker Compose setup is for local development and demos.

## Workload assumptions

- 100,000 registered users and approximately 10,000 daily active users.
- Up to 500 approved batches in an hour on results day.
- At 60 candidates per batch, that is about 30,000 certificates and 30,000 WhatsApp messages in an hour, or an average of 8.3 of each per second during that hour.
- Thousands of public verification requests per day, with short bursts.

The average rate is not a capacity guarantee. Worker throughput, database capacity, provider limits, retries, and burst shape need to be measured with representative load tests before launch.

## Proposed architecture and event flow

```text
 Candidates / staff / public
             |
       Route 53 + WAF
        /           \
 CloudFront         ALB (TLS)
 (web assets)          |
                   ECS Fargate
              API tasks (horizontal)
                |             |
                |             +--> Redis / BullMQ
                |                    |          |
                |                PDF jobs   WhatsApp jobs
                |                    |          |
                |               PDF workers  Delivery workers
                |                    |          |
                |                    v          v
                |                 Private S3   WhatsApp provider
                |
        RDS PostgreSQL (Multi-AZ)
          writer + optional read replica
                |
        audit and workflow data

 API / workers --> structured logs, metrics, traces, and alerts
 API --> Redis Pub/Sub --> SSE clients (best-effort live updates)
```

1. The API validates the request, checks the actor's role and scope, and writes the workflow change and audit record to PostgreSQL in a transaction.
2. After a successful state change, background work is queued for certificate generation or message delivery. Workers update delivery state in PostgreSQL and can publish live UI notifications.
3. Public verification reads the current certificate status from the database. Keep revocation checks on the primary, or use another design with a proven freshness guarantee, so a recently cancelled certificate is not shown as valid due to replica lag or stale cache.
4. For stronger production delivery guarantees, add a transactional outbox: write the event to an outbox table in the same transaction as the business change, then publish it to the queue and mark it delivered. The local demo uses queue reconciliation, not a transactional outbox.

## Where components run and why

| Component | Proposed hosting | Reason |
| --- | --- | --- |
| Frontend | Static assets in private S3 behind CloudFront | Low operational overhead and edge delivery for the web app. |
| DNS and edge protection | Route 53, CloudFront, and AWS WAF | Managed DNS, TLS entry points, and filtering/rate limits for public traffic. |
| API | ECS Fargate tasks behind an Application Load Balancer | Stateless API tasks can scale horizontally without managing servers. |
| Certificate and delivery workers | Separate ECS Fargate task services | PDF CPU load and provider network latency can scale independently from interactive API traffic. |
| Primary database | RDS PostgreSQL Multi-AZ | Managed backups and failover for authoritative workflow and audit data. |
| Read replica | RDS PostgreSQL read replica, if measurements justify it | Offload suitable read-heavy views; do not use for revocation-sensitive verification unless its staleness is safely handled. |
| Queue and live notifications | Managed Redis configured for BullMQ persistence and failover | Queue coordination and best-effort Pub/Sub without relying on process-local state. |
| Certificate files | Private S3 bucket with encryption and blocked public access | Durable storage separated from worker and API instances. |
| Secrets | AWS Secrets Manager or Parameter Store with KMS | Central rotation and access control for credentials and signing keys. |

Place the database, Redis, and worker tasks in private subnets. Only the load balancer and required edge services should accept public traffic. Use separate IAM roles for API, workers, and deployment tasks.

## Scaling and peak throughput

### API

- Run at least two API tasks across availability zones and scale on CPU, memory, request rate, and latency.
- Keep authentication and workflow state in shared services, not process memory, so any API task can handle the next request.
- Use connection pooling and explicit database connection budgets across API and worker task counts.

### Certificate workers

- Scale the certificate worker service using queue age and queue depth, not CPU alone.
- The target hour averages 8.3 PDF jobs per second. Benchmark PDF generation, database reads/writes, and S3 uploads together to calculate workers required with retry and failure headroom.
- Keep work idempotent: a retry should reuse or repair the certificate for a candidate, not issue a second certificate.
- The main likely limits are measured PDF throughput, database connections and write capacity, and storage/network throughput. Increase worker concurrency only while database latency and error rates remain healthy.

### WhatsApp workers

- Scale delivery workers separately, based on queue age/depth and provider response latency.
- Set a rate limiter below the provider's contracted quota and leave capacity for retries. Confirm the provider's burst and sustained limits before launch.
- Use provider idempotency keys or a delivery-status reconciliation API. A timeout can happen after the provider accepted a message; without provider support, retrying cannot guarantee exactly-once delivery.

### Clearing a backlog

Measure job arrival rate and processing rate. During a backlog, temporarily add worker capacity within database and provider limits; keep the API responsive by reserving database connections for it. Alert on oldest-job age and estimated drain time. If incoming work exceeds processing capacity for an extended period, communicate delivery delays rather than increasing concurrency without bounds.

Run load tests for the expected 8.3 jobs/second average and a higher burst profile. Include realistic PDF size, provider latency, transient errors, database contention, and worker restarts. Record achieved throughput and time to drain a known backlog before choosing production autoscaling limits.

## Failure handling

| Failure | Detection | Planned response |
| --- | --- | --- |
| Worker crashes or is replaced | BullMQ stalled jobs, worker health checks, and queue-age alerts | Retry idempotent jobs with bounded backoff. Reconcile approved batches and pending deliveries from PostgreSQL so work can be re-enqueued after a lost queue write. Escalate jobs that exhaust attempts. |
| Redis restart or failover | Redis health metrics, connection errors, and queue-age growth | Use managed failover and persistence settings appropriate for BullMQ. Workers reconnect; database records remain authoritative. Reconciliation restores eligible work. Test the actual Redis failover mode before relying on it. |
| WhatsApp outage or ambiguous timeout | Provider errors, timeout rate, and oldest delivery age | Retry with bounded exponential backoff and jitter; observe provider quotas. Use an idempotency/reconciliation contract. Expose terminal failures for an authorized manual retry and alert on sustained delivery delays. |
| Slow or unavailable PostgreSQL | Connection-pool saturation, query latency, CPU, locks, and health checks | Pool connections, tune slow queries and indexes, and scale the database based on measurements. Reduce worker concurrency to protect interactive traffic. Use Multi-AZ failover and retry transient errors safely. |
| S3 error or missing PDF | Upload/download errors and object checks | Retry uploads; regenerate a PDF from persisted certificate data when possible. Keep the bucket private and record download activity. |
| Batch remains untouched past its SLA | Scheduled query for pending batches and oldest pending age | Notify the assigned district/state team and escalate to a senior operational queue. The local app has a configurable SLA concept; production notifications and escalation need to be implemented and operated. |
| API task failure | ALB health checks and 5xx/latency alarms | Remove unhealthy tasks from rotation and let ECS replace them. Keep database transactions short and safe to retry. |

Use exponential backoff with jitter and a maximum attempt count. Preserve the final error and retry history for support staff; do not silently discard exhausted work.

## Certificate storage and access control

- Store generated PDFs in a private S3 bucket with public access blocked, encryption at rest, and TLS-only access.
- Give workers permission to write only to the certificate object prefix they need. The API should not expose general bucket credentials or public object URLs.
- Authorize a download using the signed-in candidate or an appropriately scoped certificate token, check that the certificate is still active, and issue a short-lived download link or proxy the file. A presigned URL remains usable until it expires, so use a short lifetime and account for that revocation window.
- Keep certificate numbers unique in PostgreSQL. Log issuance, cancellation, verification outcomes as appropriate, and downloads without logging bearer tokens or unnecessary personal information.
- Retain certificates and audit records according to the programme's legal retention policy; protect backups and test restoration.

## Monitoring, logs, and alerts

Use CloudWatch or an equivalent managed monitoring platform. Add dashboards for:

- API request volume, latency (p50/p95/p99), 4xx/5xx rates, and health.
- PostgreSQL CPU, storage, connections, lock waits, slow queries, and failovers.
- Redis availability, memory, connections, evictions, and failovers.
- Queue depth, oldest job age, retry count, completed/failed jobs, and estimated drain time for each worker type.
- PDF generation time and error rate; WhatsApp provider latency, timeout, failure, and delivery rate.
- Batch age by approval stage and SLA breaches.
- Public verification latency and error rate.

Send structured logs to a central service with request/job correlation IDs. Do not log full candidate data, passwords, authentication tokens, signed download URLs, or message bodies unless there is a documented operational need and appropriate controls.

Initial alert examples (tune after load testing):

- Any API/worker service unavailable or sustained API 5xx rate above 5%.
- Oldest certificate or delivery job exceeds the agreed service target, or queue depth grows continuously.
- WhatsApp failure/timeout rate exceeds the provider baseline.
- Database connection pool is near exhaustion, or p95 query latency exceeds the agreed threshold.
- Any batch exceeds the 48-hour review SLA.
- Certificate cancellation/verification errors or unusual verification traffic indicate a security or availability issue.

The current local demo does not include CloudWatch dashboards, alerting, tracing, or production on-call integration.

## Indicative monthly cost

Very rough AWS estimate in USD for one region and the architecture above:

| Area | Approximate monthly range |
| --- | ---: |
| API and worker compute | $400–$1,200 |
| Multi-AZ PostgreSQL and optional read replica | $500–$1,500 |
| Managed Redis | $100–$400 |
| S3, CloudFront, load balancer, and data transfer | $100–$500 |
| Logs, metrics, backups, and security services | $150–$600 |
| **Indicative total** | **about $1,250–$4,200/month** |

This is an order-of-magnitude planning estimate, not a quote. It excludes WhatsApp provider fees, taxes, support plans, unusual egress, and sustained peak worker scaling. Actual price depends on AWS region, retention, traffic, database sizing, and reserved capacity. Validate with the AWS Pricing Calculator after load tests and a region decision.

The main trade-offs are:

- **Fargate vs. EC2:** Fargate reduces server operations but can cost more at steady high utilization.
- **Multi-AZ database and Redis:** Higher availability costs more than a single-node demo, but reduces dependence on one host or availability zone.
- **Read replica:** Adds cost and operational complexity; use only when query load justifies it and verification freshness remains correct.
- **Worker headroom:** Scaling workers reduces delivery backlog, but is constrained by database capacity, provider quotas, and cost.
- **CloudFront and private S3:** Improve asset delivery and protect certificates, but add egress and request charges.

## Production readiness work

Before production, complete threat modeling and role/permission review; add rate limiting and operational monitoring; load-test the peak and failure scenarios; verify database and Redis recovery; define backup retention and restoration procedures; and implement the chosen provider's idempotency/reconciliation integration. The infrastructure and cost plan above should be revised using those results.
