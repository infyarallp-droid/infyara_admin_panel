import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Spinner } from '../components/ui';
import EnrollDrawer from '../components/EnrollDrawer';

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [enroll, setEnroll] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['student', id],
    queryFn: async () => (await api.get(`/api/students/${id}`)).data,
  });

  const createConsent = useMutation({
    mutationFn: async (enrollmentId?: string) =>
      (
        await api.post('/api/consent/forms', {
          studentId: id,
          enrollmentId,
          formDate: new Date().toISOString().slice(0, 10),
        })
      ).data,
    onSuccess: (res) => navigate(`/consent/${res.form.id}`),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const s = data?.student;
  if (!s) return <p>Student not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/students" className="text-sm text-brand hover:underline">
            ← Students
          </Link>
          <h1 className="text-2xl font-bold">
            {s.fullName} {s.isMinor && <Badge tone="amber">Minor</Badge>}
          </h1>
          <p className="text-sm text-slate-500">
            {s.mobile} · {s.email ?? 'no email'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setEnroll(true)}>
            + Enroll
          </Button>
          <Button onClick={() => createConsent.mutate(undefined)} disabled={createConsent.isPending}>
            {createConsent.isPending ? 'Creating…' : '+ New Consent Form'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Details</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Gender" value={s.gender} />
            <Row label="DOB" value={s.dob?.slice(0, 10)} />
            <Row label="Address" value={s.address} />
            <Row label="Emergency" value={`${s.emergencyContactName ?? '—'} (${s.emergencyContactRelation ?? '—'})`} />
            <Row label="Emergency phone" value={s.emergencyContactPhone} />
          </dl>
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Enrollments</h3>
          {s.enrollments?.length ? (
            <ul className="space-y-2 text-sm">
              {s.enrollments.map((e: any) => (
                <li key={e.id} className="flex items-center justify-between border-b border-slate-50 pb-2">
                  <span>
                    {e.coursePlan.course.name} — {e.coursePlan.title}
                    {e.classTiming && <span className="text-slate-400"> · {e.classTiming.label}</span>}
                    <span className="block text-xs text-slate-400">ends {e.endDate?.slice(0, 10)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => createConsent.mutate(e.id)}
                      className="text-xs text-brand hover:underline"
                      title="Create a consent form with this enrollment's fee details"
                    >
                      + Consent
                    </button>
                    <Badge tone={e.status === 'ACTIVE' ? 'green' : 'slate'}>{e.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No enrollments yet (added in the Courses module).</p>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Consent Forms</h3>
        {s.consentForms?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Signed scan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.consentForms.map((c: any) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-3">{c.formDate?.slice(0, 10)}</td>
                  <td className="py-3">
                    <Badge tone={c.status === 'FINALIZED' ? 'green' : 'amber'}>{c.status}</Badge>
                  </td>
                  <td className="py-3">{c.uploads?.length ? `${c.uploads.length} file(s)` : '—'}</td>
                  <td className="py-3 text-right">
                    <Link to={`/consent/${c.id}`} className="text-brand hover:underline">
                      Open
                    </Link>
                    {c.pdfUrl && (
                      <a href={c.pdfUrl} target="_blank" rel="noreferrer" className="ml-3 text-brand hover:underline">
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">No consent forms yet.</p>
        )}
        <button onClick={() => refetch()} className="mt-3 text-xs text-slate-400 hover:underline">
          Refresh
        </button>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Invoices</h3>
        {s.invoices?.length ? (
          <ul className="space-y-2 text-sm">
            {s.invoices.map((i: any) => (
              <li key={i.id} className="flex items-center justify-between border-b border-slate-50 pb-2">
                <Link to={`/invoices/${i.id}`} className="text-brand hover:underline">
                  {i.invoiceNo}
                </Link>
                <span className="flex items-center gap-3">
                  <span>₹{(Number(i.totalPaise) / 100).toLocaleString('en-IN')}</span>
                  <Badge tone={i.status === 'PAID' ? 'green' : i.status === 'PARTIAL' ? 'amber' : 'red'}>
                    {i.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No invoices yet. Enrolling the student creates one automatically.</p>
        )}
      </Card>

      {enroll && (
        <EnrollDrawer
          studentId={id!}
          onClose={() => setEnroll(false)}
          onSaved={() => {
            setEnroll(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium">{value || '—'}</dd>
    </div>
  );
}
