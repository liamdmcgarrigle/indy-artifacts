# Q3 2026 Platform Health Review

Infrastructure team, Larkspur Cloud. Covers 1 July to 30 September 2026. Weekly data runs W1 to W13, where W1 starts Monday 29 June. All comparisons are against Q2 2026.

## Executive summary

Traffic grew 9% quarter on quarter to 10.69 billion requests, and average weekly p95 API latency fell to 184 ms after the edge cache rollout in August. Reliability went the other way: we had 8 incidents against 5 in Q2, including two Sev-1 outages, and the 3 September billing queue backlog alone lasted almost ten hours. Cloud spend rose 7.2% to $1060k for the quarter, with database and network costs growing about 15% each. We need a decision on the Postgres migration by 15 October so the work can start in Q4.

## Headline numbers

Values are Q3 totals or averages. Deltas are against Q2. Items marked **(bad)** moved in the wrong direction.

- Total API requests: 10.69 billion (+0.88 billion, +9.0%)
- p95 API latency (weekly average): 184 ms (−14 ms)
- Availability (core API): 99.94% (−0.03 pts) **(bad)**
- Overall error rate (5xx): 0.21% (+0.04 pts) **(bad)**
- Cloud spend: $1060k (+$71k, +7.2%) **(bad)**
- Incidents: 8 (+3) **(bad)**
- Mean time to restore: 2h 19m (+67 min) **(bad)**
- Production deploys: 553 (+55), change failure rate 5.1% (+0.2 pts) **(bad)**

## Charts

### 1. Weekly request volume by region

Shows steady growth in all three regions, with ap-south growing fastest; a stacked area or stacked bar chart suits it. Values are millions of requests.

| Week | Week of | us-east | eu-west | ap-south | Total |
|---|---|---|---|---|---|
| W1 | Jun 29 | 412 | 236 | 98 | 746 |
| W2 | Jul 6 | 418 | 239 | 101 | 758 |
| W3 | Jul 13 | 425 | 244 | 104 | 773 |
| W4 | Jul 20 | 431 | 247 | 109 | 787 |
| W5 | Jul 27 | 428 | 251 | 112 | 791 |
| W6 | Aug 3 | 440 | 249 | 115 | 804 |
| W7 | Aug 10 | 446 | 256 | 119 | 821 |
| W8 | Aug 17 | 452 | 261 | 122 | 835 |
| W9 | Aug 24 | 449 | 266 | 127 | 842 |
| W10 | Aug 31 | 461 | 270 | 131 | 862 |
| W11 | Sep 7 | 470 | 268 | 136 | 874 |
| W12 | Sep 14 | 476 | 277 | 139 | 892 |
| W13 | Sep 21 | 483 | 282 | 144 | 909 |

Quarter totals: us-east 5,791M, eu-west 3,346M, ap-south 1,557M, all regions 10,694M.

### 2. API latency percentiles by week

Shows p50, p95 and p99 trending down, with the W5 spike from the 29 July gateway incident; a multi-line chart suits it. Values are milliseconds.

| Week | p50 | p95 | p99 |
|---|---|---|---|
| W1 | 48 | 194 | 512 |
| W2 | 47 | 191 | 498 |
| W3 | 47 | 189 | 491 |
| W4 | 46 | 186 | 480 |
| W5 | 49 | 231 | 688 |
| W6 | 46 | 184 | 472 |
| W7 | 45 | 181 | 466 |
| W8 | 45 | 178 | 455 |
| W9 | 44 | 176 | 448 |
| W10 | 44 | 174 | 441 |
| W11 | 43 | 171 | 436 |
| W12 | 43 | 169 | 429 |
| W13 | 42 | 168 | 421 |

### 3. Error rate by service

Shows which services return the most 5xx errors, against the 0.25% error budget line; a horizontal bar chart suits it.

| Service | Q3 error rate (%) | Q2 error rate (%) | Over 0.25% budget |
|---|---|---|---|
| billing-worker | 0.58 | 0.41 | yes |
| payments | 0.39 | 0.27 | yes |
| api-gateway | 0.24 | 0.19 | no |
| reporting | 0.22 | 0.24 | no |
| notifications | 0.18 | 0.15 | no |
| auth | 0.16 | 0.08 | no |
| search | 0.12 | 0.14 | no |
| object-storage | 0.09 | 0.06 | no |

### 4. Monthly cloud cost by category

Shows spend rising every month, with database and network growing faster than compute; a stacked bar chart suits it. Values are thousands of US dollars.

