import './telemetry.js';
import { logger } from './logger.js';
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL ?? 'http://notifications-service:3000';

const USERS: Record<number, { id: number; name: string }> = {
  1: { id: 1, name: 'Alice' },
  2: { id: 2, name: 'Bob' },
  3: { id: 3, name: 'Carol' },
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = USERS[id];
  if (!user) {
    logger.warn('user not found', { id });
    res.status(404).json({ error: 'not found' });
    return;
  }

  // Outbound call — OTel auto-instrumentation propagates the trace context
  // via the `traceparent` header automatically.
  logger.info('fetching preferences for user', { id });
  let preferences: unknown = null;
  try {
    const resp = await fetch(`${NOTIFICATIONS_URL}/preferences/${id}`);
    if (resp.ok) preferences = await resp.json();
    else logger.warn('preferences upstream non-2xx', { status: resp.status });
  } catch (err) {
    logger.error('preferences upstream failed', { err: String(err) });
  }

  res.json({ ...user, preferences });
});

app.listen(PORT, () => logger.info('users-service listening', { port: PORT }));
