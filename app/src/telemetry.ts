import { metrics } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'otel-api';
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: '1.0.0',
});

// --- Metrics: keep the Prometheus pull endpoint as before ---
const prometheusReader = new PrometheusExporter({
  port: METRICS_PORT,
  endpoint: '/metrics',
  host: '0.0.0.0',
});

const meterProvider = new MeterProvider({
  resource,
  readers: [prometheusReader],
});
metrics.setGlobalMeterProvider(meterProvider);

const meter = metrics.getMeter(SERVICE_NAME);
export const httpRequestsTotal = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests',
});
export const httpRequestDuration = meter.createHistogram('http_request_duration_seconds', {
  description: 'HTTP request duration in seconds',
  unit: 's',
});
export const inFlightRequests = meter.createUpDownCounter('http_in_flight_requests', {
  description: 'Number of in-flight HTTP requests',
});

// --- Logs: OTLP push to the Collector ---
const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${OTLP_ENDPOINT}/v1/logs` })),
);
logs.setGlobalLoggerProvider(loggerProvider);

// --- Traces: NodeSDK with auto-instrumentation for HTTP/Express ---
const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy/irrelevant ones for this learning demo
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});
sdk.start();

console.log(`[telemetry] service=${SERVICE_NAME} metrics=:${METRICS_PORT}/metrics otlp=${OTLP_ENDPOINT}`);

const shutdown = async () => {
  try {
    await Promise.all([
      sdk.shutdown(),
      meterProvider.shutdown(),
      loggerProvider.shutdown(),
    ]);
  } catch (err) {
    console.error('[telemetry] shutdown error', err);
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
