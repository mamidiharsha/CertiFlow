import { Worker, Job } from 'bullmq';
import { PrismaClient, BatchStatus } from '@prisma/client';
import { config } from '../config';
import { publishEvent } from '../events';

const prisma = new PrismaClient();

const STALE_STATUSES: BatchStatus[] = [
  BatchStatus.PENDING_DISTRICT_REVIEW,
  BatchStatus.PENDING_QUALITY_REVIEW,
  BatchStatus.PENDING_STATE_APPROVAL,
];

export function startSlaWorker(): Worker {
  const worker = new Worker(
    'sla-check',
    async (_job: Job) => {
      console.log('[SLAWorker] Running SLA check...');

      const cutoff = new Date(Date.now() - config.slaHours * 60 * 60 * 1000);

      const staleBatches = await prisma.batch.findMany({
        where: {
          status: { in: STALE_STATUSES },
          updatedAt: { lt: cutoff },
        },
        include: {
          centre: true,
          district: true,
        },
      });

      if (staleBatches.length === 0) {
        console.log('[SLAWorker] No stale batches found.');
        return;
      }

      console.log(`[SLAWorker] Found ${staleBatches.length} stale batches.`);

      for (const batch of staleBatches) {
        const hoursStale = Math.round(
          (Date.now() - batch.updatedAt.getTime()) / (60 * 60 * 1000)
        );

        const event = {
          type: 'batch_stale',
          batchId: batch.id,
          title: batch.title,
          status: batch.status,
          hoursIdle: hoursStale,
          slaHours: config.slaHours,
          centreName: batch.centre.name,
          districtName: batch.district.name,
        };

        // Publish to relevant channels
        await publishEvent(`batch:${batch.id}`, event);

        if (batch.status === BatchStatus.PENDING_DISTRICT_REVIEW) {
          await publishEvent(`district:${batch.districtId}`, event);
        }
        if (batch.status === BatchStatus.PENDING_QUALITY_REVIEW) {
          await publishEvent('role:QUALITY_TEAM', event);
        }
        if (batch.status === BatchStatus.PENDING_STATE_APPROVAL) {
          await publishEvent('role:STATE_OFFICE', event);
        }

        // Audit log for stale batch
        await prisma.auditLog.create({
          data: {
            action: 'SLA_BREACH',
            entityType: 'batch',
            entityId: batch.id,
            details: {
              status: batch.status,
              hoursIdle: hoursStale,
              slaHours: config.slaHours,
            },
          },
        });
      }
    },
    {
      connection: { url: config.redisUrl },
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[SLAWorker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[SLAWorker] Job ${job?.id} failed:`, error);
  });

  return worker;
}
