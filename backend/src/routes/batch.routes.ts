import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { PrismaClient, BatchStatus, Role, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { config } from '../config';
import { publishEvent } from '../events';
import { addCertificateJob } from '../queues';

const router = Router();
const prisma = new PrismaClient();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, and .csv files are allowed'));
    }
  },
});

const candidateRowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z
    .string()
    .regex(/^\d{10}$/, 'Phone must be a 10-digit number')
    .or(z.number().transform((n) => String(n)).pipe(z.string().regex(/^\d{10}$/, 'Phone must be a 10-digit number'))),
  course: z.string().min(1, 'Course is required'),
  score: z.number().min(0, 'Score must be >= 0').max(100, 'Score must be <= 100')
    .or(z.string().transform((s) => parseFloat(s)).pipe(z.number().min(0).max(100))),
});

type CandidateData = {
  name: string;
  phone: string;
  course: string;
  score: number;
};

class BatchRouteError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function assertActionAllowed(
  user: { role: Role; districtId: string | null },
  batch: { status: BatchStatus; districtId: string },
): void {
  const expectedStatus: Partial<Record<Role, BatchStatus>> = {
    [Role.DISTRICT_OFFICER]: BatchStatus.PENDING_DISTRICT_REVIEW,
    [Role.QUALITY_TEAM]: BatchStatus.PENDING_QUALITY_REVIEW,
    [Role.STATE_OFFICE]: BatchStatus.PENDING_STATE_APPROVAL,
  };

  if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
    throw new BatchRouteError(403, 'Access denied: different district');
  }
  if (expectedStatus[user.role] !== batch.status) {
    throw new BatchRouteError(409, `Cannot act on a batch in ${batch.status} status`);
  }
}

function parseCandidateSpreadsheet(buffer: Buffer): {
  rows: CandidateData[];
  totalRows: number;
  rowErrors: Array<{ row: number; errors: Array<{ field: string; message: string }> }>;
  error?: string;
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { rows: [], totalRows: 0, rowErrors: [], error: 'Unable to read spreadsheet' };
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], totalRows: 0, rowErrors: [], error: 'Empty spreadsheet' };
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { rows: [], totalRows: 0, rowErrors: [], error: 'Empty sheet' };
  }

  const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  if (sourceRows.length === 0) {
    return { rows: [], totalRows: 0, rowErrors: [], error: 'No data rows found in spreadsheet' };
  }

  const rowErrors: Array<{ row: number; errors: Array<{ field: string; message: string }> }> = [];
  const rows: CandidateData[] = [];

  for (let index = 0; index < sourceRows.length; index++) {
    const result = candidateRowSchema.safeParse(sourceRows[index]);
    if (!result.success) {
      rowErrors.push({
        row: index + 2,
        errors: result.error.errors.map((error) => ({
          field: error.path.join('.'),
          message: error.message,
        })),
      });
    } else {
      rows.push({
        name: result.data.name.trim(),
        phone: String(result.data.phone),
        course: result.data.course.trim(),
        score: Number(result.data.score),
      });
    }
  }

  return { rows, totalRows: sourceRows.length, rowErrors };
}

// All routes require auth
router.use(authenticate);

// POST /api/batches/upload — CENTRE only
router.post(
  '/upload',
  requireRole(Role.CENTRE),
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const parsed = parseCandidateSpreadsheet(req.file.buffer);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      if (parsed.rowErrors.length > 0) {
        res.status(400).json({
          error: 'Validation failed',
          totalRows: parsed.totalRows,
          errorCount: parsed.rowErrors.length,
          rowErrors: parsed.rowErrors,
        });
        return;
      }

      const title = req.body.title || `Batch ${new Date().toISOString().split('T')[0]}`;

      // Create batch + candidates in a transaction
      const batch = await prisma.$transaction(async (tx) => {
        const newBatch = await tx.batch.create({
          data: {
            id: uuidv4(),
            centreId: req.user!.centreId!,
            districtId: req.user!.districtId!,
            title,
            candidateCount: parsed.rows.length,
            status: BatchStatus.DRAFT,
          },
        });

        await tx.candidate.createMany({
          data: parsed.rows.map((row) => ({
            id: uuidv4(),
            batchId: newBatch.id,
            name: row.name,
            phone: row.phone,
            course: row.course,
            score: row.score,
          })),
        });

        return newBatch;
      });

      const fullBatch = await prisma.batch.findUnique({
        where: { id: batch.id },
        include: {
          candidates: true,
          centre: true,
          district: true,
        },
      });

      res.status(201).json({
        message: 'Batch created successfully',
        batch: fullBatch,
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to process file upload' });
    }
  }
);

