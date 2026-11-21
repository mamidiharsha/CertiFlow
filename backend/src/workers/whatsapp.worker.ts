import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { sendWhatsAppMessage } from '../services/whatsapp.service';

const prisma = new PrismaClient();

export function startWhatsAppWorker(): Worker {
  const worker = new Worker(
    'whatsapp-delivery',
    async (job: Job) => {
      const {
        certificateId,
        candidatePhone,
        candidateName,
        certificateNumber,
        pdfPath,
        idempotencyKey,
      } = job.data;

      console.log(`[WhatsAppWorker] Delivering certificate ${certificateNumber} to ${candidatePhone}`);

      // Check idempotency — skip if already SENT
      const delivery = await prisma.deliveryAttempt.findUnique({
        where: { idempotencyKey },
      });

      if (!delivery) {
        console.log(`[WhatsAppWorker] No delivery attempt found for key ${idempotencyKey}. Skipping.`);
        return;
      }

      if (delivery.status === 'SENT') {
        console.log(`[WhatsAppWorker] Certificate ${certificateNumber} already delivered. Skipping.`);
        return;
      }

      try {
        const message = `Dear ${candidateName}, congratulations! Your certificate (${certificateNumber}) has been issued. You can verify it at our portal.`;

        const result = await sendWhatsAppMessage({
          phone: candidatePhone,
          message,
          pdfUrl: pdfPath || undefined,
        });

        // Update delivery attempt to SENT
        await prisma.deliveryAttempt.update({
          where: { idempotencyKey },
          data: {
            status: 'SENT',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });

        console.log(`[WhatsAppWorker] Successfully delivered ${certificateNumber} (msgId: ${result.messageId})`);
      } catch (error: any) {
        // Update delivery attempt with error
        await prisma.deliveryAttempt.update({
          where: { idempotencyKey },
          data: {
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            error: error.message || 'Unknown error',
            status: (job.attemptsMade + 1) >= 3 ? 'FAILED' : 'PENDING',
          },
        });

        console.error(`[WhatsAppWorker] Failed to deliver ${certificateNumber}:`, error.message);
        throw error; // Re-throw for BullMQ retry
      }
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          // Exponential backoff: 1min, 5min, 30min
          const delays = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
          return delays[Math.min(attemptsMade - 1, delays.length - 1)];
        },
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[WhatsAppWorker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[WhatsAppWorker] Job ${job?.id} failed:`, error.message);
  });

  return worker;
}
