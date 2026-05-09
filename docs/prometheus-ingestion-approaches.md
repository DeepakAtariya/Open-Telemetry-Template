# Getting Metrics Into Prometheus: All The Approaches

Prometheus is fundamentally **pull-based**: it scrapes HTTP `/metrics` endpoints on a schedule and writes the samples into its time-series database. Everything else in this document is either (a) something that exposes a `/metrics` endpoint Prometheus can scrape, or (b) a workaround for situations where pull doesn't fit.

This document walks through every mainstream pattern, when to use it, and the tradeoffs.

---

## 0. The mental model

```
┌──────────┐  scrape (HTTP GET)  ┌──────────────┐  read   ┌─────────┐
│  Target  │ ◄────────────────── │  Prometheus  │ ◄────── │ Grafana │
│  exposes │                     │  (TSDB +     │ promQL  │ / UI    │
│ /metrics │                     │   scraper)   │         │         │
└──────────┘                     └──────────────┘         └─────────┘
```

Two questions decide everything:

1. **Can Prometheus reach the target on a schedule?**
2. **Does the target live long enough to be reached?**

If both are *yes*: pull works, and you should use it. If either is *no*: you need one of the workarounds below.

---

## 1. Direct pull from a long-running service (the canonical path)

**Setup:** the app exposes `/metrics` in Prometheus text format. Prometheus has a `scrape_config` pointing at it.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: my-api
    static_configs:
      - targets: ['my-api:9464']
```

**Use when:** you control a long-running service (HTTP server, worker, daemon). This is **the recommended path** for ~90% of cases.

**Pros**
- Simple, no extra moving parts.
- Liveness comes for free — `up{job="my-api"} == 0` tells you when the target is down.
- Backpressure: Prometheus controls the cadence; the app never gets overwhelmed.
- Counter resets are handled correctly by `rate()` automatically.

**Cons**
- Doesn't work for short-lived jobs that finish before they're scraped.
- Doesn't work if Prometheus can't reach the target (NAT, firewalls, ephemeral networks).
- Every new service needs a scrape config entry — see §2.

---

## 2. Pull + service discovery (scaling §1 to many services)

The same pull mechanism, but Prometheus discovers targets dynamically instead of via static lists.

**Common discovery sources:**

| Source                 | Used when                              | What you do                                          |
| ---------------------- | -------------------------------------- | ---------------------------------------------------- |
| `kubernetes_sd_configs` | Running on Kubernetes                  | Annotate pods (`prometheus.io/scrape: "true"`) or create `ServiceMonitor` CRDs |
| `consul_sd_configs`    | Using Consul service registry          | Tag the service with a known label                   |
| `file_sd_configs`      | No registry, but want a flat workflow  | Drop a JSON file per service into a watched dir      |
| `ec2_sd_configs`, `azure_sd_configs`, `gce_sd_configs` | Cloud VMs | Tag instances; Prometheus filters on tags |
| `dns_sd_configs`       | SRV records available                  | Use DNS as the registry                              |

**Use when:** you have more than a handful of services, or services come and go (autoscaling, k8s).

**The pattern:** one scrape job in `prometheus.yml`, with a relabel rule like *"scrape any pod with annotation `prometheus.io/scrape=true`"*. After that, onboarding a new service means adding metadata to the deployment, **not** editing Prometheus config.

This is what most production setups look like.

---

## 3. Pushgateway (for short-lived batch jobs only)

A small server that **accepts pushed metrics** and **exposes them for Prometheus to scrape**.

```
batch job ──POST /metrics/job/<name>──► Pushgateway ◄──scrape── Prometheus
(exits)                                  (holds in
                                         memory)
```

**Use when:**
- A job is too short-lived to be scraped (cron, CI step, one-off batch).
- You explicitly want to remember the *last* result of a recurring job.

**Do NOT use for:**
- Long-running services (use §1 instead — Pushgateway erases the liveness signal).
- "I want to push because pull is harder" (see §4 or §5 instead).

**Limitations**
- Holds the **last** value forever — even after the job dies, until you explicitly DELETE it. Stale data masquerades as live data.
- Single point of failure (no clustering).
- In-memory by default; persistence is opt-in via `--persistence.file`.
- No `up` signal for the underlying job; only for Pushgateway itself.

**Wire it up** with `honor_labels: true` so labels the job pushed (its own `job`, `instance`) survive the scrape:

```yaml
- job_name: pushgateway
  honor_labels: true
  static_configs:
    - targets: ['pushgateway:9091']
```

---

## 4. Remote-write (push directly into Prometheus)

Prometheus accepts a **`/api/v1/write`** endpoint over HTTP for pushed batches of samples. This is the same protocol used by Mimir, Cortex, Thanos, VictoriaMetrics, Grafana Cloud, etc.

```
your app ──HTTP POST──► Prometheus /api/v1/write
(or Collector,         (must have remote-write
or Vector, etc.)        receiver enabled)
```

To enable on Prometheus side:
```bash
prometheus --web.enable-remote-write-receiver ...
```

**Use when:**
- You truly cannot be scraped (NAT, multi-tenant edge, mobile, IoT).
- You're shipping to a long-term-storage backend that *only* speaks remote-write.
- You're forwarding metrics through an OTel Collector or Vector.

**Pros**
- Push semantics, no scrape-reachability problem.
- Works with high-fanout sources.
- Same protocol used by every Prometheus-compatible TSDB — your config is portable.

**Cons**
- Loses the implicit `up == 0` liveness signal.
- You're now responsible for batching and retries on the client side (the OTel Collector, Vector, etc. handle this for you).
- Doesn't replace pull for normal services — it's a niche tool.

---

## 5. OTLP into Prometheus (native or via Collector)

OpenTelemetry's native protocol is **OTLP**. Prometheus 2.47+ has a built-in OTLP receiver:

```yaml
# prometheus.yml
otlp:
  # exposes /api/v1/otlp/v1/metrics
