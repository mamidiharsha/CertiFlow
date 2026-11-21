import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export const auditMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!MUTATION_METHODS.includes(req.method)) {
    next();
    return;
  }

  // Store the original end function
  const originalEnd = res.end;
  const originalJson = res.json;

  let responseBody: any;

  // Intercept json to capture response
  res.json = function (body: any) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  // After response is sent, log to audit
  res.on('finish', async () => {
    try {
      // Only log successful mutations (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Determine entity type and ID from the URL
        const pathParts = req.path.split('/').filter(Boolean);
        // e.g., /api/batches/:id/approve -> entityType: 'batch', entityId: id
        let entityType = 'unknown';
        let entityId = 'unknown';

        if (pathParts.length >= 2) {
          entityType = pathParts[1] || 'unknown'; // 'batches', 'certificates', etc.
        }
        if (pathParts.length >= 3 && pathParts[2]) {
          entityId = pathParts[2];
        }

        const action = `${req.method} ${req.path}`;

        await prisma.auditLog.create({
          data: {
            userId: req.user?.id || null,
            action,
            entityType,
            entityId,
            details: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
            },
            ipAddress: req.ip || req.socket.remoteAddress || null,
          },
        });
      }
    } catch (error) {
      console.error('Audit logging failed:', error);
    }
  });

  next();
};
