export enum UserRole {
  CENTRE = 'CENTRE',
  DISTRICT_OFFICER = 'DISTRICT_OFFICER',
  QUALITY_TEAM = 'QUALITY_TEAM',
  STATE_OFFICE = 'STATE_OFFICE',
}

export enum BatchStatus {
  DRAFT = 'DRAFT',
  PENDING_DISTRICT_REVIEW = 'PENDING_DISTRICT_REVIEW',
  DISTRICT_APPROVED = 'DISTRICT_APPROVED',
  PENDING_QUALITY_REVIEW = 'PENDING_QUALITY_REVIEW',
  QUALITY_APPROVED = 'QUALITY_APPROVED',
  PENDING_STATE_APPROVAL = 'PENDING_STATE_APPROVAL',
  APPROVED = 'APPROVED',
  CERTIFICATES_ISSUED = 'CERTIFICATES_ISSUED',
  SENT_BACK = 'SENT_BACK',
  REJECTED = 'REJECTED',
}

export enum CertificateStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
}

export enum ApprovalAction {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SENT_BACK = 'SENT_BACK',
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  districtId?: string;
  centreId?: string;
}

export interface Batch {
  id: string;
  centreId: string;
  districtId: string;
  title: string;
  candidateCount: number;
  status: BatchStatus;
  version: number;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  centre?: { id: string; name: string };
  district?: { id: string; name: string };
  candidates?: Candidate[];
  approvals?: Approval[];
}

export interface Candidate {
  id: string;
  batchId: string;
  name: string;
  phone: string;
  course: string;
  score: number;
  certificateId?: string | null;
}

export interface Certificate {
  id: string;
  certificateNumber: string;
  candidateId: string;
  batchId: string;
  status: CertificateStatus;
  issuedAt: string;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  pdfPath?: string | null;
  candidate?: Candidate;
  batch?: Batch;
}

export interface Approval {
  id: string;
  batchId: string;
  userId: string;
  stage: string;
  action: ApprovalAction;
  reason?: string | null;
  superseded: boolean;
  createdAt: string;
  user?: User;
}

export interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
  user?: User;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface UploadResult {
  success: boolean;
  batch?: Batch;
  errors?: ValidationError[];
  candidates?: Candidate[];
}

export interface DemoUser {
  name: string;
  email: string;
  role: UserRole;
  description: string;
}

export const DEMO_USERS: DemoUser[] = [
  { name: 'Anika', email: 'anika@certiflow.in', role: UserRole.CENTRE, description: 'Centre Operator' },
  { name: 'Dev', email: 'dev@certiflow.in', role: UserRole.DISTRICT_OFFICER, description: 'District Officer' },
  { name: 'Meera', email: 'meera@certiflow.in', role: UserRole.DISTRICT_OFFICER, description: 'District Officer' },
  { name: 'Kabir', email: 'kabir@certiflow.in', role: UserRole.DISTRICT_OFFICER, description: 'District Officer' },
  { name: 'Neha', email: 'neha@certiflow.in', role: UserRole.QUALITY_TEAM, description: 'Quality Team' },
  { name: 'Farah', email: 'farah@certiflow.in', role: UserRole.STATE_OFFICE, description: 'State Office' },
];