```

Now apps can push OTLP metrics directly to Prometheus, no Collector needed.

```
app ──OTLP gRPC/HTTP──► Prometheus
```

**Use when:**
- You're standardizing on OTel and want to push metrics through the same pipeline as traces and logs.
- You don't want the operational burden of a separate Collector for a small setup.

**Pros**
- One protocol for all three OTel signals (metrics, traces, logs); send anywhere later by changing the endpoint.
- No need for Pushgateway just for "push".
- No Collector required for simple cases.

**Cons**
- Same liveness caveat as §4.
- OTLP histogram → Prometheus histogram conversion has subtleties (delta vs cumulative temporality — use **cumulative** with Prometheus).

---

## 6. OTel Collector → Prometheus (the production pattern)

Run an **OpenTelemetry Collector** as a central pipeline. Apps push OTLP to it; the Collector exports to Prometheus. There are two ways the Collector talks to Prometheus:

**(a) Collector exposes `/metrics`, Prometheus scrapes it (`prometheus` exporter)**

```
apps ──OTLP──► Collector ──/metrics──◄ scrape ── Prometheus
```

Prometheus scrapes one target (the Collector). New apps added to the system require zero Prometheus config changes.

**(b) Collector pushes to Prometheus's remote-write (`prometheusremotewrite` exporter)**

```
apps ──OTLP──► Collector ──remote-write──► Prometheus
```

Same idea, but push instead of pull on the Prometheus side.

**Use when:**
- You have many services and don't want to register each in Prometheus.
- You want central control over batching, sampling, attribute scrubbing, redaction.
- You're already going to run a Collector for traces/logs anyway — let it carry metrics too.

**Pros**
- Apps don't need to know about Prometheus — only OTLP.
- Single chokepoint for cardinality limits, label normalization, multi-tenant tagging.
- Works for short-lived jobs too (no Pushgateway needed for OTel apps).
- Handles backpressure, retries, queuing.

**Cons**
- One more component to operate (HA, sizing, monitoring of its own).
- If the Collector goes down, all metrics stop flowing — make it HA or use sidecar mode.

This is the **most production-correct OTel-native pattern**, and it's how a "complete" observability setup typically looks.

---

## 7. Exporters (a special case of §1)

For systems you don't control (databases, message brokers, OS-level metrics), the Prometheus community publishes **exporters**: tiny services that translate the system's native stats into a `/metrics` endpoint.

```
PostgreSQL ─stats─► postgres-exporter ──/metrics──◄ scrape── Prometheus
```

Common ones: `node_exporter` (Linux), `postgres_exporter`, `redis_exporter`, `kafka_exporter`, `nginx_exporter`, `blackbox_exporter` (synthetic probes).

Mechanically this is just §1 — you've outsourced the instrumentation to the exporter.

---

## Decision matrix

| Situation                                                       | Use this                          |
| --------------------------------------------------------------- | --------------------------------- |
| Long-running service you control                                | §1 direct pull                    |
| Many services / k8s / cloud autoscaling                         | §2 pull + service discovery       |
| Cron / batch / CI / one-off jobs                                | §3 Pushgateway                    |
| Cannot be scraped (NAT, edge, mobile)                           | §4 remote-write or §5 OTLP push   |
| Standardizing on OpenTelemetry across signals                   | §6 OTel Collector                 |
| Off-the-shelf system you don't control (Postgres, Redis, etc.)  | §7 exporter                       |

---

## Anti-patterns to avoid

- **Pushgateway for long-running services.** You lose liveness; stale data lingers forever; metrics from dead replicas pollute queries.
- **High-cardinality labels** (`user_id`, `request_id`, `session_id`). Each unique value is a new time series; series count is what eats Prometheus.
- **Mixing units in one metric.** Decide on seconds-vs-milliseconds and stick to it. OTel's convention is **seconds** with the `_seconds` suffix.
- **Counters that can go down.** Prometheus assumes counters only increase; a decrease is treated as a counter reset. Use a gauge if your value can drop.
- **One scrape per service, no SD.** You'll be back editing `prometheus.yml` every week. Use service discovery from day two.

---

## How this maps to a "complete" OTel solution

A typical end-to-end setup with all three pillars:

```
                                            ┌─────────────┐
   apps ─OTLP─► OTel Collector ──metrics──► │ Prometheus  │
                    │                       └─────────────┘
                    │     ┌────────┐
                    ├──── │  Tempo │  ◄── traces
                    │     └────────┘
                    │     ┌────────┐
                    └──── │  Loki  │  ◄── logs
                          └────────┘
                                            ┌─────────────┐
                                            │   Grafana   │
                                            │  unified UI │
                                            └─────────────┘
```

For metrics specifically, you'd typically pick **§6 (Collector → Prometheus)** for new OTel-instrumented services, and keep **§1 (direct pull)** for legacy services that already have a `/metrics` endpoint and a stable scrape config. Both can coexist in the same Prometheus.
