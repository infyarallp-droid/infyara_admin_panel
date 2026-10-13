import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiError, openProtected } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useSingleFlight } from '../lib/useSingleFlight';
import { daysLabel, ENROLLMENT_STATUS, fmtDate, inr, PAYMENT_STATUS, STUDENT_STATUS } from '../lib/format';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';
import EnrollDrawer from '../components/EnrollDrawer';
import RenewDialog, { type RenewTarget } from '../components/RenewDialog';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDeactivate = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '');
  const [params, setParams] = useSearchParams();
  const [enroll, setEnroll] = useState(false);
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [notice, setNotice] = useState('');
  const once = useSingleFlight();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['student', id],
    queryFn: async () => (await api.get(`/api/students/${id}`)).data,
  });

  // "Use & enrol" from the New Student form lands here with ?enroll=1.
  useEffect(() => {
    if (params.get('enroll') === '1') {
      setEnroll(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const createConsent = useMutation({
    mutationFn: async (enrollmentId?: string) =>
      (
        await api.post('/api/consent/forms', {
          studentId: id,
          enrollmentId,
          formDate: today(),
        })
      ).data,
    onSuccess: (res) => navigate(`/consent/${res.form.id}`),
    onError: async (e) => setNotice(await apiError(e, 'Could not create the consent form')),
  });

  const reactivate = useMutation({
    mutationFn: async () => (await api.post(`/api/students/${id}/reactivate`, {})).data,
    onSuccess: () => {
      setNotice('Student reactivated.');
      refetch();
    },
    onError: async (e) => setNotice(await apiError(e, 'Could not reactivate')),
  });

  const openPdf = async (path: string) => {
    try {
      await openProtected(path);
    } catch (e) {
      setNotice(await apiError(e, 'Could not open the PDF'));
    }
  };

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const s = data?.student;
  if (!s) return <p>Student not found.</p>;
  const st = STUDENT_STATUS[s.computedStatus] ?? { label: s.computedStatus, tone: 'slate' as const };
  const manuallyInactive = s.status === 'INACTIVE';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/students" className="text-sm text-brand hover:underline">
            ← Students
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {s.fullName} {s.isMinor && <Badge tone="amber">Minor</Badge>}
            <Badge tone={st.tone}>{st.label}</Badge>
          </h1>
          <p className="text-sm text-slate-500">
            {s.studentCode ? `${s.studentCode} · ` : ''}
            {s.mobile} · {s.email ?? 'no email'}
          </p>
          <p className="text-xs text-slate-400">
            {s.statusReason}
            {s.statusEffectiveDate ? ` · effective ${fmtDate(s.statusEffectiveDate)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDeactivate &&
            (manuallyInactive ? (
              <Button variant="ghost" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
                {reactivate.isPending ? 'Reactivating…' : 'Reactivate'}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setDeactivating(true)}>
                Deactivate
              </Button>
            ))}
          <Button variant="ghost" onClick={() => setEnroll(true)} disabled={manuallyInactive} title={manuallyInactive ? 'Reactivate the student to add an enrolment' : undefined}>
            + Enroll
          </Button>
          <Button onClick={() => once(() => createConsent.mutateAsync(undefined))} disabled={createConsent.isPending}>
            {createConsent.isPending ? 'Creating…' : '+ New Consent Form'}
          </Button>
        </div>
      </div>

      {notice && (
        <p className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-700">
          {notice}{' '}
          <button className="text-xs text-slate-400 underline" onClick={() => setNotice('')}>
            dismiss
          </button>
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Details</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Student ID" value={s.studentCode} />
            <Row label="Joining date" value={s.joiningDate ? fmtDate(s.joiningDate) : null} />
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
            <ul className="space-y-3 text-sm">
              {s.enrollments.map((e: any) => {
                const es = ENROLLMENT_STATUS[e.displayStatus] ?? { label: e.displayStatus, tone: 'slate' as const };
                const pay = PAYMENT_STATUS[e.payment?.status] ?? PAYMENT_STATUS.NONE;
                const current = !['RENEWED', 'CANCELLED'].includes(e.displayStatus);
                return (
                  <li key={e.id} className="border-b border-slate-50 pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <span>
                        <span className="font-medium">
                          {e.coursePlan.course.name} — {e.coursePlan.title}
                        </span>
                        {e.classTiming && <span className="text-slate-400"> · {e.classTiming.label}</span>}
                        <span className="block text-xs text-slate-500">
                          {fmtDate(e.startDate)} → {fmtDate(e.endDate)}
                          {current && e.displayStatus !== 'UPCOMING' ? ` · ${daysLabel(e.daysRemaining)}` : ''}
                          {e.parentEnrollmentId ? ' · renewal' : ''}
                        </span>
                        <span className="block text-xs text-slate-400">{e.statusReason}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={es.tone}>{es.label}</Badge>
                        <Badge tone={pay.tone}>{pay.label}</Badge>
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                      {e.payment?.invoiceId && (
                        <Link to={`/invoices/${e.payment.invoiceId}`} className="text-brand hover:underline">
                          {e.payment.invoiceNo} · paid {inr(e.payment.paidPaise)} of {inr(e.payment.totalPaise)}
                          {Number(e.payment.balancePaise) > 0 ? ' — record payment' : ''}
                        </Link>
                      )}
                      {current && (
                        <>
                          <button
                            onClick={() => once(() => createConsent.mutateAsync(e.id))}
                            disabled={createConsent.isPending}
                            className="text-brand hover:underline disabled:opacity-50"
                            title="Create a consent form with this enrollment's fee details"
                          >
                            + Consent
                          </button>
                          {e.displayStatus !== 'UPCOMING' && !manuallyInactive && !e.renewal && (
                            <button onClick={() => setRenewing(e)} className="text-brand hover:underline">
                              Renew
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No enrollments yet. Use “+ Enroll” to add a course.</p>
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
                <th className="py-2 font-medium">Course</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Signed scan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.consentForms.map((c: any) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-3">{c.formDate?.slice(0, 10)}</td>
                  <td className="py-3 text-slate-600">{c.courseName ? `${c.courseName} — ${c.planTitle}` : '—'}</td>
                  <td className="py-3">
                    <Badge tone={c.status === 'FINALIZED' ? 'green' : 'amber'}>{c.status}</Badge>
                  </td>
                  <td className="py-3">{c.uploads?.length ? `${c.uploads.length} file(s)` : '—'}</td>
                  <td className="py-3 text-right">
                    <Link to={`/consent/${c.id}`} className="text-brand hover:underline">
                      Open
                    </Link>
                    <button onClick={() => openPdf(`/api/consent/forms/${c.id}/pdf`)} className="ml-3 text-brand hover:underline">
                      PDF
                    </button>
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
                  {i.invoiceNo} <span className="text-xs text-slate-400">{i.type}</span>
                </Link>
                <span className="flex items-center gap-3">
                  <span>
                    {inr(i.totalPaise)}
                    {Number(i.totalPaise) > Number(i.amountPaidPaise) && (
                      <span className="ml-1 text-xs text-slate-400">balance {inr(Number(i.totalPaise) - Number(i.amountPaidPaise))}</span>
                    )}
                  </span>
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
      {renewing && (
        <RenewDialog
          enrollment={{ ...renewing, student: { fullName: s.fullName } }}
          onClose={() => setRenewing(null)}
          onRenewed={(res) => {
            setRenewing(null);
            setNotice(`Renewed until ${fmtDate(res.renewal.nextExpiry)}. Invoice ${res.invoice.invoiceNo} raised — record the payment from the invoice.`);
            refetch();
          }}
        />
      )}
      {deactivating && (
        <DeactivateDialog
          studentId={id!}
          onClose={() => setDeactivating(false)}
          onDone={() => {
            setDeactivating(false);
            setNotice('Student deactivated.');
            refetch();
          }}
        />
      )}
    </div>
  );
}

function DeactivateDialog({ studentId, onClose, onDone }: { studentId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => (await api.post(`/api/students/${studentId}/deactivate`, { reason, effectiveDate })).data,
    onSuccess: onDone,
    onError: async (e) => setError(await apiError(e, 'Could not deactivate')),
  });
  const once = useSingleFlight();
  const ready = reason.trim().length >= 5 && !!effectiveDate && effectiveDate <= today() && !save.isPending;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Deactivate student</h2>
        <p className="mb-4 text-sm text-slate-500">
          The student is marked Inactive and cannot be enrolled or renewed until reactivated. Enrolments, invoices and payments are kept.
          The reason, date and your name are recorded.
        </p>
        <div className="space-y-3">
          <Field label="Reason *">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Relocated to another city" />
          </Field>
          <Field label="Effective date" hint="Today or earlier">
            <Input type="date" max={today()} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-6 flex gap-2">
          <Button variant="danger" className="flex-1" disabled={!ready} onClick={() => ready && once(() => save.mutateAsync())}>
            {save.isPending ? 'Saving…' : 'Deactivate'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
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