// GET /api/batches — List batches visible to current user
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    let where: Prisma.BatchWhereInput = {};

    switch (user.role) {
      case Role.CENTRE:
        where = { centreId: user.centreId! };
        break;
      case Role.DISTRICT_OFFICER:
        where = {
          districtId: user.districtId!,
          status: {
            in: [
              BatchStatus.PENDING_DISTRICT_REVIEW,
              BatchStatus.DISTRICT_APPROVED,
              BatchStatus.PENDING_QUALITY_REVIEW,
              BatchStatus.QUALITY_APPROVED,
              BatchStatus.PENDING_STATE_APPROVAL,
              BatchStatus.APPROVED,
              BatchStatus.CERTIFICATES_ISSUED,
              BatchStatus.REJECTED,
              BatchStatus.SENT_BACK,
            ],
          },
        };
        break;
      case Role.QUALITY_TEAM:
        where = { status: BatchStatus.PENDING_QUALITY_REVIEW };
        break;
      case Role.STATE_OFFICE:
        // State can see all batches (or filter by status)
        break;
    }

    const batches = await prisma.batch.findMany({
      where,
      include: {
        centre: true,
        district: true,
        _count: {
          select: { candidates: true, certificates: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ batches });
  } catch (error) {
    console.error('List batches error:', error);
    res.status(500).json({ error: 'Failed to list batches' });
  }
});

// GET /api/batches/:id — Batch detail with candidates
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      include: {
        candidates: {
          include: { certificate: true },
        },
        centre: true,
        district: true,
        approvals: {
          where: { superseded: false },
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    // Enforce visibility
    if (user.role === Role.CENTRE && batch.centreId !== user.centreId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ batch });
  } catch (error) {
    console.error('Get batch error:', error);
    res.status(500).json({ error: 'Failed to get batch' });
  }
});

router.get('/:id/candidates', async (req: Request, res: Response): Promise<void> => {
  try {
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      select: { id: true, centreId: true, districtId: true },
    });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const user = req.user!;
    if (
      (user.role === Role.CENTRE && batch.centreId !== user.centreId) ||
      (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const candidates = await prisma.candidate.findMany({
      where: { batchId: batch.id },
      orderBy: { name: 'asc' },
    });
    res.json({ candidates });
  } catch (error) {
    console.error('List batch candidates error:', error);
    res.status(500).json({ error: 'Failed to list batch candidates' });
  }
});

router.get('/:id/approvals', async (req: Request, res: Response): Promise<void> => {
  try {
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      select: { id: true, centreId: true, districtId: true },
    });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const user = req.user!;
    if (
      (user.role === Role.CENTRE && batch.centreId !== user.centreId) ||
      (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const approvals = await prisma.approval.findMany({
      where: { batchId: batch.id },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ approvals });
  } catch (error) {
    console.error('List batch approvals error:', error);
    res.status(500).json({ error: 'Failed to list batch approvals' });
  }
});

router.get('/:id/audit-log', async (req: Request, res: Response): Promise<void> => {
  try {
    const batch = await prisma.batch.findUnique({
      where: { id: req.params.id },
      select: { id: true, centreId: true, districtId: true },
    });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const user = req.user!;
    if (
      (user.role === Role.CENTRE && batch.centreId !== user.centreId) ||
      (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId)
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const logs = await prisma.auditLog.findMany({
      where: { entityId: batch.id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ logs });
  } catch (error) {
    console.error('List batch audit log error:', error);
    res.status(500).json({ error: 'Failed to list batch audit log' });
  }
});

// PUT /api/batches/:id/candidates — replace the spreadsheet for a DRAFT or SENT_BACK batch
router.put(
  '/:id/candidates',
  requireRole(Role.CENTRE),
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const parsed = parseCandidateSpreadsheet(req.file.buffer);
      if (parsed.error) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      if (parsed.rowErrors.length > 0) {
        res.status(400).json({
          error: 'Validation failed',
          totalRows: parsed.totalRows,
          errorCount: parsed.rowErrors.length,
          rowErrors: parsed.rowErrors,
        });
        return;
      }

      const batchId = req.params.id;
      const updatedBatch = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.batch.findUnique({ where: { id: batchId } });

        if (!batch) {
          throw new BatchRouteError(404, 'Batch not found');
        }
        if (batch.centreId !== req.user!.centreId) {
          throw new BatchRouteError(403, 'Access denied');
        }
        if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.SENT_BACK) {
          throw new BatchRouteError(409, 'Candidates can only be updated while the batch is a draft or has been sent back');
        }

        await tx.candidate.deleteMany({ where: { batchId } });
        await tx.candidate.createMany({
          data: parsed.rows.map((row) => ({ id: uuidv4(), batchId, ...row })),
        });

        return tx.batch.update({
          where: { id: batchId },
          data: {
            candidateCount: parsed.rows.length,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
          include: { centre: true, district: true },
        });
      });

      res.json({ message: 'Batch candidates replaced', batch: updatedBatch });
    } catch (error) {
      if (error instanceof BatchRouteError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Update batch candidates error:', error);
      res.status(500).json({ error: 'Failed to update batch candidates' });
    }
  }
);

