import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCertificates, cancelCertificate } from '../api/certificates';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import LoadingSpinner from '../components/LoadingSpinner';
import { CertificateStatus } from '../types';
import type { Certificate } from '../types';
import { format } from 'date-fns';
import { clsx } from 'clsx';
import toast from 'react-hot-toast';
import { Award, XCircle } from 'lucide-react';

export default function CertificatesPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<Certificate | null>(null);
  const [reason, setReason] = useState('');

  const { data: certificates = [], isLoading } = useQuery({
    queryKey: ['certificates'],
    queryFn: listCertificates,
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => cancelCertificate(id, reason),
    onSuccess: () => {
      toast.success('Certificate cancelled');
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      setCancelTarget(null);
      setReason('');
    },
  });

  if (isLoading) {
    return <LoadingSpinner className="mt-20" label="Loading certificates…" />;
  }

  const columns = [
    {
      key: 'certificateNumber',
      header: 'Number',
      render: (c: Certificate) => (
        <span className="font-mono text-sm font-medium text-gray-900">{c.certificateNumber}</span>
      ),
    },
    {
      key: 'candidate',
      header: 'Candidate',
      render: (c: Certificate) => c.candidate?.name ?? '—',
    },
    {
      key: 'course',
      header: 'Course',
      render: (c: Certificate) => c.candidate?.course ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (c: Certificate) => (
        <span
          className={clsx(
            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
            c.status === CertificateStatus.ACTIVE
              ? 'bg-green-50 text-green-700 ring-green-300'
              : 'bg-red-50 text-red-700 ring-red-300'
          )}
        >
          {c.status}
        </span>
      ),
    },
    {
      key: 'issuedAt',
      header: 'Issued Date',
      render: (c: Certificate) => (
        <span className="text-gray-500">{format(new Date(c.issuedAt), 'MMM d, yyyy')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (c: Certificate) =>
        c.status === CertificateStatus.ACTIVE ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCancelTarget(c);
            }}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Certificates</h1>
        <p className="text-sm text-gray-500">{certificates.length} total certificates</p>
      </div>

      <DataTable<Certificate>
        columns={columns}
        data={certificates}
        keyExtractor={(c) => c.id}
        emptyMessage="No certificates issued yet"
        emptyIcon={<Award className="h-12 w-12 text-gray-300" />}
      />

      {/* Cancel Modal */}
      <Modal
        open={cancelTarget !== null}
        onClose={() => { setCancelTarget(null); setReason(''); }}
        title="Cancel Certificate"
      >
        <p className="mb-2 text-sm text-gray-500">
          Are you sure you want to cancel certificate{' '}
          <strong>{cancelTarget?.certificateNumber}</strong>?
        </p>
        <p className="mb-3 text-sm text-gray-500">
          This action cannot be undone. The certificate will be marked as cancelled.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Enter cancellation reason (required)"
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => { setCancelTarget(null); setReason(''); }}
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
              if (cancelTarget) {
                cancelMutation.mutate({ id: cancelTarget.id, reason });
              }
            }}
            disabled={cancelMutation.isPending}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Confirm Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
