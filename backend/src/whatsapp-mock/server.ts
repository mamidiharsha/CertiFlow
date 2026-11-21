import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

// POST /api/send — Mock WhatsApp API
app.post('/api/send', (req, res) => {
  const { phone, message, pdfUrl } = req.body;

  if (!phone || !message) {
    res.status(400).json({ error: 'phone and message are required' });
    return;
  }

  const rand = Math.random();

  // 70% success
  if (rand < 0.7) {
    const messageId = uuidv4();
    console.log(`[WhatsAppMock] ✓ Sent to ${phone}: "${message.substring(0, 50)}..." (msgId: ${messageId})`);
    res.json({ messageId, status: 'sent' });
    return;
  }

  // 15% timeout (delay 10s then 504)
  if (rand < 0.85) {
    console.log(`[WhatsAppMock] ⏱ Timeout for ${phone}`);
    setTimeout(() => {
      res.status(504).json({ error: 'Gateway Timeout' });
    }, 10000);
    return;
  }

  // 15% failure (500)
  console.log(`[WhatsAppMock] ✗ Failed for ${phone}`);
  res.status(500).json({ error: 'Internal Server Error', details: 'WhatsApp service temporarily unavailable' });
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
