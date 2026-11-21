import { clsx } from 'clsx';
import { UserRole } from '../types';

const roleConfig: Record<string, { label: string; className: string }> = {
  [UserRole.CENTRE]: { label: 'Centre', className: 'bg-blue-50 text-blue-700 ring-blue-300' },
  [UserRole.DISTRICT_OFFICER]: { label: 'District Officer', className: 'bg-indigo-50 text-indigo-700 ring-indigo-300' },
  [UserRole.QUALITY_TEAM]: { label: 'Quality Team', className: 'bg-violet-50 text-violet-700 ring-violet-300' },
  [UserRole.STATE_OFFICE]: { label: 'State Office', className: 'bg-emerald-50 text-emerald-700 ring-emerald-300' },
};

interface RoleBadgeProps {
  role: string;
  className?: string;
}

export default function RoleBadge({ role, className }: RoleBadgeProps) {
  const config = roleConfig[role] ?? { label: role, className: 'bg-gray-100 text-gray-700 ring-gray-300' };

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
