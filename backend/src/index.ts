import app from './app';
import { config } from './config';
import { setupSlaRepeatable } from './queues';
import { startCertificateWorker } from './workers/certificate.worker';
import { startWhatsAppWorker } from './workers/whatsapp.worker';
import { startSlaWorker } from './workers/sla.worker';

const server = app.listen(config.port, () => {
  console.log(`CertiFlow backend listening on port ${config.port}`);
});

const certificateWorker = startCertificateWorker();
const whatsappWorker = startWhatsAppWorker();
const slaWorker = startSlaWorker();

setupSlaRepeatable().catch((error) => {
  console.error('Failed to set up SLA repeatable job:', error);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down...`);
  server.close();
  await Promise.all([
    certificateWorker.close(),
    whatsappWorker.close(),
    slaWorker.close(),
  ]);
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