| Month | Compute | Storage | Network | Database | Other | Total |
|---|---|---|---|---|---|---|
| Jan | 171 | 39 | 31 | 55 | 16 | 312 |
| Feb | 172 | 40 | 32 | 56 | 16 | 316 |
| Mar | 174 | 40 | 32 | 57 | 17 | 320 |
| Apr | 176 | 41 | 33 | 58 | 17 | 325 |
| May | 177 | 42 | 34 | 59 | 17 | 329 |
| Jun | 179 | 42 | 35 | 61 | 18 | 335 |
| Jul | 182 | 43 | 37 | 65 | 18 | 345 |
| Aug | 184 | 44 | 39 | 68 | 18 | 353 |
| Sep | 186 | 45 | 41 | 71 | 19 | 362 |

Q2 total $989k; Q3 total $1060k.

### 5. Incidents per month by severity

Shows the incident count by month split by severity, including the rise in Q3; a stacked bar chart suits it.

| Month | Sev-1 | Sev-2 | Sev-3 | Total |
|---|---|---|---|---|
| Jan | 1 | 1 | 1 | 3 |
| Feb | 0 | 1 | 1 | 2 |
| Mar | 1 | 1 | 2 | 4 |
| Apr | 0 | 1 | 1 | 2 |
| May | 0 | 0 | 1 | 1 |
| Jun | 0 | 1 | 1 | 2 |
| Jul | 0 | 1 | 1 | 2 |
| Aug | 1 | 1 | 1 | 3 |
| Sep | 1 | 1 | 1 | 3 |

### 6. Deploys per week and change failure rate

Shows deploy volume as bars with change failure rate as a line on a second axis; a combined bar and line chart suits it. W10 was a deploy freeze after the 3 September incident.

| Week | Deploys | Failed deploys | Change failure rate (%) |
|---|---|---|---|
| W1 | 38 | 2 | 5.3 |
| W2 | 41 | 3 | 7.3 |
| W3 | 44 | 2 | 4.5 |
| W4 | 40 | 2 | 5.0 |
| W5 | 36 | 4 | 11.1 |
| W6 | 45 | 2 | 4.4 |
| W7 | 47 | 2 | 4.3 |
| W8 | 43 | 1 | 2.3 |
| W9 | 46 | 2 | 4.3 |
| W10 | 31 | 3 | 9.7 |
| W11 | 44 | 2 | 4.5 |
| W12 | 48 | 1 | 2.1 |
| W13 | 50 | 2 | 4.0 |

Quarter: 553 deploys, 28 failed, change failure rate 5.1%. Q2: 498 deploys, 24 failed, 4.8%.

### 7. Cache hit rate against database CPU

Shows that database CPU falls as the Redis cache hit rate rises, which is the case for the August cache work; a scatter plot suits it. Each point is one sampled weekday at 14:00 UTC.

| Sample date | Cache hit rate (%) | DB primary CPU (%) |
|---|---|---|
| Jul 1 | 71 | 78 |
| Jul 8 | 72 | 76 |
| Jul 15 | 70 | 81 |
| Jul 22 | 74 | 73 |
| Jul 29 | 73 | 79 |
| Aug 5 | 77 | 69 |
| Aug 12 | 80 | 64 |
| Aug 19 | 82 | 61 |
| Aug 26 | 83 | 62 |
| Sep 2 | 85 | 57 |
| Sep 3 | 79 | 88 |
| Sep 9 | 87 | 54 |
| Sep 16 | 88 | 56 |
| Sep 23 | 90 | 49 |
| Sep 30 | 91 | 47 |

The Sep 3 point is an outlier: billing retries drove database load during the queue incident.

### 8. Share of traffic by client type

Shows how Q3 requests split across clients; a donut chart suits it. Shares sum to 100%.

| Client type | Share of requests (%) | Requests (millions) |
|---|---|---|
| Web app | 41 | 4385 |
| iOS app | 22 | 2353 |
| Android app | 19 | 2032 |
| Public API (customers) | 14 | 1497 |
| Internal services | 4 | 428 |

### 9. Billing queue backlog on 3 September

Shows the backlog building from 06:00, peaking mid-afternoon and draining by late evening; a line or area chart suits it, with the incident window (05:50 to 15:30 UTC) shaded. Values are thousands of messages waiting.

