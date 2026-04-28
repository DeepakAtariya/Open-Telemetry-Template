import { context, trace } from '@opentelemetry/api';
import { SeverityNumber, logs } from '@opentelemetry/api-logs';

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'otel-api';
const otelLogger = logs.getLogger(SERVICE_NAME);

type Attrs = Record<string, unknown>;

function emit(severity: SeverityNumber, severityText: string, body: string, attrs: Attrs = {}) {
  const span = trace.getSpan(context.active());
  const spanCtx = span?.spanContext();
  const enriched: Attrs = { ...attrs };
  if (spanCtx) {
    enriched.trace_id = spanCtx.traceId;
    enriched.span_id = spanCtx.spanId;
  }

  // Console output: structured JSON, easy to read in `docker logs`
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: severityText.toLowerCase(),
      msg: body,
      ...enriched,
    }),
  );

  // Forward through OTel Logs API → OTLP → Collector → Loki
  otelLogger.emit({
    severityNumber: severity,
    severityText,
    body,
    attributes: enriched as Record<string, string | number | boolean>,
  });
}

export const logger = {
  info: (msg: string, attrs?: Attrs) => emit(SeverityNumber.INFO, 'INFO', msg, attrs),
  warn: (msg: string, attrs?: Attrs) => emit(SeverityNumber.WARN, 'WARN', msg, attrs),
  error: (msg: string, attrs?: Attrs) => emit(SeverityNumber.ERROR, 'ERROR', msg, attrs),
  debug: (msg: string, attrs?: Attrs) => emit(SeverityNumber.DEBUG, 'DEBUG', msg, attrs),
};
