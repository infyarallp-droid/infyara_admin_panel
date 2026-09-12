import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import StudentProfile from './pages/StudentProfile';
import ConsentForm from './pages/ConsentForm';
import ConsentTemplates from './pages/ConsentTemplates';
import Courses from './pages/Courses';
import Renewals from './pages/Renewals';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Inventory from './pages/Inventory';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Leads from './pages/Leads';

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
            <Route path="consent/:id" element={<ConsentForm />} />
            <Route path="consent-templates" element={<ConsentTemplates />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
