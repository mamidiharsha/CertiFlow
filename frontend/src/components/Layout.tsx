import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSSE } from '../hooks/useSSE';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import DemoUserSwitcher from './DemoUserSwitcher';
import RoleBadge from './RoleBadge';
import {
  LayoutDashboard,
  FolderOpen,
  Upload,
  Award,
  LogOut,
  Shield,
} from 'lucide-react';
import { UserRole } from '../types';
import { clsx } from 'clsx';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: null },
  { to: '/batches', label: 'Batches', icon: FolderOpen, roles: null },
  { to: '/batches/upload', label: 'Upload Batch', icon: Upload, roles: [UserRole.CENTRE] },
  { to: '/certificates', label: 'Certificates', icon: Award, roles: [UserRole.STATE_OFFICE] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { connected } = useSSE({
    onBatchStatusChanged: () => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      queryClient.invalidateQueries({ queryKey: ['batch'] });
    },
    onCertificateIssued: (data) => {
      toast.success(`Certificate issued: ${(data as { certificateNumber?: string }).certificateNumber ?? 'New certificate'}`);
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleNavItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role as UserRole))
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-100 px-6">
          <Shield className="h-7 w-7 text-indigo-600" />
          <span className="text-lg font-bold text-gray-900">CertiFlow</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Verification link */}
        <div className="border-t border-gray-100 px-3 py-3">
          <NavLink
            to="/verify"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-gray-400 hover:text-gray-600"
          >
            <Award className="h-4 w-4" />
            Public Verification
          </NavLink>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'h-2 w-2 rounded-full',
                connected ? 'bg-green-500' : 'bg-red-400'
              )}
              title={connected ? 'Real-time connected' : 'Disconnected'}
            />
            <span className="text-xs text-gray-400">
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <RoleBadge role={user.role} />
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      {/* Demo User Switcher — always visible */}
      <DemoUserSwitcher />
    </div>
  );
}
