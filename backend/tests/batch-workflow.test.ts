import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: { batch: Record<string, unknown> | null; approvals: Array<Record<string, unknown>> } = {
    batch: null,
    approvals: [],
  };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    batch: {
      findUnique: vi.fn(async () => state.batch),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.batch = { ...state.batch, ...data, version: Number(state.batch?.version ?? 0) + 1 };
        return state.batch;
      }),
    },
    approval: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.approvals.find((approval) =>
          Object.entries(where).every(([key, value]) => approval[key] === value)
        ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const approval = { ...data, superseded: false };
        state.approvals.push(approval);
        return approval;
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        state.approvals.filter((approval) =>
          Object.entries(where).every(([key, value]) => approval[key] === value)
        ).length
      ),
    },
  };

  return {
    state,
    tx,
    transaction: vi.fn(),
    batchFindUnique: vi.fn(async () => state.batch),
    batchFindMany: vi.fn(),
    batchUpdate: vi.fn(),
    candidateFindMany: vi.fn(),
    approvalFindMany: vi.fn(),
    auditLogFindMany: vi.fn(),
    publishEvent: vi.fn(),
    addCertificateJob: vi.fn(),
  };
});

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    $transaction = mocks.transaction;
    batch = {
      findUnique: mocks.batchFindUnique,
      findMany: mocks.batchFindMany,
      update: mocks.batchUpdate,
    };
    candidate = { findMany: mocks.candidateFindMany };
    approval = { findMany: mocks.approvalFindMany };
    auditLog = { findMany: mocks.auditLogFindMany };
  },
  BatchStatus: {
    DRAFT: 'DRAFT',
    PENDING_DISTRICT_REVIEW: 'PENDING_DISTRICT_REVIEW',
    DISTRICT_APPROVED: 'DISTRICT_APPROVED',
    PENDING_QUALITY_REVIEW: 'PENDING_QUALITY_REVIEW',
    QUALITY_APPROVED: 'QUALITY_APPROVED',
    PENDING_STATE_APPROVAL: 'PENDING_STATE_APPROVAL',
    APPROVED: 'APPROVED',
    CERTIFICATES_ISSUED: 'CERTIFICATES_ISSUED',
    SENT_BACK: 'SENT_BACK',
    REJECTED: 'REJECTED',
  },
  Role: {
    CENTRE: 'CENTRE',
    DISTRICT_OFFICER: 'DISTRICT_OFFICER',
    QUALITY_TEAM: 'QUALITY_TEAM',
    STATE_OFFICE: 'STATE_OFFICE',
  },
}));

vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const users: Record<string, NonNullable<express.Request['user']>> = {
      dev: {
        id: 'dev-user',
        name: 'Dev',
        email: 'dev@example.test',
        role: 'DISTRICT_OFFICER',
        districtId: 'district-1',
        centreId: null,
      },
      meera: {
        id: 'meera-user',
        name: 'Meera',
        email: 'meera@example.test',
        role: 'DISTRICT_OFFICER',
        districtId: 'district-1',
        centreId: null,
      },
      neha: {
        id: 'neha-user',
        name: 'Neha',
        email: 'neha@example.test',
        role: 'QUALITY_TEAM',
        districtId: null,
        centreId: null,
      },
      anika: {
        id: 'anika-user',
        name: 'Anika',
        email: 'anika@example.test',
        role: 'CENTRE',
        districtId: 'district-1',
        centreId: 'centre-1',
      },
    };
    req.user = users[req.header('x-test-user') ?? 'dev'];
    next();
  },
}));

vi.mock('../src/middleware/rbac', () => ({
  requireRole: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../src/events', () => ({
  publishEvent: mocks.publishEvent,
}));

vi.mock('../src/queues', () => ({
  addCertificateJob: mocks.addCertificateJob,
}));

import batchRoutes from '../src/routes/batch.routes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/batches', batchRoutes);
  return app;
}

