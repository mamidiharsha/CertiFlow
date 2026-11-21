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

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        res.status(400).json({ error: 'Empty spreadsheet' });
        return;
      }

      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        res.status(400).json({ error: 'Empty sheet' });
        return;
      }

      const rows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (rows.length === 0) {
        res.status(400).json({ error: 'No data rows found in spreadsheet' });
        return;
      }

      // Validate every row
      const errors: Array<{ row: number; errors: Array<{ field: string; message: string }> }> = [];
      const validatedRows: Array<{ name: string; phone: string; course: string; score: number }> = [];

      for (let i = 0; i < rows.length; i++) {
        const result = candidateRowSchema.safeParse(rows[i]);
        if (!result.success) {
          errors.push({
            row: i + 2, // +2 for 1-indexed + header row
            errors: result.error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          });
        } else {
          validatedRows.push({
            name: result.data.name,
            phone: String(result.data.phone),
            course: result.data.course,
            score: Number(result.data.score),
          });
        }
      }

      if (errors.length > 0) {
        res.status(400).json({
          error: 'Validation failed',
          totalRows: rows.length,
          errorCount: errors.length,
          rowErrors: errors,
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
            candidateCount: validatedRows.length,
            status: BatchStatus.DRAFT,
          },
        });

        await tx.candidate.createMany({
          data: validatedRows.map((row) => ({
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

// POST /api/batches/:id/submit — CENTRE only
router.post(
  '/:id/submit',
  requireRole(Role.CENTRE),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const batch = await prisma.batch.findUnique({
        where: { id: req.params.id },
      });

      if (!batch) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      if (batch.centreId !== req.user!.centreId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.SENT_BACK) {
        res.status(400).json({ error: `Cannot submit batch in ${batch.status} status` });
        return;
      }

      const updatedBatch = await prisma.$transaction(async (tx) => {
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

      await publishEvent(`district:${batch.districtId}`, {
        type: 'batch_status_changed',
        batchId: batch.id,
        status: BatchStatus.PENDING_DISTRICT_REVIEW,
        title: batch.title,
      });

      res.json({ message: 'Batch submitted for review', batch: updatedBatch });
    } catch (error) {
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

      const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { district: true },
      });

      if (!batch) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      // Validate role-status combinations
      const allowedTransitions: Record<string, BatchStatus[]> = {
        [Role.DISTRICT_OFFICER]: [BatchStatus.PENDING_DISTRICT_REVIEW],
        [Role.QUALITY_TEAM]: [BatchStatus.PENDING_QUALITY_REVIEW],
        [Role.STATE_OFFICE]: [BatchStatus.PENDING_STATE_APPROVAL],
      };

      if (!allowedTransitions[user.role]?.includes(batch.status)) {
        res.status(400).json({
          error: `Cannot approve: batch is in ${batch.status} status, your role is ${user.role}`,
        });
        return;
      }

      // District officer must be from the same district
      if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
        res.status(403).json({ error: 'Access denied: different district' });
        return;
      }

      // Check if this officer already approved (non-superseded)
      if (user.role === Role.DISTRICT_OFFICER) {
        const existingApproval = await prisma.approval.findFirst({
          where: {
            batchId,
            userId: user.id,
            superseded: false,
            action: 'APPROVED',
          },
        });
        if (existingApproval) {
          res.status(400).json({ error: 'You have already approved this batch' });
          return;
        }
      }

      const readVersion = batch.version;

      const result = await prisma.$transaction(async (tx) => {
        // Create approval record
        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'APPROVED',
            reason: req.body.reason || null,
          },
        });

        let newStatus: BatchStatus = batch.status;
        let shouldGenerateCertificates = false;

        if (user.role === Role.DISTRICT_OFFICER) {
          // Count non-superseded approvals for this batch at district level
          const approvalCount = await tx.approval.count({
            where: {
              batchId,
              superseded: false,
              action: 'APPROVED',
              stage: BatchStatus.PENDING_DISTRICT_REVIEW,
            },
          });

          if (approvalCount >= config.districtQuorum) {
            // Quorum reached — determine next stage
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

        // Optimistic locking: update only if version matches
        if (newStatus !== batch.status) {
          const updateResult = await tx.batch.updateMany({
            where: {
              id: batchId,
              version: readVersion,
            },
            data: {
              status: newStatus,
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });

          if (updateResult.count === 0) {
            throw new Error('CONFLICT');
          }
        }

        return { newStatus, shouldGenerateCertificates };
      });

      // After transaction: emit events and enqueue jobs
      if (result.newStatus !== batch.status) {
        await publishEvent(`batch:${batchId}`, {
          type: 'batch_status_changed',
          batchId,
          status: result.newStatus,
          title: batch.title,
        });

        // Role-specific channels
        if (result.newStatus === BatchStatus.PENDING_QUALITY_REVIEW) {
          await publishEvent('role:QUALITY_TEAM', {
            type: 'batch_status_changed',
            batchId,
            status: result.newStatus,
            title: batch.title,
          });
        }
        if (result.newStatus === BatchStatus.PENDING_STATE_APPROVAL) {
          await publishEvent('role:STATE_OFFICE', {
            type: 'batch_status_changed',
            batchId,
            status: result.newStatus,
            title: batch.title,
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
        statusChanged: result.newStatus !== batch.status,
        newStatus: result.newStatus,
      });
    } catch (error: any) {
      if (error?.message === 'CONFLICT') {
        res.status(409).json({
          error: 'Conflict: batch was modified by another user. Please refresh and try again.',
        });
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
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ error: 'Rejection reason is required' });
        return;
      }

      const batch = await prisma.batch.findUnique({ where: { id: batchId } });

      if (!batch) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const readVersion = batch.version;

      await prisma.$transaction(async (tx) => {
        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'REJECTED',
            reason,
          },
        });

        const updateResult = await tx.batch.updateMany({
          where: { id: batchId, version: readVersion },
          data: {
            status: BatchStatus.REJECTED,
            rejectionReason: reason,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        if (updateResult.count === 0) {
          throw new Error('CONFLICT');
        }
      });

      await publishEvent(`batch:${batchId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.REJECTED,
        title: batch.title,
      });

      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { centre: true, district: true },
      });

      res.json({ message: 'Batch rejected', batch: updatedBatch });
    } catch (error: any) {
      if (error?.message === 'CONFLICT') {
        res.status(409).json({ error: 'Conflict: batch was modified. Please refresh.' });
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
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ error: 'Reason for sending back is required' });
        return;
      }

      const batch = await prisma.batch.findUnique({ where: { id: batchId } });

      if (!batch) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      if (user.role === Role.DISTRICT_OFFICER && batch.districtId !== user.districtId) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const readVersion = batch.version;

      await prisma.$transaction(async (tx) => {
        await tx.approval.create({
          data: {
            id: uuidv4(),
            batchId,
            userId: user.id,
            stage: batch.status,
            action: 'SENT_BACK',
            reason,
          },
        });

        const updateResult = await tx.batch.updateMany({
          where: { id: batchId, version: readVersion },
          data: {
            status: BatchStatus.SENT_BACK,
            rejectionReason: reason,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });

        if (updateResult.count === 0) {
          throw new Error('CONFLICT');
        }
      });

      await publishEvent(`batch:${batchId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.SENT_BACK,
        title: batch.title,
      });

      // Notify the centre
      await publishEvent(`centre:${batch.centreId}`, {
        type: 'batch_status_changed',
        batchId,
        status: BatchStatus.SENT_BACK,
        title: batch.title,
        reason,
      });

      const updatedBatch = await prisma.batch.findUnique({
        where: { id: batchId },
        include: { centre: true, district: true },
      });

      res.json({ message: 'Batch sent back', batch: updatedBatch });
    } catch (error: any) {
      if (error?.message === 'CONFLICT') {
        res.status(409).json({ error: 'Conflict: batch was modified. Please refresh.' });
        return;
      }
      console.error('Send back error:', error);
      res.status(500).json({ error: 'Failed to send back batch' });
    }
  }
);

export default router;
