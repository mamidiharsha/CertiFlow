import express from 'express';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
});

// POST /api/send — Mock WhatsApp API
app.post('/api/send', async (req, res) => {
  const { phone, message, pdfUrl, idempotencyKey } = req.body;

  if (!phone || !message || typeof idempotencyKey !== 'string') {
    res.status(400).json({ error: 'phone, message, and idempotencyKey are required' });
    return;
  }

  try {
    const priorMessage = await redis.get(`whatsapp-mock:${idempotencyKey}`);
    if (priorMessage) {
      res.json(JSON.parse(priorMessage));
      return;
    }

    const rand = Math.random();
    const messageId = uuidv4();
    const acceptedResponse = { messageId, status: 'sent' };

    if (rand < 0.7) {
      const saved = await redis.set(
        `whatsapp-mock:${idempotencyKey}`,
        JSON.stringify(acceptedResponse),
        'EX',
        7 * 24 * 60 * 60,
        'NX'
      );
      if (!saved) {
        const existing = await redis.get(`whatsapp-mock:${idempotencyKey}`);
        res.json(existing ? JSON.parse(existing) : acceptedResponse);
        return;
      }

      console.log(`[WhatsAppMock] ✓ Sent to ${phone}: "${message.substring(0, 50)}..." (msgId: ${messageId})`);
      res.json(acceptedResponse);
      return;
    }

    if (rand < 0.85) {
      await redis.set(
        `whatsapp-mock:${idempotencyKey}`,
        JSON.stringify(acceptedResponse),
        'EX',
        7 * 24 * 60 * 60,
        'NX'
      );
      console.log(`[WhatsAppMock] ⏱ Accepted but acknowledgement timed out for ${phone}`);
      setTimeout(() => {
        res.status(504).json({ error: 'Gateway Timeout' });
      }, 10000);
      return;
    }

    console.log(`[WhatsAppMock] ✗ Failed for ${phone}`);
    res.status(500).json({ error: 'Internal Server Error', details: 'WhatsApp service temporarily unavailable' });
  } catch (error) {
    console.error('[WhatsAppMock] Idempotency store unavailable:', error);
    res.status(503).json({ error: 'WhatsApp mock temporarily unavailable' });
  }
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-mock' });
});

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`📱 WhatsApp Mock Server running on http://localhost:${PORT}`);
  console.log(`   POST /api/send — 70% success, 15% timeout, 15% failure`);
});

export default app;
