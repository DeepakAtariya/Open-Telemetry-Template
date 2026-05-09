import { context, trace } from '@opentelemetry/api';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const COLLECTOR_URL =
  (import.meta.env.VITE_OTLP_URL as string | undefined) ?? 'http://localhost:4318/v1/traces';
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

const provider = new WebTracerProvider({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'web-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: COLLECTOR_URL }))],
});

provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new UserInteractionInstrumentation({ eventNames: ['click'] }),
    new FetchInstrumentation({
      // Allow traceparent to be added on cross-origin calls to our backend.
      // Without this, traces would not stitch across to the server.
      propagateTraceHeaderCorsUrls: [new RegExp(`^${API_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*`)],
    }),
  ],
});

const tracer = trace.getTracer('web-app');

const out = document.getElementById('out')!;

async function loadOrder(userId: number) {
  // Manual root span — gives us a clean trace_id to display alongside the response.
  const span = tracer.startSpan(`loadOrder user=${userId}`, {
    attributes: { 'app.user_id': userId },
  });

  await context.with(trace.setSpan(context.active(), span), async () => {
    const traceId = span.spanContext().traceId;
    out.innerHTML = `requesting order for user ${userId} ... <span class="trace-id">${traceId}</span>`;
    try {
      const resp = await fetch(`${API_URL}/orders/${userId}`);
      const body = await resp.json().catch(() => ({}));
      out.innerHTML =
        `<strong>trace_id:</strong> <span class="trace-id">${traceId}</span>\n` +
        `<strong>status:</strong> ${resp.status}\n` +
        `<strong>response:</strong>\n${JSON.stringify(body, null, 2)}`;
      if (!resp.ok) span.setStatus({ code: 2, message: `HTTP ${resp.status}` });
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2, message: String(err) });
      out.textContent = `request failed: ${String(err)}`;
    } finally {
      span.end();
    }
  });
}

document.querySelectorAll<HTMLButtonElement>('button[data-uid]').forEach((btn) => {
  btn.addEventListener('click', () => {
    void loadOrder(Number(btn.dataset.uid));
  });
});

console.log('[web-app] OTel initialized, OTLP →', COLLECTOR_URL);
