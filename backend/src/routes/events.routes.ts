import { Router, Request, Response } from 'express';
import Redis from 'ioredis';
import { authenticate } from '../middleware/auth';
import { config } from '../config';

const router = Router();

// GET /api/events/stream — Auth required SSE endpoint
router.get('/stream', authenticate, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', userId: user.id })}\n\n`);

  // Create a subscriber Redis connection
  let subscriber: Redis;
  try {
    subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  } catch (error) {
    console.error('Failed to create SSE Redis subscriber:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to connect to event stream' })}\n\n`);
    res.end();
    return;
  }

  // Build channels to subscribe to based on user role
  const channels: string[] = [
    `user:${user.id}`,
    `role:${user.role}`,
  ];

  if (user.districtId) {
    channels.push(`district:${user.districtId}`);
  }
  if (user.centreId) {
    channels.push(`centre:${user.centreId}`);
  }

  // Subscribe to channels
  subscriber.subscribe(...channels, (err) => {
    if (err) {
      console.error('SSE subscription error:', err);
    }
  });

  subscriber.on('message', (channel: string, message: string) => {
    try {
      res.write(`data: ${message}\n\n`);
    } catch (e) {
      // Client disconnected
    }
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe(...channels).catch(() => {});
    subscriber.disconnect();
  });
});

export default router;
