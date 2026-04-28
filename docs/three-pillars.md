# The Three Pillars of Observability

Observability is the ability to answer arbitrary questions about a system's behavior from the outside, without shipping new code. The "three pillars" are the three kinds of telemetry data that, taken together, make this possible.

| Pillar  | What it is                                       | Best at answering                                     |
| ------- | ------------------------------------------------ | ----------------------------------------------------- |
| Metrics | Numerical measurements aggregated over time      | "How is the system trending?" / "Is something off?"   |
| Logs    | Timestamped, structured text records of events   | "What exactly happened in this one request?"         |
| Traces  | Causally linked spans across services            | "Where did the time go in this request?"             |

You need all three because each is weakest where the others are strongest.

---

## 1. Metrics

### What they are
Numbers sampled at regular intervals, identified by a name and a set of labels. Each unique label-set is a separate **time series**.

```
http_requests_total{method="GET", route="/users", status="200"} 1247
http_request_duration_seconds_bucket{route="/users", le="0.1"} 1180
http_in_flight_requests{method="GET"} 3
```

### Properties
- **Compact**: a million requests is still one number.
- **Cheap to store**: aggregation = small storage.
- **Bounded cardinality** (labels must not include `user_id`, `request_id`, etc.).
- Cannot answer "what happened in *this* request?" — they're aggregates.

### When to use
- Dashboards (RPS, error rate, latency, saturation).
- Alerting (`p95 > 500ms for 10m`).
- Capacity planning, SLOs.

### Common types
| Type       | Behavior                                                     | Example                              |
| ---------- | ------------------------------------------------------------ | ------------------------------------ |
| Counter    | Monotonically increases; rate is meaningful                  | requests, bytes-out, errors          |
| Gauge      | Goes up and down; current value is meaningful                | in-flight, queue depth, memory used  |
| Histogram  | Distribution via fixed buckets; supports quantile estimation | request latency                      |
| Summary    | Quantiles computed at the source                             | latency (rare in OTel)               |

### Storage backends
- **Prometheus** (de facto standard, pull-based)
- **Mimir / Thanos / Cortex** (long-term, horizontally scalable Prometheus)
- **VictoriaMetrics**, **InfluxDB**, **Datadog**, **CloudWatch**, etc.

---

## 2. Logs

### What they are
Discrete records of events that happened, with a timestamp and a message. Modern logs are **structured** (JSON, key/value) rather than freeform strings.

```json
{"ts":"2026-04-28T17:42:11Z","level":"error","msg":"db query failed","route":"/users/:id","user_id":42,"err":"timeout","trace_id":"a1b2..."}
```

### Properties
- **High fidelity, high volume, high cost.** One record per event, retained for days/weeks.
- Queried by full-text search and label filters.
- Correlate with traces by including `trace_id` / `span_id` in the log record.

### When to use
- Forensic debugging ("what exactly went wrong in this request at 14:03?").
- Audit trails.
- Anything you can't pre-aggregate (raw payloads, error stacktraces).

### Best practices
- **Always structured** (JSON), never `printf` blobs.
- **Always include** `trace_id` and `service.name` so logs join with traces.
- **Don't log** what a metric or trace already captures — pay the cost only for facts the other two can't carry.
- **Sample noisy logs** at the source; you cannot retroactively un-pay the storage bill.

### Storage backends
- **Loki** (Grafana, label-indexed, log-line content compressed)
- **Elasticsearch / OpenSearch** (full-text indexed, expensive but powerful)
- **Splunk**, **Datadog Logs**, **CloudWatch Logs**

---

## 3. Traces

### What they are
A trace is the lifecycle of a single request as it flows through services, broken into **spans** (units of work). Each span has a parent, a duration, and attributes. A trace is a tree (or DAG) of spans sharing one `trace_id`.

```
trace_id = a1b2c3...
└── span: HTTP GET /users          (api-gateway, 412ms)
    ├── span: SELECT users         (postgres, 8ms)
    ├── span: GET /enrich          (user-service, 380ms)
    │   └── span: redis.get        (redis, 1ms)
    └── span: render JSON          (api-gateway, 4ms)
```

### Properties
- **Per-request, with causal structure** — shows you *where the time went*.
- **Cross-service** by design (context propagated via HTTP headers like `traceparent`).
- **Sampled** — usually 1–10% of requests. Sampling everything is cost-prohibitive at scale.

### When to use
- Latency debugging in distributed systems ("the API is slow — which downstream is to blame?").
- Understanding request flow across many services.
- Discovering unexpected dependencies.

### Best practices
- Use **W3C Trace Context** (`traceparent` header) — interoperable across vendors.
- Propagate context through every async boundary (queues, background jobs).
- Keep span attributes bounded (no full payloads).
- **Tail-based sampling** for production: keep all error/slow traces, drop most happy-path traces.

### Storage backends
- **Tempo** (Grafana, object-store backed, very cheap)
- **Jaeger** (CNCF, Cassandra/Elasticsearch backed)
- **Zipkin**, **Datadog APM**, **AWS X-Ray**, **Honeycomb**

---

## Why all three, not just one

| Question                                    | Best signal | Why others fall short                                 |
| ------------------------------------------- | ----------- | ----------------------------------------------------- |
| "Is error rate above threshold right now?"  | Metrics     | Logs/traces too costly to aggregate at query time      |
| "Why did THIS request fail at 14:03:22?"    | Logs        | Metrics aggregate it away; traces may not have it     |
| "Why is checkout p95 latency 2× normal?"    | Traces      | Metrics tell you it spiked; logs don't show structure |

You drive **alerts and dashboards** off metrics, then **drill into** the spike via traces, then **inspect the specifics** via logs. Each pillar is a different zoom level.

---

## OpenTelemetry's role

**OpenTelemetry (OTel)** is a vendor-neutral spec + SDK for producing all three signals from your app, regardless of where you store them.

```
                                     Prometheus
                                    /
   your app  ─[OTel SDK]─► OTLP ──► OTel Collector ──► Tempo
                                    \
                                     Loki
```

Why OTel matters:

1. **One instrumentation, any backend.** Switch from Datadog to Grafana without touching app code.
2. **Cross-signal correlation built in.** Trace IDs flow into log records and metric exemplars automatically.
3. **OTLP** (the wire protocol) is becoming the lingua franca of observability — Prometheus, Loki, Tempo, Datadog, New Relic all speak it natively.

**Practical pattern:**
- Apps emit OTLP → **OTel Collector** centralizes pipeline concerns (batching, sampling, attribute scrubbing, fan-out).
- Collector exports each signal to its appropriate backend.
- All three converge in **Grafana** (or your UI of choice) for unified querying and drill-down.

---

## The mental model in one paragraph

**Metrics** tell you *something is wrong* and let you alert cheaply at scale.
**Traces** tell you *where in the system* the wrongness lives, by reconstructing a single request's journey.
**Logs** tell you *exactly what happened* at the point of failure, with full fidelity.
You buy them in that order of cost — metrics are cheap, logs are expensive — and you triage in that order of zoom.
