import { Worker, Job } from 'bullmq';
import { PrismaClient, CertificateStatus } from '@prisma/client';
import { config } from '../config';
import { sendWhatsAppMessage } from '../services/whatsapp.service';
import { addWhatsAppJob } from '../queues';
import { createCertificateDownloadUrl } from '../services/certificate.service';
import { publishEvent } from '../events';

const prisma = new PrismaClient();

export function startWhatsAppWorker(): Worker {
  const worker = new Worker(
    'whatsapp-delivery',
    async (job: Job) => {
      if (job.name === 'RECONCILE_PENDING_DELIVERIES') {
        const deliveries = await prisma.deliveryAttempt.findMany({
          where: { status: 'PENDING' },
          include: { certificate: { include: { candidate: true } } },
        });

        for (const delivery of deliveries) {
          const certificate = delivery.certificate;
          if (certificate.status !== CertificateStatus.ACTIVE) {
            await prisma.deliveryAttempt.update({
              where: { id: delivery.id },
              data: { status: 'FAILED', error: 'Certificate is no longer active' },
            });
            continue;
          }
          if (!certificate.candidate) {
            throw new Error(`Candidate missing for certificate ${certificate.id}`);
          }

          await addWhatsAppJob(
            certificate.id,
            delivery.candidatePhone,
            certificate.candidate.name,
            certificate.certificateNumber,
            createCertificateDownloadUrl(certificate.id),
            delivery.idempotencyKey,
            `wa-${delivery.idempotencyKey}-${delivery.dispatchGeneration}`
          );
        }
        return;
      }

      const {
        certificateId,
        candidatePhone,
        candidateName,
        certificateNumber,
        pdfUrl,
        idempotencyKey,
      } = job.data;

      console.log(`[WhatsAppWorker] Delivering certificate ${certificateNumber} to ${candidatePhone}`);

      // Check idempotency — skip if already SENT
      const delivery = await prisma.deliveryAttempt.findUnique({
        where: { idempotencyKey },
        include: { certificate: true },
      });

      if (!delivery) {
        throw new Error(`No delivery attempt found for key ${idempotencyKey}`);
      }

      if (delivery.status === 'SENT') {
        console.log(`[WhatsAppWorker] Certificate ${certificateNumber} already delivered. Skipping.`);
        return;
      }
      if (delivery.certificate.status !== CertificateStatus.ACTIVE) {
        await prisma.deliveryAttempt.update({
          where: { idempotencyKey },
          data: { status: 'FAILED', error: 'Certificate is no longer active' },
        });
        return;
      }

      try {
        const message = `Dear ${candidateName}, congratulations! Your certificate (${certificateNumber}) has been issued. Download it here: ${pdfUrl}`;

        const result = await sendWhatsAppMessage({
          phone: candidatePhone,
          message,
          pdfUrl,
          idempotencyKey,
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
        await publishEvent('role:STATE_OFFICE', {
          type: 'delivery_status_changed',
          certificateId,
          status: 'SENT',
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
            status: (job.attemptsMade + 1) >= 4 ? 'FAILED' : 'PENDING',
          },
        });
        if ((job.attemptsMade + 1) >= 4) {
          await publishEvent('role:STATE_OFFICE', {
            type: 'delivery_status_changed',
            certificateId,
            status: 'FAILED',
          });
        }

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
