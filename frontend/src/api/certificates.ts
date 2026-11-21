import client from './client';
import type { Certificate, PublicCertificateVerification } from '../types';

export async function listCertificates(): Promise<Certificate[]> {
  const { data } = await client.get('/certificates');
  return data.certificates ?? data;
}

export async function cancelCertificate(id: string, reason: string): Promise<Certificate> {
  const { data } = await client.post(`/certificates/${id}/cancel`, { reason });
  return data.certificate ?? data;
}

export async function retryCertificateDelivery(id: string): Promise<void> {
  await client.post(`/certificates/${id}/retry-delivery`);
}

export async function verifyCertificate(certNumber: string): Promise<PublicCertificateVerification> {
  const { data } = await client.get(`/certificates/verify/${encodeURIComponent(certNumber)}`);
  return data;
}
