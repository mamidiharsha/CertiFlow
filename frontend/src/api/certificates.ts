import client from './client';
import type { Certificate } from '../types';

export async function listCertificates(): Promise<Certificate[]> {
  const { data } = await client.get('/certificates');
  return data.certificates ?? data;
}

export async function cancelCertificate(id: string, reason: string): Promise<Certificate> {
  const { data } = await client.post(`/certificates/${id}/cancel`, { reason });
  return data.certificate ?? data;
}

export async function verifyCertificate(certNumber: string): Promise<{ valid: boolean; certificate?: Certificate }> {
  const { data } = await client.get(`/certificates/verify/${certNumber}`);
  return data;
}
