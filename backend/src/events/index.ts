import Redis from 'ioredis';
import { config } from '../config';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    publisher.on('error', (err) => {
      console.error('Redis publisher error:', err);
    });
  }
  return publisher;
}

export async function publishEvent(channel: string, event: Record<string, any>): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.publish(channel, JSON.stringify(event));
  } catch (error) {
    console.error(`Failed to publish event to ${channel}:`, error);
  }
}

export async function subscribeToEvents(
  channels: string[],
  callback: (channel: string, event: Record<string, any>) => void
): Promise<Redis> {
  const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

  await subscriber.subscribe(...channels);

  subscriber.on('message', (channel: string, message: string) => {
    try {
      const event = JSON.parse(message);
      callback(channel, event);
    } catch (error) {
      console.error('Failed to parse event:', error);
    }
  });

  return subscriber;
}

export async function disconnectPublisher(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
}
