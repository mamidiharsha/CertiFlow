import express from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  publishEvent: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    certificate = {
      findUnique: mocks.findUnique,
      update: mocks.update,
      updateMany: mocks.updateMany,
      findMany: vi.fn(),
    };
    auditLog = { create: mocks.auditCreate };
  },
  Role: {
    CENTRE: 'CENTRE',
    DISTRICT_OFFICER: 'DISTRICT_OFFICER',
    QUALITY_TEAM: 'QUALITY_TEAM',
    STATE_OFFICE: 'STATE_OFFICE',
  },
  CertificateStatus: {
    ACTIVE: 'ACTIVE',
    CANCELLED: 'CANCELLED',
  },
}));

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user: { id: string; role: string } }).user = {
      id: 'state-user-id',
      role: 'STATE_OFFICE',
    };
    next();
  },
}));

vi.mock('../src/middleware/rbac', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../src/events', () => ({
  publishEvent: mocks.publishEvent,
}));

import certificateRoutes from '../src/routes/certificate.routes';

const certificateNumber = 'PSM-2026-MH12-000001';
const issuedAt = new Date('2026-11-20T12:00:00.000Z');
const cancelledAt = new Date('2026-11-21T12:00:00.000Z');
const downloadTestPath = path.resolve(process.cwd(), 'generated', 'certificates', 'verification-test.pdf');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/certificates', certificateRoutes);
  return app;
}

function createCertificate(status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE') {
  return {
    id: 'internal-certificate-id',
    certificateNumber,
    status,
    issuedAt,
    cancelledAt: status === 'CANCELLED' ? cancelledAt : null,
    cancelledBy: 'internal-user-id',
    cancelReason: 'Internal reason',
    pdfPath: 'C:\\private\\certificate.pdf',
    candidateId: 'internal-candidate-id',
    batchId: 'internal-batch-id',
    candidate: {
      id: 'internal-candidate-id',
      batchId: 'internal-batch-id',
      name: 'Asha Patel',
      phone: '9876543210',
      course: 'Web Development',
      score: 97,
      certificateId: 'internal-certificate-id',
    },
    batch: {
      id: 'internal-batch-id',
      centreId: 'internal-centre-id',
      districtId: 'internal-district-id',
      title: 'Private batch title',
      candidateCount: 1,
      status: 'CERTIFICATES_ISSUED',
      version: 3,
      createdAt: issuedAt,
      updatedAt: issuedAt,
      centre: { id: 'internal-centre-id', name: 'Pragati Skills Academy' },
    },
  };
}

describe('public certificate verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(downloadTestPath)) {
      fs.unlinkSync(downloadTestPath);
    }
  });

  it('returns verification details without candidate or internal personal data', async () => {
    mocks.findUnique.mockResolvedValue(createCertificate());
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const response = await request(createApp())
      .get(`/api/certificates/verify/${certificateNumber}`)
      .expect(200);

    expect(response.body).toEqual({
      valid: true,
      status: 'ACTIVE',
      certificate: {
        certificateNumber,
        status: 'ACTIVE',
        issuedAt: issuedAt.toISOString(),
        cancelledAt: null,
        candidateName: 'Asha Patel',
        courseName: 'Web Development',
        trainingCentre: 'Pragati Skills Academy',
      },
    });

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        certificateNumber: true,
        candidate: { select: { name: true, course: true } },
      }),
    }));
  });

  it('reports a certificate as cancelled on the next lookup after cancellation', async () => {
    let storedCertificate = createCertificate();
    mocks.findUnique.mockImplementation(async () => storedCertificate);
    mocks.updateMany.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      storedCertificate = { ...storedCertificate, ...data, status: 'CANCELLED', cancelledAt };
      return { count: 1 };
    });
    mocks.publishEvent.mockResolvedValue(undefined);

    await request(createApp())
      .post(`/api/certificates/${storedCertificate.id}/cancel`)
      .send({ reason: 'Invalid assessment results' })
      .expect(200);

    const response = await request(createApp())
      .get(`/api/certificates/verify/${certificateNumber}`)
      .expect(200);

    expect(response.body.valid).toBe(false);
    expect(response.body.status).toBe('CANCELLED');
    expect(response.body.certificate.cancelledAt).toBe(cancelledAt.toISOString());
    expect(response.body.certificate).not.toHaveProperty('cancelReason');
  });

  it('rejects invalid download links and prevents downloads after cancellation', async () => {
    const app = createApp();
    const token = jwt.sign(
      { purpose: 'certificate-download', certificateId: 'internal-certificate-id' },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    await request(app)
      .get(`/api/certificates/internal-certificate-id/download?token=invalid`)
      .expect(401);

    mocks.findUnique.mockResolvedValue({
      certificateNumber,
      status: 'CANCELLED',
      pdfPath: null,
    });

    await request(app)
      .get(`/api/certificates/internal-certificate-id/download?token=${encodeURIComponent(token)}`)
      .expect(410);
  });

  it('serves an active certificate only with its matching signed link and audits the download', async () => {
    fs.mkdirSync(path.dirname(downloadTestPath), { recursive: true });
    fs.writeFileSync(downloadTestPath, '%PDF-1.4 test');
    mocks.findUnique.mockResolvedValue({
      certificateNumber,
      status: 'ACTIVE',
      pdfPath: downloadTestPath,
    });
    mocks.auditCreate.mockResolvedValue({});
    const token = jwt.sign(
      { purpose: 'certificate-download', certificateId: 'internal-certificate-id' },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    await request(createApp())
      .get(`/api/certificates/internal-certificate-id/download?token=${encodeURIComponent(token)}`)
      .expect(200)
      .expect('Content-Type', 'application/pdf')
      .expect('Content-Disposition', /attachment/);

    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'CERTIFICATE_DOWNLOAD',
        entityId: 'internal-certificate-id',
      }),
    }));
  });
});
