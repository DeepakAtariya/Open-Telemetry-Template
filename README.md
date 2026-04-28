# OTel Learning — A Hands-On Observability Template

A self-contained, runnable learning project for **OpenTelemetry, Prometheus, and Grafana**, built around a small Node.js / TypeScript API. Spin it up with one command, watch metrics flow end-to-end, and use the included docs to understand *why* every piece is there.

This repository is designed as a **teaching template**. Fork it, follow the README, read the docs, and modify the app to learn by experimenting.

---

## What's inside

```
otel-learning/
├── app/                          # Node.js + TypeScript API instrumented with OTel
│   ├── src/
│   │   ├── index.ts              # Express server + metrics middleware
│   │   └── telemetry.ts          # OTel SDK wiring, Prometheus exporter
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml            # Prometheus + Pushgateway + Grafana + the app
├── prometheus.yml                # Prometheus scrape configuration
│
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/          # Auto-provisions Prometheus datasource
│   │   └── dashboards/           # Auto-provisions the dashboard provider
│   └── dashboards/
│       └── otel-api.json         # Pre-built dashboard for the demo API
│
├── scripts/
│   └── generate-traffic.sh       # Hits the API in a loop to populate dashboards
│
└── docs/
    ├── three-pillars.md                       # Metrics, logs, traces — the mental model
    └── prometheus-ingestion-approaches.md     # Every way to get metrics into Prometheus
```

---

## Architecture

```
┌────────────────┐          scrape /metrics           ┌──────────────┐
│  otel-api      │ ◄──────────────────────────────── │  Prometheus  │
│  Node.js + TS  │       every 5s on :9464           │   (TSDB)     │
│  OTel SDK      │                                    └──────┬───────┘
└────────────────┘                                           │
       ▲                                                     │ PromQL
       │ HTTP requests                                       ▼
       │                                              ┌──────────────┐
   you / generate-traffic.sh                          │   Grafana    │
                                                     │  dashboards  │
                                                     └──────────────┘

   ┌──────────────┐
   │ Pushgateway  │  (included for learning the push-vs-pull contrast;
   └──────────────┘   not used by the demo app — see docs)
```

The app uses **OpenTelemetry's Prometheus exporter** to expose `/metrics`. Prometheus pulls. Grafana queries Prometheus. This is the **canonical, recommended pattern** — see [`docs/prometheus-ingestion-approaches.md`](docs/prometheus-ingestion-approaches.md) for why.

---

## Prerequisites

- **Docker** + **Docker Compose** (Docker 20+)
- A free port on `3000`, `3001`, `9090`, `9091`, `9464`

That's it. Node.js is **not** required on your machine — the app builds and runs inside Docker.

---

## Quick start

```bash
# 1. Start everything
docker compose up -d --build

# 2. Generate some traffic so the dashboard isn't empty
bash scripts/generate-traffic.sh        # leave it running in another terminal

# 3. Open the UIs
#    Grafana   — http://localhost:3000   (admin / admin)
#    Prometheus— http://localhost:9090
#    The API   — http://localhost:3001/users
#    Raw OTel  — http://localhost:9464/metrics
```

The Grafana dashboard auto-loads at **http://localhost:3000/d/otel-api/otel-api**.

To shut everything down:
```bash
docker compose down
# or, to also wipe Grafana state:
docker compose down -v
```

---

## What you'll see

### The API (`http://localhost:3001`)
| Route             | Behavior                          |
| ----------------- | --------------------------------- |
| `GET /health`     | Liveness check                    |
| `GET /users`      | Returns a small list              |
| `GET /users/:id`  | Returns one user, or 400 / 404    |
| `GET /slow`       | Sleeps 200–1000ms (latency demo)  |

### The metrics endpoint (`http://localhost:9464/metrics`)
Three OTel-instrumented metrics, in Prometheus text format:
- `http_requests_total` — counter, broken down by `method` / `route` / `status_code`
- `http_request_duration_seconds` — histogram of request latency
- `http_in_flight_requests` — gauge of current concurrency

Plus `target_info` (auto-emitted resource metadata).

### The Grafana dashboard
Pre-built panels: service status, request rate, error rate, in-flight requests, request rate by route, request rate by status code, p50/p95/p99 latency, and concurrency over time. Refreshes every 5s.

---

## Suggested learning path

Work through these in order. Each step is grounded in something you can verify in the running stack.

### Stage 1 — The mental model
Read **[`docs/three-pillars.md`](docs/three-pillars.md)**. Understand why metrics, logs, and traces exist as separate signals before touching code.

### Stage 2 — Watch metrics flow
1. Start the stack and traffic generator.
2. Open `http://localhost:9464/metrics` and watch the counters tick up after each request.
3. Open `http://localhost:9090/targets` and confirm Prometheus has discovered the targets.
4. Open Prometheus's Graph tab and run:
   - `up`
   - `rate(http_requests_total[1m])`
   - `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))`
5. Open the Grafana dashboard and correlate.

