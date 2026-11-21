import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { PrismaClient, CertificateStatus } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

/**
 * Generate a unique certificate number using a counter table with row-level locking.
 * Format: PSM-{YYYY}-{DISTRICT_CODE}-{SEQ:6}
 */
export async function generateCertificateNumber(districtCode: string): Promise<string> {
  const year = new Date().getFullYear();

  // Upsert the sequence row and increment atomically
  const result = await prisma.$queryRaw<Array<{ last_seq: number }>>`
    INSERT INTO certificate_sequences (id, district_code, year, last_seq)
    VALUES (gen_random_uuid(), ${districtCode}, ${year}, 1)
    ON CONFLICT (district_code)
    DO UPDATE SET last_seq = certificate_sequences.last_seq + 1, year = ${year}
    RETURNING last_seq
  `;

  const seq = result[0].last_seq;
  const seqStr = String(seq).padStart(6, '0');

  return `PSM-${year}-${districtCode}-${seqStr}`;
}

/**
 * Generate a certificate PDF using PDFKit.
 */
export async function generateCertificatePDF(params: {
  certificateNumber: string;
  candidateName: string;
  courseName: string;
  trainingCentre: string;
  issueDate: Date;
}): Promise<string> {
  const { certificateNumber, candidateName, courseName, trainingCentre, issueDate } = params;

  const outputDir = path.resolve(__dirname, '../../generated/certificates');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const fileName = `${certificateNumber.replace(/\//g, '-')}.pdf`;
  const filePath = path.join(outputDir, fileName);

  return new Promise<string>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 50,
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Border
    doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(3).stroke('#1a365d');
    doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(1).stroke('#2b6cb0');

    // Title
    doc.fontSize(14).fillColor('#666').text('Government of Maharashtra', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#888').text('Pradhan Mantri Skill Mission', { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(32).fillColor('#1a365d').text('Certificate of Completion', { align: 'center' });
    doc.moveDown(1);

    // Decorative line
    const centerX = doc.page.width / 2;
    doc.moveTo(centerX - 100, doc.y).lineTo(centerX + 100, doc.y).lineWidth(2).stroke('#c5a44e');
    doc.moveDown(1);

    // Body text
    doc.fontSize(14).fillColor('#333').text('This is to certify that', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(26).fillColor('#1a365d').text(candidateName, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(14).fillColor('#333').text('has successfully completed the course', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(20).fillColor('#2b6cb0').text(`"${courseName}"`, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(14).fillColor('#333').text(`at ${trainingCentre}`, { align: 'center' });
    doc.moveDown(1.5);

    // Certificate details
    const dateStr = issueDate.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc.fontSize(11).fillColor('#555');
    doc.text(`Certificate No: ${certificateNumber}`, 80, doc.page.height - 120);
    doc.text(`Date of Issue: ${dateStr}`, 80, doc.page.height - 100);

    // Signature area
    doc.text('____________________________', doc.page.width - 300, doc.page.height - 120, { align: 'right' });
    doc.text('Authorized Signatory', doc.page.width - 300, doc.page.height - 100, { align: 'right' });

    doc.end();

    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

/**
 * Create a certificate record in the database.
 */
export async function createCertificate(params: {
  candidateId: string;
  batchId: string;
  districtCode: string;
  candidateName: string;
  courseName: string;
  trainingCentre: string;
}): Promise<{ id: string; certificateNumber: string; pdfPath: string }> {
  const certNumber = await generateCertificateNumber(params.districtCode);
  const issueDate = new Date();

  const pdfPath = await generateCertificatePDF({
    certificateNumber: certNumber,
    candidateName: params.candidateName,
    courseName: params.courseName,
    trainingCentre: params.trainingCentre,
    issueDate,
  });

  const certId = uuidv4();

  await prisma.$transaction(async (tx) => {
    await tx.certificate.create({
      data: {
        id: certId,
        certificateNumber: certNumber,
        candidateId: params.candidateId,
        batchId: params.batchId,
        status: CertificateStatus.ACTIVE,
        issuedAt: issueDate,
        pdfPath,
      },
    });

    await tx.candidate.update({
      where: { id: params.candidateId },
      data: { certificateId: certId },
    });
  });

  return { id: certId, certificateNumber: certNumber, pdfPath };
}
