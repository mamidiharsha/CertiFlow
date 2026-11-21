import { Users } from 'lucide-react';
import { useState } from 'react';
import { DEMO_USERS } from '../types';
import { useAuth } from '../context/AuthContext';
import RoleBadge from './RoleBadge';
import { clsx } from 'clsx';

export default function DemoUserSwitcher() {
  const { user, switchUser } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const handleSwitch = async (email: string) => {
    setSwitching(email);
    try {
      await switchUser(email);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {expanded && (
        <div className="mb-2 w-72 rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="border-b border-gray-100 px-4 py-3">
            <h4 className="text-sm font-semibold text-gray-900">Switch Demo User</h4>
            <p className="text-xs text-gray-500">Click to instantly switch</p>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {DEMO_USERS.map((demoUser) => {
              const isActive = user?.email === demoUser.email;
              return (
                <button
                  key={demoUser.email}
                  onClick={() => handleSwitch(demoUser.email)}
                  disabled={switching !== null}
                  className={clsx(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'bg-indigo-50 ring-1 ring-indigo-200'
                      : 'hover:bg-gray-50'
                  )}
                >
                  <div
                    className={clsx(
                      'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-200 text-gray-600'
                    )}
                  >
                    {demoUser.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{demoUser.name}</span>
                      {switching === demoUser.email && (
                        <span className="text-xs text-indigo-500">Switching…</span>
                      )}
                    </div>
                    <RoleBadge role={demoUser.role} />
                  </div>
                  {isActive && (
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className={clsx(
          'flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105',
          expanded
            ? 'bg-gray-800 text-white'
            : 'bg-indigo-600 text-white hover:bg-indigo-700'
        )}
      >
        <Users className="h-5 w-5" />
      </button>
    </div>
  );
}
