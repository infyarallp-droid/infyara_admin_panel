import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import NotificationBell from './NotificationBell';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/students', label: 'Students', icon: '🧘' },
  { to: '/courses', label: 'Courses', icon: '📚' },
  { to: '/invoices', label: 'Invoices', icon: '🧾' },
  { to: '/inventory', label: 'Inventory', icon: '🛍️' },
  { to: '/employees', label: 'Employees', icon: '👥' },
  { to: '/leads', label: 'Leads', icon: '📥' },
  { to: '/renewals', label: 'Renewals Due', icon: '🔁' },
  { to: '/consent-templates', label: 'Consent Templates', icon: '📝' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <div className="text-lg font-bold text-brand">Moksha Wellness</div>
          <div className="text-xs text-slate-400">Yoga • Pilates • Dance</div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand/10 text-brand' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-5 py-4">
          <div className="text-sm font-medium">{user?.name}</div>
          <div className="mb-2 text-xs text-slate-400">{user?.role}</div>
          <button onClick={logout} className="text-xs text-red-600 hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <header className="sticky top-0 z-40 flex items-center justify-end border-b border-slate-200 bg-white/80 px-8 py-3 backdrop-blur">
          <NotificationBell />
        </header>
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