| Hour (UTC) | Backlog (thousands) |
|---|---|
| 00:00 | 3 |
| 01:00 | 2 |
| 02:00 | 2 |
| 03:00 | 3 |
| 04:00 | 4 |
| 05:00 | 6 |
| 06:00 | 48 |
| 07:00 | 152 |
| 08:00 | 286 |
| 09:00 | 421 |
| 10:00 | 563 |
| 11:00 | 702 |
| 12:00 | 845 |
| 13:00 | 968 |
| 14:00 | 1072 |
| 15:00 | 1124 |
| 16:00 | 1010 |
| 17:00 | 842 |
| 18:00 | 655 |
| 19:00 | 471 |
| 20:00 | 298 |
| 21:00 | 142 |
| 22:00 | 41 |
| 23:00 | 8 |

Normal backlog is under 10 thousand messages at any hour.

## Tables

### Top 10 slowest endpoints

| Endpoint | p95 (ms) | Calls per day | Owner team |
|---|---|---|---|
| `POST /v2/reports/export` | 2840 | 18,400 | Data |
| `GET /v2/invoices/{id}/pdf` | 1920 | 42,100 | Billing |
| `POST /v2/search/advanced` | 1310 | 96,800 | Search |
| `GET /v2/analytics/dashboard` | 1180 | 131,500 | Data |
| `POST /v2/payments/charge` | 960 | 58,300 | Payments |
| `POST /v2/files/upload` | 870 | 74,200 | Storage |
| `GET /v2/projects/{id}/activity` | 640 | 212,000 | Core |
| `PUT /v2/users/{id}/settings` | 520 | 38,900 | Identity |
| `GET /v2/invoices` | 480 | 88,700 | Billing |
| `POST /v2/webhooks/test` | 455 | 6,100 | Integrations |

### Incident log

| Date | Severity | Service | Duration | Root cause |
|---|---|---|---|---|
| Jul 14 | Sev-3 | search | 38 min | Nightly index rebuild saturated search nodes during EU business hours |
| Jul 29 | Sev-2 | api-gateway | 1h 52m | Config push halved the upstream connection pool; requests queued at the gateway |
| Aug 6 | Sev-3 | notifications | 1h 10m | Email provider rate limit hit after a marketing send was not throttled |
| Aug 19 | Sev-1 | auth | 47 min | Token signing certificate expired; renewal job had been failing silently |
| Aug 27 | Sev-2 | payments | 1h 25m | Card processor timeout raised to 30 s, exhausting payment worker threads |
| Sep 3 | Sev-1 | billing-worker | 9h 40m | Poison message blocked the billing queue; retries amplified the backlog |
| Sep 16 | Sev-3 | reporting | 2h 05m | Long-running analytics query held locks on a replica and stalled exports |
| Sep 22 | Sev-2 | object-storage | 55 min | Lifecycle rule misconfiguration deleted thumbnails; restored from versioning |

Total downtime across all incidents: 18h 32m; mean time to restore 2h 19m.

### Cost-saving opportunities

| Opportunity | Est. monthly saving ($k) | Effort | Owner |
|---|---|---|---|
| Move batch compute to spot instances | 14.5 | Medium | Platform |
| Right-size over-provisioned API nodes | 9.0 | Low | Platform |
| Tier cold object storage to archive class | 6.5 | Low | Storage |
| Keep ap-south traffic in-region (cut cross-region egress) | 7.8 | Medium | Networking |
| Drop unused read replicas (2 of 5) | 8.2 | Low | Data |
| Shorten log retention from 90 to 30 days | 4.0 | Low | Observability |

Combined estimated saving: $50.0k per month, about 14% of September spend.

## Callouts

**Warning: database headroom.** The Postgres primary peaked at 88% CPU on 3 September. The cache work brought normal weekday peaks down to about 50%, but at current traffic growth that margin is gone by February 2027.

**Risk: silent job failures.** Two incidents (the expired auth certificate and the billing poison message) started with background jobs failing without alerts. We have no alerting on 14 of 31 scheduled jobs.

**Success: edge cache rollout.** Cache hit rate rose from 71% to 91% over the quarter and average p95 latency fell 14 ms to 184 ms while traffic grew 9%.

**Note: ap-south growth.** ap-south traffic grew 47% from W1 to W13 and now carries 16% of weekly requests, but it still reads from the us-east database, which adds about 190 ms to its p95.

## Q3 timeline

