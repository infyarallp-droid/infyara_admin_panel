import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSingleFlight } from '../lib/useSingleFlight';
import { fmtDate, STUDENT_STATUS } from '../lib/format';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';
import ImportStudentsDrawer from '../components/ImportStudentsDrawer';

interface Student {
  id: string;
  studentCode: string | null;
  fullName: string;
  mobile: string;
  email: string | null;
  status: string;
  isMinor: boolean;
  joiningDate: string | null;
  computedStatus: string;
  statusReason: string;
  currentCourses: string[];
}

interface Match {
  id: string;
  studentCode: string | null;
  fullName: string;
  mobile: string;
  email: string | null;
  matchedOn: string[];
}

const empty = {
  fullName: '',
  mobile: '',
  email: '',
  dob: '',
  gender: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
  isMinor: false,
  whatsappConsent: false,
};

export default function Students() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();
  const { user } = useAuth();
  const canImport = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['students', search, page],
    queryFn: async () => (await api.get('/api/students', { params: { search, page } })).data,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Students</h1>
          <p className="text-sm text-slate-500">Manage student records, enrollments and consent forms.</p>
        </div>
        <div className="flex gap-2">
          {canImport && (
            <Button variant="ghost" onClick={() => setImporting(true)}>
              Import old students
            </Button>
          )}
          <Button onClick={() => setDrawer(true)}>+ New Student</Button>
        </div>
      </div>

      <Card>
        <Input
          placeholder="Search by name, mobile, email or Student ID…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="mb-4 max-w-sm"
        />
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-red-600">
            Could not load students.{' '}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </p>
        ) : data?.items?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="py-2 pr-3 font-medium">Student ID</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Mobile</th>
                  <th className="py-2 pr-3 font-medium">Joining date</th>
                  <th className="py-2 pr-3 font-medium">Current course(s)</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data.items as Student[]).map((s) => {
                  const st = STUDENT_STATUS[s.computedStatus] ?? { label: s.computedStatus, tone: 'slate' as const };
                  return (
                    <tr key={s.id} className="border-b border-slate-50 align-top hover:bg-slate-50">
                      <td className="py-3 pr-3 text-slate-500">{s.studentCode ?? '—'}</td>
                      <td className="py-3 pr-3 font-medium">
                        {s.fullName} {s.isMinor && <Badge tone="amber">Minor</Badge>}
                        {s.email && <div className="text-xs font-normal text-slate-400">{s.email}</div>}
                      </td>
                      <td className="py-3 pr-3">{s.mobile}</td>
                      <td className="py-3 pr-3">{fmtDate(s.joiningDate)}</td>
                      <td className="py-3 pr-3 text-slate-600">
                        {s.currentCourses.length ? s.currentCourses.map((c) => <div key={c}>{c}</div>) : '—'}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <div className="mt-1 max-w-[220px] text-xs text-slate-400">{s.statusReason}</div>
                      </td>
                      <td className="py-3 text-right">
                        <Link to={`/students/${s.id}`} className="text-brand hover:underline">
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>
                {data.total} student{data.total === 1 ? '' : 's'}
              </span>
              {pages > 1 && (
                <span className="flex items-center gap-2">
                  <button className="hover:underline disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    ← Prev
                  </button>
                  Page {page} of {pages}
                  <button className="hover:underline disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next →
                  </button>
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="py-10 text-center text-slate-400">
            {search ? 'No students match this search.' : 'No students yet. Add your first one.'}
          </p>
        )}
      </Card>

      {drawer && (
        <StudentDrawer
          onClose={() => setDrawer(false)}
          onSaved={() => {
            setDrawer(false);
            qc.invalidateQueries({ queryKey: ['students'] });
          }}
        />
      )}
      {importing && (
        <ImportStudentsDrawer
          onClose={() => setImporting(false)}
          onImported={() => qc.invalidateQueries({ queryKey: ['students'] })}
        />
      )}
    </div>
  );
}

function StudentDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  // Set when the server reports an email match the admin may deliberately override.
  const [emailConflict, setEmailConflict] = useState(false);

  // Look for an existing student as soon as a full mobile or an email is typed.
  const mobileReady = /^\d{10}$/.test(form.mobile.trim());
  const emailReady = /^\S+@\S+\.\S+$/.test(form.email.trim());
  useEffect(() => {
    if (!mobileReady && !emailReady) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/api/students/match', {
          params: { mobile: mobileReady ? form.mobile.trim() : undefined, email: emailReady ? form.email.trim() : undefined },
        });
        if (!cancelled) setMatches(res.data.matches);
      } catch {
        /* the save itself re-checks, so a failed lookup is not fatal */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.mobile, form.email, mobileReady, emailReady]);

  const save = useMutation({
    mutationFn: async (confirmDifferentPerson: boolean) =>
      (await api.post('/api/students', { ...form, confirmDifferentPerson })).data,
    onSuccess: onSaved,
    onError: async (e: any) => {
      const body = e.response?.data;
      if (body?.existing) setMatches([{ ...body.existing, matchedOn: [body.code === 'STUDENT_EXISTS' ? 'mobile' : 'email'] }]);
      setEmailConflict(body?.code === 'POSSIBLE_DUPLICATE');
      setError(await apiError(e, 'Failed to save'));
    },
  });

  const set = (k: keyof typeof empty, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
    setEmailConflict(false);
  };
  const mobileTaken = matches.some((m) => m.matchedOn.includes('mobile'));
  const once = useSingleFlight();

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">New Student</h2>
        <div className="space-y-3">
          <Field label="Full name *">
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <Field label="Mobile *" hint="10-digit number">
            <Input inputMode="numeric" maxLength={10} value={form.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>

          {matches.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="mb-2 font-medium text-amber-800">
                {mobileTaken ? 'This student already exists' : 'Possible existing student'} — add the new course to the
                existing record instead of creating a duplicate.
              </p>
              <ul className="space-y-2">
                {matches.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{m.fullName}</span>
                      <span className="block text-xs text-slate-500">
                        {m.studentCode ?? ''} · {m.mobile}
                        {m.email ? ` · ${m.email}` : ''} · matched on {m.matchedOn.join(' & ')}
                      </span>
                    </span>
                    <Button variant="ghost" className="shrink-0 bg-white" onClick={() => navigate(`/students/${m.id}?enroll=1`)}>
                      Use &amp; enrol
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth">
              <Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} />
            </Field>
            <Field label="Gender">
              <Input value={form.gender} onChange={(e) => set('gender', e.target.value)} />
            </Field>
          </div>
          <Field label="Address">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency contact">
              <Input
                value={form.emergencyContactName}
                onChange={(e) => set('emergencyContactName', e.target.value)}
              />
            </Field>
            <Field label="Relationship">
              <Input
                value={form.emergencyContactRelation}
                onChange={(e) => set('emergencyContactRelation', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Emergency phone">
            <Input
              value={form.emergencyContactPhone}
              onChange={(e) => set('emergencyContactPhone', e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isMinor} onChange={(e) => set('isMinor', e.target.checked)} />
            Student is a minor (guardian signature required)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.whatsappConsent} onChange={(e) => set('whatsappConsent', e.target.checked)} />
            <span>
              Student agreed to receive WhatsApp reminders
              <span className="block text-xs text-slate-400">Tick only if they said yes (in person or on the admission form). Without it, no WhatsApp messages are sent.</span>
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {emailConflict && (
            <button
              type="button"
              className="text-sm text-slate-600 underline"
              disabled={save.isPending}
              onClick={() => once(() => save.mutateAsync(true))}
            >
              This is a different person who shares the email — create anyway
            </button>
          )}
        </div>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => once(() => save.mutateAsync(false))} disabled={save.isPending || mobileTaken} className="flex-1">
            {save.isPending ? 'Saving…' : 'Save student'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
