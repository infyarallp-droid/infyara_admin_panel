import { lazy, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Students = lazy(() => import('./pages/Students'));
const StudentProfile = lazy(() => import('./pages/StudentProfile'));
const ConsentForm = lazy(() => import('./pages/ConsentForm'));
const ConsentTemplates = lazy(() => import('./pages/ConsentTemplates'));
const Courses = lazy(() => import('./pages/Courses'));
const Renewals = lazy(() => import('./pages/Renewals'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Leads = lazy(() => import('./pages/Leads'));
const WebsiteLogins = lazy(() => import('./pages/WebsiteLogins'));
const OnlinePayments = lazy(() => import('./pages/OnlinePayments'));
const WhatsApp = lazy(() => import('./pages/WhatsApp'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const WebsiteContent = lazy(() => import('./pages/cms/WebsiteContent'));
const Team = lazy(() => import('./pages/cms/Team'));
const Testimonials = lazy(() => import('./pages/cms/Testimonials'));
const Faqs = lazy(() => import('./pages/cms/Faqs'));
const Announcements = lazy(() => import('./pages/cms/Announcements'));
const Gallery = lazy(() => import('./pages/cms/Gallery'));
const Blog = lazy(() => import('./pages/cms/Blog'));
const ZoomClasses = lazy(() => import('./pages/ZoomClasses'));
const Programmes = lazy(() => import('./pages/cms/Programmes'));

const MANAGERS = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

/** Hides a page from roles that may not use it (the API enforces the same rule). */
function RoleGate({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="py-16 text-center text-slate-500">
        <p className="font-medium text-slate-700">You don't have access to this page.</p>
        <p className="text-sm">Ask an administrator if you need it.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentProfile />} />
            <Route path="courses" element={<Courses />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="employees" element={<Employees />} />
            <Route path="employees/:id" element={<EmployeeDetail />} />
            <Route path="leads" element={<Leads />} />
            <Route path="renewals" element={<Renewals />} />
            <Route path="zoom-classes" element={<RoleGate roles={[...MANAGERS, 'FRONT_DESK', 'TRAINER']}><ZoomClasses /></RoleGate>} />
            <Route path="consent/:id" element={<ConsentForm />} />
            <Route path="consent-templates" element={<ConsentTemplates />} />
            <Route path="website-logins" element={<RoleGate roles={[...MANAGERS, 'FRONT_DESK']}><WebsiteLogins /></RoleGate>} />
            <Route path="online-payments" element={<RoleGate roles={[...MANAGERS, 'ACCOUNTANT']}><OnlinePayments /></RoleGate>} />
            <Route path="whatsapp" element={<RoleGate roles={MANAGERS}><WhatsApp /></RoleGate>} />
            <Route path="website/content" element={<RoleGate roles={MANAGERS}><WebsiteContent /></RoleGate>} />
            <Route path="website/programmes" element={<RoleGate roles={MANAGERS}><Programmes /></RoleGate>} />
            <Route path="website/team" element={<RoleGate roles={MANAGERS}><Team /></RoleGate>} />
            <Route path="website/testimonials" element={<RoleGate roles={MANAGERS}><Testimonials /></RoleGate>} />
            <Route path="website/faqs" element={<RoleGate roles={MANAGERS}><Faqs /></RoleGate>} />
            <Route path="website/announcements" element={<RoleGate roles={MANAGERS}><Announcements /></RoleGate>} />
            <Route path="website/gallery" element={<RoleGate roles={MANAGERS}><Gallery /></RoleGate>} />
            <Route path="website/blog" element={<RoleGate roles={MANAGERS}><Blog /></RoleGate>} />
            <Route path="audit" element={<RoleGate roles={['SUPER_ADMIN', 'ADMIN']}><AuditLog /></RoleGate>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
