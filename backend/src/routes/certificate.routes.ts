import { Router, Request, Response } from 'express';
import { PrismaClient, Role, CertificateStatus } from '@prisma/client';
import Redis from 'ioredis';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { config } from '../config';
import { publishEvent } from '../events';

const router = Router();
const prisma = new PrismaClient();

let redis: Redis;
try {
  redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true });
} catch {
  console.warn('Redis not available for certificate caching');
}

// GET /api/certificates — List certificates (filtered by role)
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    let where: any = {};

    switch (user.role) {
      case Role.CENTRE:
        where = {
          batch: { centreId: user.centreId },
        };
        break;
      case Role.DISTRICT_OFFICER:
        where = {
          batch: { districtId: user.districtId },
        };
        break;
      case Role.QUALITY_TEAM:
      case Role.STATE_OFFICE:
        // Can see all certificates
        break;
    }

    const certificates = await prisma.certificate.findMany({
      where,
      include: {
        candidate: true,
        batch: {
          include: { centre: true, district: true },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    res.json({ certificates });
  } catch (error) {
    console.error('List certificates error:', error);
    res.status(500).json({ error: 'Failed to list certificates' });
  }
});

// POST /api/certificates/:id/cancel — STATE_OFFICE only
router.post(
  '/:id/cancel',
  authenticate,
  requireRole(Role.STATE_OFFICE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ error: 'Cancellation reason is required' });
        return;
      }

      const certificate = await prisma.certificate.findUnique({
        where: { id: req.params.id },
        include: { candidate: true },
      });

      if (!certificate) {
        res.status(404).json({ error: 'Certificate not found' });
        return;
      }

      if (certificate.status === CertificateStatus.CANCELLED) {
        res.status(400).json({ error: 'Certificate is already cancelled' });
        return;
      }

      const updated = await prisma.certificate.update({
        where: { id: certificate.id },
        data: {
          status: CertificateStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: req.user!.id,
          cancelReason: reason,
        },
        include: { candidate: true, batch: { include: { centre: true } } },
      });

      // Invalidate Redis cache
      try {
        if (redis) {
          await redis.del(`cert:${certificate.certificateNumber}`);
        }
      } catch (e) {
        console.error('Failed to invalidate Redis cache:', e);
      }

      // Publish event
      await publishEvent(`batch:${certificate.batchId}`, {
        type: 'certificate_cancelled',
        certificateId: certificate.id,
        certificateNumber: certificate.certificateNumber,
        candidateName: certificate.candidate?.name,
      });

      res.json({ message: 'Certificate cancelled', certificate: updated });
    } catch (error) {
      console.error('Cancel certificate error:', error);
      res.status(500).json({ error: 'Failed to cancel certificate' });
    }
  }
);

// GET /api/verify/:certificateNumber — PUBLIC (no auth)
router.get('/verify/:certificateNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const { certificateNumber } = req.params;

    // Check Redis cache first
    try {
      if (redis) {
        const cached = await redis.get(`cert:${certificateNumber}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          res.json(parsed);
          return;
        }
      }
    } catch (e) {
      console.error('Redis cache read failed:', e);
    }

    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber },
      include: {
        candidate: true,
        batch: {
          include: { centre: true },
        },
      },
    });

    if (!certificate) {
      const response = {
        valid: false,
        status: 'NOT_FOUND' as const,
      };
      res.json(response);
      return;
    }

    const response = {
      valid: certificate.status === CertificateStatus.ACTIVE,
      status: certificate.status,
      certificate: {
        id: certificate.id,
        certificateNumber: certificate.certificateNumber,
        candidateId: certificate.candidateId,
        batchId: certificate.batchId,
        status: certificate.status,
        issuedAt: certificate.issuedAt,
        cancelledAt: certificate.cancelledAt,
        cancelledBy: certificate.cancelledBy,
        cancelReason: certificate.cancelReason,
        pdfPath: certificate.pdfPath,
        candidate: certificate.candidate
          ? {
              id: certificate.candidate.id,
              batchId: certificate.candidate.batchId,
              name: certificate.candidate.name,
              phone: certificate.candidate.phone,
              course: certificate.candidate.course,
              score: certificate.candidate.score,
              certificateId: certificate.candidate.certificateId,
            }
          : undefined,
        batch: {
          id: certificate.batch.id,
          centreId: certificate.batch.centreId,
          districtId: certificate.batch.districtId,
          title: certificate.batch.title,
          candidateCount: certificate.batch.candidateCount,
          status: certificate.batch.status,
          version: certificate.batch.version,
          createdAt: certificate.batch.createdAt,
          updatedAt: certificate.batch.updatedAt,
          centre: { id: certificate.batch.centre.id, name: certificate.batch.centre.name },
        },
      },
    };

    // Cache ACTIVE certificates in Redis (TTL 5 min). Do NOT cache CANCELLED.
    if (certificate.status === CertificateStatus.ACTIVE) {
      try {
        if (redis) {
          await redis.set(`cert:${certificateNumber}`, JSON.stringify(response), 'EX', 300);
        }
      } catch (e) {
        console.error('Redis cache write failed:', e);
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

export default router;