### Stage 3 — Understand the wire
Read **[`docs/prometheus-ingestion-approaches.md`](docs/prometheus-ingestion-approaches.md)**. Then:

1. Start Pushgateway (`docker compose up -d pushgateway`) and push a metric:
   ```bash
   echo 'sample_metric 42' | curl --data-binary @- http://localhost:9091/metrics/job/demo
   ```
2. Query `sample_metric` in Prometheus.
3. Notice what *doesn't* work: stop pushing, wait — the value sticks forever. That's the Pushgateway anti-pattern in action.
4. Read why the demo app uses pull instead.

### Stage 4 — Modify the app
Edit `app/src/index.ts` and `app/src/telemetry.ts` to:

- Add a new route and a new counter for it.
- Add a custom histogram with explicit bucket boundaries (`advice: { explicitBucketBoundaries: [...] }`).
- Add a **gauge** that tracks something stateful (e.g., a fake queue depth).
- Add a label and watch how it affects the dashboard.
- Then add a label with **unbounded values** (e.g., a timestamp) and watch Prometheus's series count explode in `prometheus_tsdb_head_series` — that's cardinality blowup.

Rebuild after each change:
```bash
docker compose up -d --build otel-api
```

### Stage 5 — Build your own dashboard
1. In Grafana, create a new dashboard with PromQL queries you've learned.
2. Use **Dashboard settings → JSON Model** to copy the JSON and save it under `grafana/dashboards/`.
3. Restart Grafana. Your dashboard now ships with the repo.

### Stage 6 — Extend to all three pillars
The current setup covers metrics. Natural extensions:

- Add **traces** via the OTel SDK + an OTLP exporter → an OTel Collector → **Tempo**.
- Add **logs** via a structured logger (`pino`) + OTel logs SDK → Collector → **Loki**.
- Use Grafana to correlate trace IDs across all three.

The `docs/three-pillars.md` document outlines the design. Implementing it is a great next exercise.

---

## Common modifications (recipes)

### Change the scrape interval
Edit `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s    # was 5s
```
Then `docker compose restart prometheus`.

### Add a new scrape target
Add to `prometheus.yml`:
```yaml
  - job_name: my-other-service
    static_configs:
      - targets: ['my-other-service:9464']
```
Restart Prometheus. For a more scalable approach see the **service discovery** section of `docs/prometheus-ingestion-approaches.md`.

### Add a new dashboard
Drop a JSON file into `grafana/dashboards/`. It'll be auto-loaded on Grafana restart.

### Reset Grafana's state
```bash
docker compose down
docker volume rm otellearning_grafana-data
docker compose up -d
```

---

## Troubleshooting

| Symptom                                                             | Fix                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `connection refused` from Grafana to Prometheus                     | Use `http://prometheus:9090` (compose service name), not `localhost:9090`                  |
| Grafana login fails after a fresh start                             | Pinned image is `grafana:11.3.0`. If you change it to `latest` you may hit auth-store bugs |
| `up{job="otel-api"} == 0` in Prometheus                             | Check `docker logs otel-api` and that port `9464` is not blocked                           |
| Dashboard panels say "No data"                                      | Run `bash scripts/generate-traffic.sh` to create traffic                                   |
| Histogram bucket boundaries look weird (in seconds)                 | OTel's defaults are wide; supply `advice.explicitBucketBoundaries` for tighter resolution  |

---

## Why this is structured the way it is

A few opinionated choices worth calling out:

- **The app uses OTel directly, not `prom-client`.** The point is to learn OTel semantics and metric types — even though for pure Prometheus output, `prom-client` would be one less dependency. This way the same instrumentation can later target Tempo / Loki / OTLP backends without rewrites.
- **Pull, not push.** Pushgateway is included as a teaching artifact to contrast with — see the docs for when push is and isn't appropriate.
- **Provisioned, not clicked.** Every Grafana datasource and dashboard is in version control. You can wipe the volume and `docker compose up` and get an identical environment. Never click your way to a setup you can't reproduce.
- **Pinned versions.** `grafana:11.3.0` is pinned because newer versions changed authentication backing-store behavior. Pinning is intentional; do the same in your real projects.
- **No collector yet.** Adding one is the first natural extension. It's deliberately left out so the metrics pipeline stays small enough to read end-to-end.

---

## Reading list

- [`docs/three-pillars.md`](docs/three-pillars.md) — Metrics, logs, traces: what they are and when to use each.
- [`docs/prometheus-ingestion-approaches.md`](docs/prometheus-ingestion-approaches.md) — Every way to get metrics into Prometheus, and when to use which.

External:

- [OpenTelemetry docs](https://opentelemetry.io/docs/) — the spec and SDKs.
- [Prometheus docs — instrumentation best practices](https://prometheus.io/docs/practices/instrumentation/).
- [Prometheus docs — when to use Pushgateway](https://prometheus.io/docs/practices/pushing/) — read it before you reach for push.
- [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/) — if you want to extend the auto-loaded dashboards.

---

## License

Use this freely as a learning template. No warranty.
