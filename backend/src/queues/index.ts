import { Queue } from 'bullmq';
import { config } from '../config';

export const certificateQueue = new Queue('certificate-generation', {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

export const whatsappQueue = new Queue('whatsapp-delivery', {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 4,
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
  const jobId = `cert-${batchId}`;
  const existing = await certificateQueue.getJob(jobId);
  if (existing) {
    if (await existing.getState() === 'failed') {
      await existing.retry('failed');
    }
    return;
  }

  await certificateQueue.add('BATCH_APPROVED', { batchId }, { jobId });
}

export async function addWhatsAppJob(
  certificateId: string,
  candidatePhone: string,
  candidateName: string,
  certificateNumber: string,
  pdfUrl: string,
  idempotencyKey: string,
  queueJobId = `wa-${idempotencyKey}-0`
): Promise<void> {
  const data = {
    certificateId,
    candidatePhone,
    candidateName,
    certificateNumber,
    pdfUrl,
    idempotencyKey,
  };
  const existing = await whatsappQueue.getJob(queueJobId);
  if (existing) {
    if (await existing.getState() === 'failed') {
      await existing.retry('failed');
    }
    return;
  }

  await whatsappQueue.add('DELIVER_CERTIFICATE', data, {
    jobId: queueJobId,
    attempts: 4,
    backoff: { type: 'custom' },
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

export async function setupCertificateReconciliation(): Promise<void> {
  const repeatables = await certificateQueue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === 'RECONCILE_APPROVED_BATCHES') {
      await certificateQueue.removeRepeatableByKey(job.key);
    }
  }

  await certificateQueue.add('RECONCILE_APPROVED_BATCHES', {}, {
    repeat: { every: 60 * 1000 },
  });
}

export async function setupDeliveryReconciliation(): Promise<void> {
  const repeatables = await whatsappQueue.getRepeatableJobs();
  for (const job of repeatables) {
    if (job.name === 'RECONCILE_PENDING_DELIVERIES') {
      await whatsappQueue.removeRepeatableByKey(job.key);
    }
  }

  await whatsappQueue.add('RECONCILE_PENDING_DELIVERIES', {}, {
    repeat: { every: 60 * 1000 },
  });
}
