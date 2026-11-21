import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from '../config';

let connection: Redis;

function getConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export const certificateQueue = new Queue('certificate-generation', {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
  },
});

export const whatsappQueue = new Queue('whatsapp-delivery', {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'custom',
    },
  },
});

export const slaQueue = new Queue('sla-check', {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 10,
  },
});

export async function addCertificateJob(batchId: string): Promise<void> {
  await certificateQueue.add('BATCH_APPROVED', { batchId }, {
    jobId: `cert-${batchId}`,
  });
}

export async function addWhatsAppJob(
  certificateId: string,
  candidatePhone: string,
  candidateName: string,
  certificateNumber: string,
  pdfPath: string | null,
  idempotencyKey: string
): Promise<void> {
  await whatsappQueue.add('DELIVER_CERTIFICATE', {
    certificateId,
    candidatePhone,
    candidateName,
    certificateNumber,
    pdfPath,
    idempotencyKey,
  }, {
    jobId: `wa-${idempotencyKey}`,
    attempts: 3,
    backoff: {
      type: 'custom',
    },
  });
}

export async function setupSlaRepeatable(): Promise<void> {
  // Remove old repeatable jobs
  const repeatables = await slaQueue.getRepeatableJobs();
  for (const job of repeatables) {
    await slaQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job every hour
  await slaQueue.add('SLA_CHECK', {}, {
    repeat: {
      every: 60 * 60 * 1000, // every hour
    },
  });
}