describe('batch approval workflow', () => {
  let transactionTail: Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    transactionTail = Promise.resolve();
    mocks.state.batch = {
      id: 'batch-1',
      centreId: 'centre-1',
      districtId: 'district-1',
      title: 'Digital Skills',
      candidateCount: 3,
      status: 'PENDING_DISTRICT_REVIEW',
      version: 1,
      rejectionReason: null,
    };
    mocks.state.approvals = [];
    mocks.batchFindUnique.mockImplementation(async () => mocks.state.batch);
    mocks.tx.batch.findUnique.mockImplementation(async () => mocks.state.batch);
    mocks.tx.approval.findFirst.mockImplementation(async ({ where }) =>
      mocks.state.approvals.find((approval) =>
        Object.entries(where).every(([key, value]) => approval[key] === value)
      ) ?? null
    );
    mocks.tx.approval.create.mockImplementation(async ({ data }) => {
      const approval = { ...data, superseded: false };
      mocks.state.approvals.push(approval);
      return approval;
    });
    mocks.tx.approval.count.mockImplementation(async ({ where }) =>
      mocks.state.approvals.filter((approval) =>
        Object.entries(where).every(([key, value]) => approval[key] === value)
      ).length
    );
    mocks.tx.batch.update.mockImplementation(async ({ data }) => {
      mocks.state.batch = {
        ...mocks.state.batch,
        ...data,
        version: Number(mocks.state.batch?.version ?? 0) + 1,
      };
      return mocks.state.batch;
    });
    mocks.transaction.mockImplementation(async (operation) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await operation(mocks.tx);
      } finally {
        release();
      }
    });
  });

  it('serializes simultaneous district approvals and advances the batch once at quorum', async () => {
    const app = createApp();
    const [devResponse, meeraResponse] = await Promise.all([
      request(app).post('/api/batches/batch-1/approve').set('x-test-user', 'dev').send({}),
      request(app).post('/api/batches/batch-1/approve').set('x-test-user', 'meera').send({}),
    ]);

    expect(devResponse.status).toBe(200);
    expect(meeraResponse.status).toBe(200);
    expect(mocks.state.approvals).toHaveLength(2);
    expect(mocks.state.batch?.status).toBe('PENDING_STATE_APPROVAL');
    expect(mocks.publishEvent).toHaveBeenCalledWith('role:STATE_OFFICE', expect.objectContaining({
      status: 'PENDING_STATE_APPROVAL',
    }));
    expect(mocks.publishEvent.mock.calls.filter(([channel]) => channel === 'role:STATE_OFFICE')).toHaveLength(1);
  });

  it('rejects duplicate or out-of-stage approvals without recording a decision', async () => {
    const app = createApp();

    const first = await request(app)
      .post('/api/batches/batch-1/approve')
      .set('x-test-user', 'dev')
      .send({})
      .expect(200);
    expect(first.body.newStatus).toBe('PENDING_DISTRICT_REVIEW');

    await request(app)
      .post('/api/batches/batch-1/approve')
      .set('x-test-user', 'dev')
      .send({})
      .expect(409);

    await request(app)
      .post('/api/batches/batch-1/approve')
      .set('x-test-user', 'neha')
      .send({})
      .expect(409);

    expect(mocks.state.approvals).toHaveLength(1);
  });

  it('reports invalid spreadsheet rows without starting a database transaction', async () => {
    const response = await request(createApp())
      .post('/api/batches/upload')
      .set('x-test-user', 'anika')
      .field('title', 'Imported batch')
      .attach(
        'file',
        Buffer.from('name,phone,course,score\nAsha,9876543210,Web Development,90\nBad,not-a-phone,Web Development,80'),
        { filename: 'candidates.csv', contentType: 'text/csv' }
      )
      .expect(400);

    expect(response.body.rowErrors).toEqual([
      {
        row: 3,
        errors: [{ field: 'phone', message: 'Phone must be a 10-digit number' }],
      },
    ]);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
