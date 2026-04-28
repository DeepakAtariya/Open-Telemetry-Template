import { metrics } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'otel-api';
const METRICS_PORT = Number(process.env.METRICS_PORT ?? 9464);

const exporter = new PrometheusExporter({
  port: METRICS_PORT,
  endpoint: '/metrics',
  host: '0.0.0.0',
});

const provider = new MeterProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  readers: [exporter],
});

metrics.setGlobalMeterProvider(provider);

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

console.log(`[telemetry] /metrics exposed on :${METRICS_PORT}`);
