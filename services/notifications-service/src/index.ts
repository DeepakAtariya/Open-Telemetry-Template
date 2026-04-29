import './telemetry.js';
import { logger } from './logger.js';
import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const PREFS: Record<number, { email: boolean; sms: boolean; push: boolean }> = {
  1: { email: true, sms: false, push: true },
  2: { email: true, sms: true, push: false },
  3: { email: false, sms: false, push: true },
};

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/preferences/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  // Simulate some I/O latency to make traces visually interesting
  await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
  const prefs = PREFS[userId];
  if (!prefs) {
    logger.warn('preferences not found', { userId });
    res.status(404).json({ error: 'not found' });
    return;
  }
  logger.info('preferences fetched', { userId });
  res.json(prefs);
});

app.listen(PORT, () => logger.info('notifications-service listening', { port: PORT }));
