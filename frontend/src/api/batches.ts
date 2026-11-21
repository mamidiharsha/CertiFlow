import client from './client';
import type { Batch, Candidate, AuditLogEntry } from '../types';

export async function listBatches(): Promise<Batch[]> {
  const { data } = await client.get('/batches');
  return data.batches ?? data;
}

export async function getBatch(id: string): Promise<Batch> {
  const { data } = await client.get(`/batches/${id}`);
  return data.batch ?? data;
}

export async function uploadBatch(file: File, title: string): Promise<{ success: boolean; batch?: Batch; errors?: Array<{ row: number; field: string; message: string }> }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  const { data } = await client.post('/batches/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function submitBatch(id: string): Promise<Batch> {
  const { data } = await client.post(`/batches/${id}/submit`);
  return data.batch ?? data;
}

export async function approveBatch(id: string, reason?: string): Promise<Batch> {
  const { data } = await client.post(`/batches/${id}/approve`, { reason });
  return data.batch ?? data;
}

export async function rejectBatch(id: string, reason: string): Promise<Batch> {
  const { data } = await client.post(`/batches/${id}/reject`, { reason });
  return data.batch ?? data;
}

export async function sendBackBatch(id: string, reason: string): Promise<Batch> {
  const { data } = await client.post(`/batches/${id}/send-back`, { reason });
  return data.batch ?? data;
}

export async function getBatchCandidates(id: string): Promise<Candidate[]> {
  const { data } = await client.get(`/batches/${id}/candidates`);
  return data.candidates ?? data;
}

export async function getBatchApprovals(id: string): Promise<Array<{ id: string; batchId: string; userId: string; stage: string; action: string; reason?: string; superseded: boolean; createdAt: string; user?: { id: string; name: string; role: string } }>> {
  const { data } = await client.get(`/batches/${id}/approvals`);
  return data.approvals ?? data;
}

export async function getBatchAuditLog(id: string): Promise<AuditLogEntry[]> {
  const { data } = await client.get(`/batches/${id}/audit-log`);
  return data.logs ?? data.auditLogs ?? data;
}
