import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { PrismaClient, Role, CertificateStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { config } from '../config';
import { publishEvent } from '../events';
import { addWhatsAppJob } from '../queues';
import { createCertificateDownloadUrl } from '../services/certificate.service';

const router = Router();
const prisma = new PrismaClient();
const certificateDirectory = path.resolve(__dirname, '../../generated/certificates');

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
        deliveryAttempts: {
          orderBy: { lastAttemptAt: 'desc' },
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

// GET /api/certificates/:id/download — bearer-link access for the candidate
router.get('/:id/download', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;
  if (typeof token !== 'string') {
    res.status(401).json({ error: 'A valid download link is required' });
    return;
  }

  let claims: string | jwt.JwtPayload;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch {
    res.status(401).json({ error: 'Download link is invalid or expired' });
    return;
  }

  if (
    typeof claims === 'string' ||
    claims.purpose !== 'certificate-download' ||
    claims.certificateId !== req.params.id
  ) {
    res.status(401).json({ error: 'Download link is invalid or expired' });
    return;
  }

  try {
    const certificate = await prisma.certificate.findUnique({
      where: { id: req.params.id },
      select: {
        certificateNumber: true,
        status: true,
        pdfPath: true,
      },
    });

    if (!certificate) {
      res.status(404).json({ error: 'Certificate not found' });
      return;
    }
    if (certificate.status !== CertificateStatus.ACTIVE) {
      res.status(410).json({ error: 'This certificate is no longer available for download' });
      return;
    }
    if (!certificate.pdfPath) {
      res.status(404).json({ error: 'Certificate file is not available' });
      return;
    }

    const filePath = path.resolve(certificate.pdfPath);
    if (!filePath.startsWith(`${certificateDirectory}${path.sep}`) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Certificate file is not available' });
      return;
    }

    await prisma.auditLog.create({
      data: {
        action: 'CERTIFICATE_DOWNLOAD',
        entityType: 'certificate',
        entityId: req.params.id,
        details: { certificateNumber: certificate.certificateNumber },
        ipAddress: req.ip || req.socket.remoteAddress || null,
      },
    });

    const fileName = `${certificate.certificateNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');

    const file = fs.createReadStream(filePath);
    file.on('error', (error) => {
      console.error('Certificate download failed:', error);
      if (!res.headersSent) {
        res.status(404).json({ error: 'Certificate file is not available' });
      } else {
        res.destroy(error);
      }
    });
    file.pipe(res);
  } catch (error) {
    console.error('Certificate download error:', error);
    res.status(500).json({ error: 'Failed to download certificate' });
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

    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1000) {
      res.status(400).json({ error: 'A cancellation reason of 1–1000 characters is required' });
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

      const cancellation = await prisma.certificate.updateMany({
        where: { id: certificate.id, status: CertificateStatus.ACTIVE },
        data: {
          status: CertificateStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: req.user!.id,
          cancelReason: reason.trim(),
        },
      });
      if (cancellation.count === 0) {
        res.status(409).json({ error: 'Certificate was cancelled by another request' });
        return;
      }

      const updated = await prisma.certificate.findUnique({
        where: { id: certificate.id },
        include: { candidate: true, batch: { include: { centre: true } } },
      });

      // Publish event
      const event = {
        type: 'certificate_cancelled',
        certificateId: certificate.id,
        certificateNumber: certificate.certificateNumber,
        candidateName: certificate.candidate?.name,
      };
      await publishEvent(`batch:${certificate.batchId}`, event);
      await publishEvent('role:STATE_OFFICE', event);

      res.json({ message: 'Certificate cancelled', certificate: updated });
    } catch (error) {
      console.error('Cancel certificate error:', error);
      res.status(500).json({ error: 'Failed to cancel certificate' });
    }
  }
);

router.post(
  '/:id/retry-delivery',
  authenticate,
  requireRole(Role.STATE_OFFICE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const certificate = await prisma.certificate.findUnique({
        where: { id: req.params.id },
        include: {
          candidate: true,
          deliveryAttempts: { orderBy: { lastAttemptAt: 'desc' } },
        },
      });

      if (!certificate || !certificate.candidate) {
        res.status(404).json({ error: 'Certificate not found' });
        return;
      }
      if (certificate.status !== CertificateStatus.ACTIVE) {
        res.status(409).json({ error: 'Cancelled certificates cannot be delivered' });
        return;
      }

      const delivery = certificate.deliveryAttempts.find((attempt) => attempt.status === 'FAILED');
      if (!delivery) {
        res.status(409).json({ error: 'There is no failed delivery to retry' });
        return;
      }

      const claimed = await prisma.deliveryAttempt.updateMany({
        where: { id: delivery.id, status: 'FAILED' },
        data: {
          status: 'PENDING',
          error: null,
          lastAttemptAt: null,
          dispatchGeneration: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        res.status(409).json({ error: 'Delivery is already being retried' });
        return;
      }
      const retryAttempt = await prisma.deliveryAttempt.findUnique({
        where: { id: delivery.id },
      });
      if (!retryAttempt) {
        throw new Error(`Delivery attempt ${delivery.id} disappeared after it was claimed`);
      }

      try {
        await addWhatsAppJob(
          certificate.id,
          delivery.candidatePhone,
          certificate.candidate.name,
          certificate.certificateNumber,
          createCertificateDownloadUrl(certificate.id),
          delivery.idempotencyKey,
          `wa-${delivery.idempotencyKey}-${retryAttempt.dispatchGeneration}`
        );
      } catch (error) {
        await prisma.deliveryAttempt.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', error: 'Failed to enqueue delivery retry' },
        });
        throw error;
      }

      res.status(202).json({ message: 'Delivery retry queued' });
    } catch (error) {
      console.error('Retry certificate delivery error:', error);
      res.status(500).json({ error: 'Failed to queue delivery retry' });
    }
  }
);

// GET /api/verify/:certificateNumber — PUBLIC (no auth)
router.get('/verify/:certificateNumber', async (req: Request, res: Response): Promise<void> => {
  try {
    const { certificateNumber } = req.params;

    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber },
      select: {
        certificateNumber: true,
        status: true,
        issuedAt: true,
        cancelledAt: true,
        candidate: {
          select: {
            name: true,
            course: true,
          },
        },
        batch: {
          select: {
            centre: {
              select: { name: true },
            },
          },
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
        certificateNumber: certificate.certificateNumber,
        status: certificate.status,
        issuedAt: certificate.issuedAt,
        cancelledAt: certificate.cancelledAt,
        candidateName: certificate.candidate?.name ?? null,
        courseName: certificate.candidate?.course ?? null,
        trainingCentre: certificate.batch.centre.name,
      },
    };

    res.json(response);
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

export default router;
