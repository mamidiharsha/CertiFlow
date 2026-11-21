import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getBatch, getBatchCandidates, getBatchApprovals, getBatchAuditLog, submitBatch, approveBatch, rejectBatch, sendBackBatch } from '../api/batches';
import { useAuth } from '../context/AuthContext';
import { UserRole, BatchStatus } from '../types';
import type { Candidate, Approval, AuditLogEntry } from '../types';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import ApprovalTimeline from '../components/ApprovalTimeline';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { clsx } from 'clsx';
import { format } from 'date-fns';
import { Send, CheckCircle2, XCircle, CornerDownLeft, AlertTriangle } from 'lucide-react';

type TabKey = 'candidates' | 'approvals' | 'audit';

export default function BatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabKey>('candidates');
  const [modalType, setModalType] = useState<'reject' | 'sendback' | null>(null);
  const [reason, setReason] = useState('');

  const { data: batch, isLoading } = useQuery({
    queryKey: ['batch', id],
    queryFn: () => getBatch(id!),
    enabled: !!id,
  });

  const { data: candidates = [] } = useQuery({
    queryKey: ['batch', id, 'candidates'],
    queryFn: () => getBatchCandidates(id!),
    enabled: !!id && activeTab === 'candidates',
  });

  const { data: approvals = [] } = useQuery({
    queryKey: ['batch', id, 'approvals'],
    queryFn: () => getBatchApprovals(id!),
    enabled: !!id && activeTab === 'approvals',
  });

  const { data: auditLog = [] } = useQuery({
    queryKey: ['batch', id, 'audit'],
    queryFn: () => getBatchAuditLog(id!),
    enabled: !!id && activeTab === 'audit',
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['batch', id] });
    queryClient.invalidateQueries({ queryKey: ['batches'] });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitBatch(id!),
    onSuccess: () => { toast.success('Batch submitted for approval'); invalidate(); },
  });

  const approveMutation = useMutation({
    mutationFn: (r?: string) => approveBatch(id!, r),
    onSuccess: () => { toast.success('Batch approved'); invalidate(); },
  });

  const rejectMutation = useMutation({
    mutationFn: (r: string) => rejectBatch(id!, r),
    onSuccess: () => { toast.success('Batch rejected'); invalidate(); setModalType(null); setReason(''); },
  });

  const sendBackMutation = useMutation({
    mutationFn: (r: string) => sendBackBatch(id!, r),
    onSuccess: () => { toast.success('Batch sent back'); invalidate(); setModalType(null); setReason(''); },
  });

  if (isLoading || !batch) {
    return <LoadingSpinner className="mt-20" label="Loading batch…" />;
  }

  const isCentre = user?.role === UserRole.CENTRE;
  const isOfficer = user?.role === UserRole.DISTRICT_OFFICER;
  const isQuality = user?.role === UserRole.QUALITY_TEAM;
  const isState = user?.role === UserRole.STATE_OFFICE;

  const canSubmit = isCentre && (batch.status === BatchStatus.DRAFT || batch.status === BatchStatus.SENT_BACK);
  const canOfficerAct = isOfficer && batch.status === BatchStatus.PENDING_DISTRICT_REVIEW;
  const canQualityAct = isQuality && batch.status === BatchStatus.PENDING_QUALITY_REVIEW;
  const canStateAct = isState && batch.status === BatchStatus.PENDING_STATE_APPROVAL;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'candidates', label: 'Candidates' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'audit', label: 'Audit Log' },
  ];

  const candidateColumns = [
    { key: 'name', header: 'Name', render: (c: Candidate) => <span className="font-medium">{c.name}</span> },
    { key: 'phone', header: 'Phone' },
    { key: 'course', header: 'Course' },
    { key: 'score', header: 'Score', render: (c: Candidate) => <span className="tabular-nums">{c.score}</span> },
    { key: 'certificateId', header: 'Certificate', render: (c: Candidate) => c.certificateId ? <span className="text-green-600 text-xs">Issued</span> : <span className="text-gray-400 text-xs">—</span> },
  ];

  const auditColumns = [
    { key: 'action', header: 'Action', render: (l: AuditLogEntry) => <span className="font-medium">{l.action}</span> },
    { key: 'user', header: 'User', render: (l: AuditLogEntry) => l.user?.name ?? '—' },
    { key: 'createdAt', header: 'Time', render: (l: AuditLogEntry) => format(new Date(l.createdAt), 'MMM d, yyyy h:mm a') },
    { key: 'details', header: 'Details', render: (l: AuditLogEntry) => l.details ? <span className="text-xs text-gray-500">{JSON.stringify(l.details)}</span> : '—' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{batch.title}</h1>
              <StatusBadge status={batch.status} />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {batch.centre?.name ?? 'Unknown Centre'} • {batch.candidateCount} candidates
              {batch.submittedAt && ` • Submitted ${format(new Date(batch.submittedAt), 'MMM d, yyyy')}`}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {canSubmit && (
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Submit for Approval
              </button>
            )}

            {(canOfficerAct || canQualityAct || canStateAct) && (
              <>
                <button
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {canStateAct ? 'Final Approve' : 'Approve'}
                </button>
                <button
                  onClick={() => setModalType('reject')}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
                <button
                  onClick={() => setModalType('sendback')}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
                >
                  <CornerDownLeft className="h-4 w-4" />
                  Send Back
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sent back/rejection reason */}
        {(batch.status === BatchStatus.SENT_BACK || batch.status === BatchStatus.REJECTED) && batch.rejectionReason && (
          <div className={clsx(
            'mt-4 flex items-start gap-3 rounded-lg p-4',
            batch.status === BatchStatus.REJECTED ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'
          )}>
            <AlertTriangle className={clsx('h-5 w-5 mt-0.5', batch.status === BatchStatus.REJECTED ? 'text-red-500' : 'text-orange-500')} />
            <div>
              <p className={clsx('text-sm font-medium', batch.status === BatchStatus.REJECTED ? 'text-red-800' : 'text-orange-800')}>
                {batch.status === BatchStatus.REJECTED ? 'Rejection Reason' : 'Sent Back Reason'}
              </p>
              <p className="mt-1 text-sm text-gray-700">{batch.rejectionReason}</p>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={clsx(
                'border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'candidates' && (
        <DataTable<Candidate>
          columns={candidateColumns}
          data={candidates}
          keyExtractor={(c) => c.id}
          emptyMessage="No candidates in this batch"
        />
      )}

      {activeTab === 'approvals' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <ApprovalTimeline approvals={approvals as Approval[]} />
        </div>
      )}

      {activeTab === 'audit' && (
        <DataTable<AuditLogEntry>
          columns={auditColumns}
          data={auditLog}
          keyExtractor={(l) => l.id}
          emptyMessage="No audit log entries"
        />
      )}

      {/* Reject / Send Back Modal */}
      <Modal
        open={modalType !== null}
        onClose={() => { setModalType(null); setReason(''); }}
        title={modalType === 'reject' ? 'Reject Batch' : 'Send Back Batch'}
      >
        <p className="mb-3 text-sm text-gray-500">
          {modalType === 'reject'
            ? 'Please provide a reason for rejecting this batch.'
            : 'Please provide a reason for sending this batch back for revision.'}
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter reason (required)"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => { setModalType(null); setReason(''); }}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!reason.trim()) {
                toast.error('Reason is required');
                return;
              }
              if (modalType === 'reject') {
                rejectMutation.mutate(reason);
              } else {
                sendBackMutation.mutate(reason);
              }
            }}
            disabled={rejectMutation.isPending || sendBackMutation.isPending}
            className={clsx(
              'rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
              modalType === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-500 hover:bg-orange-600'
            )}
          >
            {modalType === 'reject' ? 'Reject' : 'Send Back'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
