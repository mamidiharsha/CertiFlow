import { Worker, Job } from 'bullmq';
import { PrismaClient, BatchStatus } from '@prisma/client';
import { config } from '../config';
import { createCertificate } from '../services/certificate.service';
import { addWhatsAppJob } from '../queues';
import { publishEvent } from '../events';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

export function startCertificateWorker(): Worker {
  const worker = new Worker(
    'certificate-generation',
    async (job: Job) => {
      const { batchId } = job.data;

      console.log(`[CertWorker] Processing BATCH_APPROVED for batch ${batchId}`);

      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: {
          candidates: true,
          centre: true,
          district: true,
        },
      });

      if (!batch) {
        throw new Error(`Batch ${batchId} not found`);
      }

      if (batch.status !== BatchStatus.APPROVED) {
        console.log(`[CertWorker] Batch ${batchId} is not APPROVED (status: ${batch.status}). Skipping.`);
        return;
      }

      let generatedCount = 0;

      for (const candidate of batch.candidates) {
        // Skip if certificate already exists for this candidate
        if (candidate.certificateId) {
          console.log(`[CertWorker] Candidate ${candidate.id} already has certificate. Skipping.`);
          continue;
        }

        try {
          const cert = await createCertificate({
            candidateId: candidate.id,
            batchId: batch.id,
            districtCode: batch.district.code,
            candidateName: candidate.name,
            courseName: candidate.course,
            trainingCentre: batch.centre.name,
          });

          generatedCount++;

          // Create a delivery attempt record and enqueue WhatsApp job
          const idempotencyKey = `wa-${cert.id}-${candidate.phone}`;

          await prisma.deliveryAttempt.create({
            data: {
              id: uuidv4(),
              certificateId: cert.id,
              candidatePhone: candidate.phone,
              status: 'PENDING',
              idempotencyKey,
            },
          });

          await addWhatsAppJob(
            cert.id,
            candidate.phone,
            candidate.name,
            cert.certificateNumber,
            cert.pdfPath,
            idempotencyKey
          );

          // Publish event per certificate
          await publishEvent(`batch:${batchId}`, {
            type: 'certificate_issued',
            certificateId: cert.id,
            certificateNumber: cert.certificateNumber,
            candidateName: candidate.name,
          });
        } catch (error) {
          console.error(`[CertWorker] Failed to create certificate for candidate ${candidate.id}:`, error);
          throw error; // Re-throw to let BullMQ handle retry
        }
      }

      // Update batch status
      await prisma.batch.update({
        where: { id: batchId },
        data: {
          status: BatchStatus.CERTIFICATES_ISSUED,
          version: { increment: 1 },
        },
      });

      await publishEvent(`batch:${batchId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.CERTIFICATES_ISSUED,
        title: batch.title,
        certificatesGenerated: generatedCount,
      });

      console.log(`[CertWorker] Generated ${generatedCount} certificates for batch ${batchId}`);
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[CertWorker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[CertWorker] Job ${job?.id} failed:`, error);
  });

  return worker;
}