- Jul 8, 2026 (Release): API gateway 4.2 with per-tenant rate limits
- Jul 29, 2026 (Incident): Sev-2 gateway connection pool exhaustion (1h 52m)
- Aug 4, 2026 (Migration): Edge cache rolled out to all regions
- Aug 19, 2026 (Incident): Sev-1 auth outage from expired signing certificate (47 min)
- Aug 25, 2026 (Migration): Logging pipeline moved to the new OpenTelemetry collector
- Sep 3, 2026 (Incident): Sev-1 billing queue backlog (9h 40m); deploy freeze for W10
- Sep 24, 2026 (Release): Queue dead-letter handling and job alerting shipped

## Decision needed: database migration

The self-managed Postgres 14 cluster runs out of headroom this winter and reaches end of community support in November 2026. We need to pick one of three options by 15 October.

### Option A: Managed Postgres from our cloud provider

- Pro: failover, backups and minor upgrades handled for us; frees about 0.5 of an engineer.
- Pro: same Postgres dialect, so application changes are minimal.
- Con: roughly 20% more per month than self-managed at the same size, and less control over tuning.
- Cost: about $86k per month, plus a one-time $40k migration effort. Timeline 8 weeks.

### Option B: Stay self-managed and upgrade to Postgres 18 on larger nodes

- Pro: cheapest monthly option and no vendor change.
- Pro: the team already knows how to run it.
- Con: keeps the on-call load and the manual failover that cost us time on 3 September.
- Cost: about $72k per month, plus a one-time $25k upgrade effort. Timeline 6 weeks.

### Option C: Distributed SQL database

- Pro: horizontal scaling and multi-region writes, which would fix ap-south latency.
- Con: needs query and schema changes across about 40 services; high migration risk.
- Con: new operational skills and a new vendor contract.
- Cost: about $118k per month, plus a one-time $180k migration effort. Timeline 5 to 6 months.

**Recommendation: Option A.** It removes the manual failover and on-call load behind two of this quarter's longest incidents, fits inside Q4, and costs $14k per month more than Option B. The cost-saving work above (about $50k per month) covers that difference. We would revisit distributed SQL in 2027 if ap-south keeps growing.

## Architecture and request flow

Components: CDN, Edge cache, API gateway, Auth service, Core API, Redis cache, Postgres primary (us-east), Job queue, Billing workers, Object storage.

- Client -> CDN: HTTPS request
- CDN -> Edge cache: cacheable GET
- CDN -> API gateway: dynamic request
- Edge cache -> API gateway: cache miss
- API gateway -> Auth service: token check
- API gateway -> Core API: routed request
- Core API -> Redis cache: read-through lookup
- Core API -> Postgres primary: reads on cache miss, all writes
- Core API -> Object storage: file upload and download
- Core API -> Job queue: enqueue billing and export jobs
- Job queue -> Billing workers: deliver message
- Billing workers -> Postgres primary: write invoices
- Billing workers -> Object storage: store invoice PDFs

## Next quarter

- Complete the Postgres migration (Option A if approved) by 15 December with zero unplanned downtime.
- Alert on every scheduled job and add dead-letter queues to all queues by 31 October.
- Bring availability back to 99.97% and mean time to restore under 1 hour.
- Deliver at least $35k per month of the identified cost savings by end of Q4.
- Add an ap-south read replica to cut ap-south p95 by 150 ms.

## Questions for readers

Everyone who reads the review answers these, so the infrastructure team can collect the answers afterwards. Questions marked (required) must be answered before sending.

1. Your name (short text, required).
2. Your work email (email address, required).
3. Your team (pick one from a dropdown): Platform, Storage, Networking, Data, Observability, Billing, Other.
4. Which database migration option do you back? (pick exactly one, required; show each option with its one-line summary): Option A, managed Postgres, about $86k per month and 8 weeks; Option B, self-managed Postgres 18 on larger nodes, about $72k per month and 6 weeks; Option C, distributed SQL, about $118k per month and 5 to 6 months.
5. Which cost-saving opportunities should we do first? (pick any number, from the six in the cost-saving table).
6. How confident are you that we can finish the migration by 15 December? (a scale from 1, "not at all", to 5, "certain").
7. How heavy has your on-call load been this quarter? (a slider from 0 to 10, in steps of 1).
8. Rate the quarter overall (1 to 5 stars).
9. When should the migration work start? (a date).
10. How many engineer-weeks can your team give the migration? (a number, 0 to 20).
11. Best time for the migration kickoff meeting (a time of day).
12. Should we freeze non-urgent deploys during the migration? (yes or no).
13. Anything else we should know? (free text, several lines).