// POST /api/batches/:id/submit — CENTRE only
router.post(
  '/:id/submit',
  requireRole(Role.CENTRE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const batchId = req.params.id;
      const updatedBatch = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.batch.findUnique({ where: { id: batchId } });
        if (!batch) {
          throw new BatchRouteError(404, 'Batch not found');
        }
        if (batch.centreId !== req.user!.centreId) {
          throw new BatchRouteError(403, 'Access denied');
        }
        if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.SENT_BACK) {
          throw new BatchRouteError(409, `Cannot submit batch in ${batch.status} status`);
        }

        // If resubmitting from SENT_BACK, supersede all prior approvals
        if (batch.status === BatchStatus.SENT_BACK) {
          await tx.approval.updateMany({
            where: { batchId: batch.id },
            data: { superseded: true },
          });
        }

        return tx.batch.update({
          where: { id: batch.id },
          data: {
            status: BatchStatus.PENDING_DISTRICT_REVIEW,
            submittedAt: new Date(),
            rejectionReason: null,
            version: { increment: 1 },
          },
          include: { centre: true, district: true },
        });
      });

      await publishEvent(`district:${updatedBatch.districtId}`, {
        type: 'batch_status_changed',
        batchId: updatedBatch.id,
        status: BatchStatus.PENDING_DISTRICT_REVIEW,
        title: updatedBatch.title,
      });

      res.json({ message: 'Batch submitted for review', batch: updatedBatch });
    } catch (error) {
      if (error instanceof BatchRouteError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Submit batch error:', error);
      res.status(500).json({ error: 'Failed to submit batch' });
    }
  }
);

