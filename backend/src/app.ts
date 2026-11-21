import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { auditMiddleware } from './middleware/audit';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth.routes';
import batchRoutes from './routes/batch.routes';
import certificateRoutes from './routes/certificate.routes';
import eventsRoutes from './routes/events.routes';

const app = express();

// Core middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Audit logging for all mutations
app.use(auditMiddleware);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/verify', (req, res, next) => {
  // The verify route is on the certificate router as /verify/:certificateNumber
  // but we mount it here separately for /api/verify/:certificateNumber
  next();
});
app.use('/api/events', eventsRoutes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
