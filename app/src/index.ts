import {
  httpRequestDuration,
  httpRequestsTotal,
  inFlightRequests,
} from './telemetry.js';
import { logger } from './logger.js';
import express, { NextFunction, Request, Response } from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);
const USERS_URL = process.env.USERS_URL ?? 'http://users-service:3000';

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  inFlightRequests.add(1, { method: req.method });

  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: req.route?.path ?? req.path,
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.add(1, labels);
    httpRequestDuration.record(durationSec, labels);
    inFlightRequests.add(-1, { method: req.method });

    logger.info('request complete', {
      method: req.method,
      path: req.path,
      route: req.route?.path,
      status_code: res.statusCode,
      duration_ms: Math.round(durationSec * 1000),
    });
  });

  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users', (_req, res) => {
  logger.info('listing users');
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);
});

app.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    logger.warn('invalid user id requested', { raw: req.params.id });
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  if (id > 2) {
    logger.warn('user not found', { id });
    res.status(404).json({ error: 'not found' });
    return;
  }
  logger.info('user fetched', { id });
  res.json({ id, name: id === 1 ? 'Alice' : 'Bob' });
});

// Distributed-trace demo: this handler calls users-service (which itself
// calls notifications-service). One request → one trace ID across 3 services.
app.get('/orders/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) {
    res.status(400).json({ error: 'invalid userId' });
    return;
  }
  logger.info('building order for user', { userId });
  try {
    const upstream = await fetch(`${USERS_URL}/users/${userId}`);
    if (!upstream.ok) {
      logger.warn('users upstream non-2xx', { status: upstream.status });
      res.status(upstream.status).json({ error: 'upstream failed' });
      return;
    }
    const user = await upstream.json();
    res.json({
      orderId: `ord_${Date.now()}`,
      total: 99.0,
      user,
    });
  } catch (err) {
    logger.error('order build failed', { err: String(err) });
    res.status(502).json({ error: 'upstream unavailable' });
  }
});

app.get('/slow', async (_req, res) => {
  const ms = 200 + Math.random() * 800;
  logger.info('slow handler sleeping', { ms: Math.round(ms) });
  await new Promise((r) => setTimeout(r, ms));
  res.json({ slept: true });
});

app.listen(PORT, () => {
  logger.info('api listening', { port: PORT });
});
