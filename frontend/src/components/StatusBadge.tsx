import { clsx } from 'clsx';
import { BatchStatus } from '../types';

const statusConfig: Record<string, { label: string; className: string }> = {
  [BatchStatus.DRAFT]: { label: 'Draft', className: 'bg-gray-100 text-gray-700 ring-gray-300' },
  [BatchStatus.PENDING_DISTRICT_REVIEW]: { label: 'Pending District Review', className: 'bg-yellow-50 text-yellow-700 ring-yellow-300' },
  [BatchStatus.DISTRICT_APPROVED]: { label: 'District Approved', className: 'bg-blue-50 text-blue-700 ring-blue-300' },
  [BatchStatus.PENDING_QUALITY_REVIEW]: { label: 'Pending Quality Review', className: 'bg-amber-50 text-amber-700 ring-amber-300' },
  [BatchStatus.QUALITY_APPROVED]: { label: 'Quality Approved', className: 'bg-cyan-50 text-cyan-700 ring-cyan-300' },
  [BatchStatus.PENDING_STATE_APPROVAL]: { label: 'Pending State Approval', className: 'bg-purple-50 text-purple-700 ring-purple-300' },
  [BatchStatus.APPROVED]: { label: 'Approved', className: 'bg-green-50 text-green-700 ring-green-300' },
  [BatchStatus.CERTIFICATES_ISSUED]: { label: 'Certificates Issued', className: 'bg-emerald-50 text-emerald-700 ring-emerald-300' },
  [BatchStatus.SENT_BACK]: { label: 'Sent Back', className: 'bg-orange-50 text-orange-700 ring-orange-300' },
  [BatchStatus.REJECTED]: { label: 'Rejected', className: 'bg-red-50 text-red-700 ring-red-300' },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? { label: status, className: 'bg-gray-100 text-gray-700 ring-gray-300' };

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