// POST /api/batches/:id/approve
router.post(
  '/:id/approve',
  requireRole(Role.DISTRICT_OFFICER, Role.QUALITY_TEAM, Role.STATE_OFFICE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const batchId = req.params.id;
      const request = z.object({ reason: z.string().max(1000).optional() }).safeParse(req.body);
      if (!request.success) {
        res.status(400).json({ error: 'Invalid approval details' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.batch.findUnique({ where: { id: batchId } });
        if (!batch) {
          throw new BatchRouteError(404, 'Batch not found');
        }
        assertActionAllowed(user, batch);

        const existingApproval = await tx.approval.findFirst({
          where: {
            batchId,
            userId: user.id,
            stage: batch.status,
            superseded: false,
          },
        });
        if (existingApproval) {
          throw new BatchRouteError(409, 'You have already recorded a decision for this review stage');
        }

        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'APPROVED',
            reason: request.data.reason?.trim() || null,
          },
        });

        let newStatus: BatchStatus = batch.status;
        let shouldGenerateCertificates = false;

        if (user.role === Role.DISTRICT_OFFICER) {
          const approvalCount = await tx.approval.count({
            where: {
              batchId,
              superseded: false,
              action: 'APPROVED',
              stage: batch.status,
            },
          });

          if (approvalCount >= config.districtQuorum) {
            if (batch.candidateCount >= config.qualityThreshold) {
              newStatus = BatchStatus.PENDING_QUALITY_REVIEW;
            } else {
              newStatus = BatchStatus.PENDING_STATE_APPROVAL;
            }
          }
        } else if (user.role === Role.QUALITY_TEAM) {
          newStatus = BatchStatus.PENDING_STATE_APPROVAL;
        } else if (user.role === Role.STATE_OFFICE) {
          newStatus = BatchStatus.APPROVED;
          shouldGenerateCertificates = true;
        }

        await tx.batch.update({
          where: { id: batchId },
          data: {
            status: newStatus,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        return {
          newStatus,
          previousStatus: batch.status,
          title: batch.title,
          centreId: batch.centreId,
          districtId: batch.districtId,
          shouldGenerateCertificates,
        };
      });

      if (result.newStatus !== result.previousStatus) {
        const statusEvent = {
          type: 'batch_status_changed',
          batchId,
          status: result.newStatus,
          title: result.title,
        };
        await publishEvent(`batch:${batchId}`, statusEvent);
        await publishEvent(`centre:${result.centreId}`, statusEvent);
        await publishEvent(`district:${result.districtId}`, statusEvent);

        if (result.newStatus === BatchStatus.PENDING_QUALITY_REVIEW) {
          await publishEvent('role:QUALITY_TEAM', {
            type: 'batch_status_changed',
            batchId,
            status: result.newStatus,
            title: result.title,
          });
        }
        if (result.newStatus === BatchStatus.PENDING_STATE_APPROVAL) {
          await publishEvent('role:STATE_OFFICE', {
            type: 'batch_status_changed',
            batchId,
            status: result.newStatus,
            title: result.title,
          });
        }
      }

      if (result.shouldGenerateCertificates) {
        await addCertificateJob(batchId);
      }

      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: {
          centre: true,
          district: true,
          approvals: {
            where: { superseded: false },
            include: { user: { select: { id: true, name: true, role: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      res.json({
        message: 'Approval recorded',
        batch: updatedBatch,
        statusChanged: result.newStatus !== result.previousStatus,
        newStatus: result.newStatus,
      });
    } catch (error) {
      if (error instanceof BatchRouteError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Approve batch error:', error);
      res.status(500).json({ error: 'Failed to approve batch' });
    }
  }
);

// POST /api/batches/:id/reject
router.post(
  '/:id/reject',
  requireRole(Role.DISTRICT_OFFICER, Role.QUALITY_TEAM, Role.STATE_OFFICE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const batchId = req.params.id;
      const request = z.object({ reason: z.string().trim().min(1).max(1000) }).safeParse(req.body);
      if (!request.success) {
        res.status(400).json({ error: 'A rejection reason of 1–1000 characters is required' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.batch.findUnique({ where: { id: batchId } });
        if (!batch) {
          throw new BatchRouteError(404, 'Batch not found');
        }
        assertActionAllowed(user, batch);

        const priorDecision = await tx.approval.findFirst({
          where: { batchId, userId: user.id, stage: batch.status, superseded: false },
        });
        if (priorDecision) {
          throw new BatchRouteError(409, 'You have already recorded a decision for this review stage');
        }

        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'REJECTED',
            reason: request.data.reason,
          },
        });

        await tx.batch.update({
          where: { id: batchId },
          data: {
            status: BatchStatus.REJECTED,
            rejectionReason: request.data.reason,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        return { batch };
      });

      await publishEvent(`batch:${batchId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.REJECTED,
        title: result.batch.title,
        reason: request.data.reason,
      });
      await publishEvent(`centre:${result.batch.centreId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.REJECTED,
        title: result.batch.title,
        reason: request.data.reason,
      });

      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { centre: true, district: true },
      });

      res.json({ message: 'Batch rejected', batch: updatedBatch });
    } catch (error) {
      if (error instanceof BatchRouteError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Reject batch error:', error);
      res.status(500).json({ error: 'Failed to reject batch' });
    }
  }
);

// POST /api/batches/:id/send-back
router.post(
  '/:id/send-back',
  requireRole(Role.DISTRICT_OFFICER, Role.QUALITY_TEAM, Role.STATE_OFFICE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const batchId = req.params.id;
      const request = z.object({ reason: z.string().trim().min(1).max(1000) }).safeParse(req.body);
      if (!request.success) {
        res.status(400).json({ error: 'A send-back reason of 1–1000 characters is required' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.batch.findUnique({ where: { id: batchId } });
        if (!batch) {
          throw new BatchRouteError(404, 'Batch not found');
        }
        assertActionAllowed(user, batch);

        const priorDecision = await tx.approval.findFirst({
          where: { batchId, userId: user.id, stage: batch.status, superseded: false },
        });
        if (priorDecision) {
          throw new BatchRouteError(409, 'You have already recorded a decision for this review stage');
        }

        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'SENT_BACK',
            reason: request.data.reason,
          },
        });

        await tx.batch.update({
          where: { id: batchId },
          data: {
            status: BatchStatus.SENT_BACK,
            rejectionReason: request.data.reason,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        return { batch };
      });

      await publishEvent(`batch:${batchId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.SENT_BACK,
        title: result.batch.title,
        reason: request.data.reason,
      });

      // Notify the centre
      await publishEvent(`centre:${result.batch.centreId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.SENT_BACK,
        title: result.batch.title,
        reason: request.data.reason,
      });

      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { centre: true, district: true },
      });

      res.json({ message: 'Batch sent back', batch: updatedBatch });
    } catch (error) {
      if (error instanceof BatchRouteError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      console.error('Send back error:', error);
      res.status(500).json({ error: 'Failed to send back batch' });
    }
  }
);

export default router;
