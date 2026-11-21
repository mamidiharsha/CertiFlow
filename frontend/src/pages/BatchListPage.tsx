import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listBatches } from '../api/batches';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import type { Batch } from '../types';
import { format } from 'date-fns';
import { FolderOpen } from 'lucide-react';

export default function BatchListPage() {
  const navigate = useNavigate();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: listBatches,
  });

  if (isLoading) {
    return <LoadingSpinner className="mt-20" label="Loading batches…" />;
  }

  const columns = [
    {
      key: 'title',
      header: 'Title',
      render: (batch: Batch) => (
        <span className="font-medium text-gray-900">{batch.title}</span>
      ),
    },
    {
      key: 'centre',
      header: 'Centre',
      render: (batch: Batch) => (
        <span className="text-gray-600">{batch.centre?.name ?? '—'}</span>
      ),
    },
    {
      key: 'candidateCount',
      header: 'Candidates',
      render: (batch: Batch) => (
        <span className="tabular-nums">{batch.candidateCount}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (batch: Batch) => <StatusBadge status={batch.status} />,
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      render: (batch: Batch) =>
        batch.submittedAt ? (
          <span className="text-gray-500">
            {format(new Date(batch.submittedAt), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: () => (
        <span className="text-xs text-indigo-500 hover:text-indigo-700">View →</span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batches</h1>
          <p className="text-sm text-gray-500">{batches.length} total batches</p>
        </div>
      </div>

      <DataTable<Batch>
        columns={columns}
        data={batches}
        onRowClick={(batch) => navigate(`/batches/${batch.id}`)}
        keyExtractor={(b) => b.id}
        emptyMessage="No batches found"
        emptyIcon={<FolderOpen className="h-12 w-12 text-gray-300" />}
      />
    </div>
  );
}
