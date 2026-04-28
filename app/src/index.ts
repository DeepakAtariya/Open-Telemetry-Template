import {
  httpRequestDuration,
  httpRequestsTotal,
  inFlightRequests,
} from './telemetry.js';
import express, { NextFunction, Request, Response } from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

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
  });

  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/users', (_req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);
});

app.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  if (id > 2) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ id, name: id === 1 ? 'Alice' : 'Bob' });
});

app.get('/slow', async (_req, res) => {
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
  res.json({ slept: true });
});

app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});
