import { format } from 'date-fns';
import { CheckCircle2, XCircle, CornerDownLeft, User as UserIcon } from 'lucide-react';
import type { Approval } from '../types';
import { ApprovalAction } from '../types';
import { clsx } from 'clsx';

interface ApprovalTimelineProps {
  approvals: Approval[];
}

const actionConfig = {
  [ApprovalAction.APPROVED]: {
    icon: CheckCircle2,
    color: 'text-green-500',
    bgColor: 'bg-green-50',
    label: 'Approved',
  },
  [ApprovalAction.REJECTED]: {
    icon: XCircle,
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    label: 'Rejected',
  },
  [ApprovalAction.SENT_BACK]: {
    icon: CornerDownLeft,
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    label: 'Sent Back',
  },
};

export default function ApprovalTimeline({ approvals }: ApprovalTimelineProps) {
  if (approvals.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-gray-400">
        <UserIcon className="h-10 w-10" />
        <p className="mt-3 text-sm">No approval actions yet</p>
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {approvals.map((approval, idx) => {
          const config = actionConfig[approval.action] ?? actionConfig[ApprovalAction.APPROVED];
          const Icon = config.icon;
          const isLast = idx === approvals.length - 1;

          return (
            <li key={approval.id}>
              <div className="relative pb-8">
                {!isLast && (
                  <span className="absolute top-5 left-5 -ml-px h-full w-0.5 bg-gray-200" />
                )}
                <div className="relative flex items-start space-x-3">
                  <div
                    className={clsx(
                      'flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-white',
                      config.bgColor
                    )}
                  >
                    <Icon className={clsx('h-5 w-5', config.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {approval.user?.name ?? 'Unknown User'}
                      </span>
                      <span
                        className={clsx(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          config.bgColor,
                          config.color
                        )}
                      >
                        {config.label}
                      </span>
                      {approval.superseded && (
                        <span className="text-xs text-gray-400 italic">(superseded)</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {approval.stage} •{' '}
                      {format(new Date(approval.createdAt), 'MMM d, yyyy h:mm a')}
                    </p>
                    {approval.reason && (
                      <p className="mt-1 text-sm text-gray-600 italic">
                        "{approval.reason}"
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
