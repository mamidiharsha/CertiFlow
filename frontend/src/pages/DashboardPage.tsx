import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listBatches } from '../api/batches';
import { listCertificates } from '../api/certificates';
import { UserRole, BatchStatus } from '../types';
import type { Batch } from '../types';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import { FolderOpen, Clock, CheckCircle2, AlertCircle, Award, FileWarning } from 'lucide-react';
import { format } from 'date-fns';

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function RecentBatches({ batches, title }: { batches: Batch[]; title: string }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="divide-y divide-gray-100">
        {batches.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">No batches yet</p>
        ) : (
          batches.slice(0, 5).map((batch) => (
            <div
              key={batch.id}
              onClick={() => navigate(`/batches/${batch.id}`)}
              className="flex cursor-pointer items-center justify-between px-5 py-3 hover:bg-gray-50"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{batch.title}</p>
                <p className="text-xs text-gray-500">
                  {batch.candidateCount} candidates
                  {batch.submittedAt && ` • Submitted ${format(new Date(batch.submittedAt), 'MMM d')}`}
                </p>
              </div>
              <StatusBadge status={batch.status} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: batches = [], isLoading: batchesLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: listBatches,
  });

  const { data: certificates = [], isLoading: certsLoading } = useQuery({
    queryKey: ['certificates'],
    queryFn: listCertificates,
    enabled: user?.role === UserRole.STATE_OFFICE,
  });

  if (batchesLoading || (user?.role === UserRole.STATE_OFFICE && certsLoading)) {
    return <LoadingSpinner className="mt-20" label="Loading dashboard…" />;
  }

  const pendingStatuses = [
    BatchStatus.PENDING_DISTRICT_REVIEW,
    BatchStatus.PENDING_QUALITY_REVIEW,
    BatchStatus.PENDING_STATE_APPROVAL,
  ];

  const approvedStatuses = [
    BatchStatus.APPROVED,
    BatchStatus.CERTIFICATES_ISSUED,
    BatchStatus.DISTRICT_APPROVED,
    BatchStatus.QUALITY_APPROVED,
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Welcome back, {user?.name}</p>
      </div>

      {/* CENTRE Dashboard */}
      {user?.role === UserRole.CENTRE && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="My Batches"
              value={batches.length}
              icon={FolderOpen}
              color="bg-indigo-500"
            />
            <StatCard
              label="Pending"
              value={batches.filter((b) => pendingStatuses.includes(b.status as BatchStatus)).length}
              icon={Clock}
              color="bg-yellow-500"
            />
            <StatCard
              label="Approved"
              value={batches.filter((b) => approvedStatuses.includes(b.status as BatchStatus)).length}
              icon={CheckCircle2}
              color="bg-green-500"
            />
          </div>
          <RecentBatches batches={batches} title="Recent Batches" />
        </>
      )}

      {/* DISTRICT OFFICER Dashboard */}
      {user?.role === UserRole.DISTRICT_OFFICER && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Awaiting Review"
              value={batches.filter((b) => b.status === BatchStatus.PENDING_DISTRICT_REVIEW).length}
              icon={Clock}
              color="bg-yellow-500"
            />
            <StatCard
              label="Approved by Me"
              value={batches.filter((b) =>
                b.status === BatchStatus.DISTRICT_APPROVED ||
                b.status === BatchStatus.PENDING_QUALITY_REVIEW ||
                b.status === BatchStatus.QUALITY_APPROVED ||
                b.status === BatchStatus.PENDING_STATE_APPROVAL ||
                b.status === BatchStatus.APPROVED ||
                b.status === BatchStatus.CERTIFICATES_ISSUED
              ).length}
              icon={CheckCircle2}
              color="bg-green-500"
            />
          </div>
          <RecentBatches
            batches={batches.filter((b) => b.status === BatchStatus.PENDING_DISTRICT_REVIEW)}
            title="Pending District Review"
          />
        </>
      )}

      {/* QUALITY TEAM Dashboard */}
      {user?.role === UserRole.QUALITY_TEAM && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Large Batches for Review"
              value={batches.filter((b) => b.status === BatchStatus.PENDING_QUALITY_REVIEW).length}
              icon={FileWarning}
              color="bg-violet-500"
            />
            <StatCard
              label="Reviewed"
              value={batches.filter((b) =>
                b.status === BatchStatus.QUALITY_APPROVED ||
                b.status === BatchStatus.PENDING_STATE_APPROVAL ||
                b.status === BatchStatus.APPROVED ||
                b.status === BatchStatus.CERTIFICATES_ISSUED
              ).length}
              icon={CheckCircle2}
              color="bg-green-500"
            />
          </div>
          <RecentBatches
            batches={batches.filter((b) => b.status === BatchStatus.PENDING_QUALITY_REVIEW)}
            title="Batches Pending Quality Review"
          />
        </>
      )}

      {/* STATE OFFICE Dashboard */}
      {user?.role === UserRole.STATE_OFFICE && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Pending Final Approval"
              value={batches.filter((b) => b.status === BatchStatus.PENDING_STATE_APPROVAL).length}
              icon={Clock}
              color="bg-purple-500"
            />
            <StatCard
              label="Overdue Batches"
              value={batches.filter((b) => {
                if (!pendingStatuses.includes(b.status as BatchStatus)) return false;
                if (!b.submittedAt) return false;
                const hours = (Date.now() - new Date(b.submittedAt).getTime()) / 3600000;
                return hours > 48;
              }).length}
              icon={AlertCircle}
              color="bg-red-500"
            />
            <StatCard
              label="Total Certificates Issued"
              value={certificates.length}
              icon={Award}
              color="bg-emerald-500"
            />
          </div>
          <RecentBatches
            batches={batches.filter((b) => b.status === BatchStatus.PENDING_STATE_APPROVAL)}
            title="Pending State Approval"
          />
        </>
      )}
    </div>
  );
}
