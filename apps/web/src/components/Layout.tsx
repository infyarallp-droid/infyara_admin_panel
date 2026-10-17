import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import NotificationBell from './NotificationBell';
import logoMark from '../assets/logo-mark.png';
import { Loading } from './ui';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'FRONT_DESK' | 'ACCOUNTANT' | 'TRAINER';
const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

// Simple line icons (24×24, stroke = currentColor).
const ICONS: Record<string, string> = {
  dashboard: 'M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4Zm10-12h6V4h-6v4Z',
  students: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.9M15 3.1a3.5 3.5 0 0 1 0 6.8',
  courses: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm0 14a2 2 0 0 1 2-2h13',
  renew: 'M4 4v6h6M20 20v-6h-6M5.6 15a7 7 0 0 0 12.3 1.6M18.4 9A7 7 0 0 0 6.1 7.4',
  invoice: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3',
  card: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h3',
  bag: 'M6 7h12l-1 13H7L6 7Zm3 0V5a3 3 0 0 1 6 0v2',
  team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8Z',
  doc: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6m-6 4h6',
  login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  chat: 'M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12Z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z',
  star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Zm12-3a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14',
  image: 'M4 5h16v14H4V5Zm0 11 4-4 3 3 4-5 5 6M9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Zm9.5-13.5 4 4',
  video: 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm13 3.5 5-3v9l-5-3',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z',
  consent: 'M9 12l2 2 4-4M7 3h10v18H7z',
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  roles?: Role[];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Studio',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/students', label: 'Students', icon: 'students' },
      { to: '/courses', label: 'Courses', icon: 'courses' },
      { to: '/zoom-classes', label: 'Zoom Classes', icon: 'video', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK', 'TRAINER'] },
      { to: '/renewals', label: 'Renewals Due', icon: 'renew' },
      { to: '/leads', label: 'Leads', icon: 'inbox' },
      { to: '/consent-templates', label: 'Consent Templates', icon: 'consent' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/invoices', label: 'Invoices', icon: 'invoice' },
      { to: '/online-payments', label: 'Online Payments', icon: 'card', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'] },
      { to: '/inventory', label: 'Inventory', icon: 'bag' },
    ],
  },
  {
    group: 'People',
    items: [
      { to: '/website-logins', label: 'Website Logins', icon: 'login', roles: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'FRONT_DESK'] },
      { to: '/whatsapp', label: 'WhatsApp', icon: 'chat', roles: MANAGERS },
      { to: '/employees', label: 'Employees (HR)', icon: 'team' },
    ],
  },
  {
    group: 'Website',
    items: [
      { to: '/website/content', label: 'Page Content', icon: 'globe', roles: MANAGERS },
      { to: '/website/programmes', label: 'Programmes', icon: 'layers', roles: MANAGERS },
      { to: '/website/team', label: 'Team', icon: 'team', roles: MANAGERS },
      { to: '/website/testimonials', label: 'Testimonials', icon: 'star', roles: MANAGERS },
      { to: '/website/faqs', label: 'FAQs', icon: 'help', roles: MANAGERS },
      { to: '/website/announcements', label: 'Announcements', icon: 'megaphone', roles: MANAGERS },
      { to: '/website/gallery', label: 'Gallery & Media', icon: 'image', roles: MANAGERS },
      { to: '/website/blog', label: 'Blog', icon: 'pen', roles: MANAGERS },
    ],
  },
  {
    group: 'System',
    items: [{ to: '/audit', label: 'Audit Log & Jobs', icon: 'shield', roles: ['SUPER_ADMIN', 'ADMIN'] }],
  },
];

export function canSee(role: string | undefined, roles?: Role[]) {
  return !roles || roles.includes((role ?? '') as Role);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <img src={logoMark} alt="" className="h-10 w-auto" />
        <div className="leading-tight">
          <div className="whitespace-nowrap text-[13px] font-bold tracking-wide text-brand-fg">MOKSHA WELLNESS</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Admin panel</div>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => canSee(user?.role, i.roles));
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{g.group}</div>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                        isActive ? 'bg-brand-soft text-brand-fg' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                  >
                    <Icon name={n.icon} />
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-slate-200 px-5 py-4">
        <div className="truncate text-sm font-medium">{user?.name}</div>
        <div className="mb-2 text-xs text-slate-400">{user?.role?.replace('_', ' ')}</div>
        <button onClick={logout} className="text-xs font-medium text-red-600 hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3 lg:invisible">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-700 lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <img src={logoMark} alt="Moksha Wellness" className="h-8 w-auto lg:hidden" />
          </div>
          <NotificationBell />
        </header>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
