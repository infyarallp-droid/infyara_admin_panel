import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { daysLabel, ENROLLMENT_STATUS, fmtDate, PAYMENT_STATUS } from '../lib/format';
import { Badge, Button, Card, Spinner } from '../components/ui';
import RenewDialog, { type RenewTarget } from '../components/RenewDialog';

const REMINDER_LABEL: Record<string, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' }> = {
  SENT: { label: 'Reminder sent', tone: 'green' },
  DELIVERED: { label: 'Reminder delivered', tone: 'green' },
  READ: { label: 'Reminder read', tone: 'green' },
  PENDING: { label: 'Reminder sending…', tone: 'slate' },
  FAILED: { label: 'Reminder failed', tone: 'red' },
  NOT_CONFIGURED: { label: 'WhatsApp not set up', tone: 'amber' },
  INVALID_RECIPIENT: { label: 'Invalid mobile', tone: 'red' },
};

export default function Renewals() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canRunReminders = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '');
  const [days, setDays] = useState(30);
  const [renewing, setRenewing] = useState<RenewTarget | null>(null);
  const [notice, setNotice] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['renewals-due', days],
    queryFn: async () => (await api.get('/api/enrollments/renewals-due', { params: { days } })).data,
    refetchInterval: 60_000,
  });
  const config = data?.config;

  const reminders = useMutation({
    mutationFn: async () => (await api.post('/api/automations/run-reminders')).data,
    onSuccess: (res) => {
      const s = res.summary;
      setNotice(
        s.whatsappConfigured
          ? `Reminders checked: ${s.whatsappSent} sent, ${s.whatsappDuplicate} already sent for this window, ${s.whatsappFailed} failed${s.whatsappInvalidRecipient ? `, ${s.whatsappInvalidRecipient} invalid mobile` : ''}${s.rateLimited ? ' — provider rate limit reached, the rest will go on the next run' : ''}.`
          : `WhatsApp is not set up, so no messages were sent (${s.whatsappNotConfigured} pending). In-app alerts: ${s.renewalNotifications}.`,
      );
      qc.invalidateQueries({ queryKey: ['renewals-due'] });
    },
    onError: async (e) => setNotice(await apiError(e, 'Could not run reminders')),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Renewals Due</h1>
          <p className="text-sm text-slate-500">
            Enrolments ending soon or already expired and not yet renewed.
            {config && (
              <>
                {' '}
                WhatsApp reminders go out {config.reminderDays.slice().reverse().join(', ')} day(s) before expiry
                {config.whatsappConfigured ? '.' : ' — '}
                {!config.whatsappConfigured && <span className="font-medium text-amber-700">WhatsApp is not set up yet, so none are being sent.</span>}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canRunReminders && (
            <Button variant="ghost" onClick={() => reminders.mutate()} disabled={reminders.isPending}>
              {reminders.isPending ? 'Running…' : 'Run reminders now'}
            </Button>
          )}
          <select
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Next 7 days</option>
            <option value={15}>Next 15 days</option>
            <option value={30}>Next 30 days</option>
          </select>
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

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : isError ? (
          <p className="py-10 text-center text-sm text-red-600">
            Could not load renewals.{' '}
            <button className="underline" onClick={() => refetch()}>
              Retry
            </button>
          </p>
        ) : data?.enrollments?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="py-2 pr-3 font-medium">Student</th>
                  <th className="py-2 pr-3 font-medium">Course</th>
                  <th className="py-2 pr-3 font-medium">Joining date</th>
                  <th className="py-2 pr-3 font-medium">Current period</th>
                  <th className="py-2 pr-3 font-medium">Expiry</th>
                  <th className="py-2 pr-3 font-medium">Days left</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.enrollments.map((e: any) => {
                  const left: number = e.daysRemaining;
                  const st = ENROLLMENT_STATUS[e.displayStatus] ?? { label: e.displayStatus, tone: 'slate' as const };
                  const pay = PAYMENT_STATUS[e.payment?.status] ?? PAYMENT_STATUS.NONE;
                  const rem = e.lastReminder ? REMINDER_LABEL[e.lastReminder.status] : null;
                  return (
                    <tr key={e.id} className="border-b border-slate-50 align-top">
                      <td className="py-3 pr-3">
                        <Link to={`/students/${e.studentId}`} className="font-medium text-brand hover:underline">
                          {e.student.fullName}
                        </Link>
                        <div className="text-xs text-slate-400">
                          {e.student.studentCode ? `${e.student.studentCode} · ` : ''}
                          {e.student.mobile}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        {e.coursePlan.course.name} — {e.coursePlan.title}
                        <div className="mt-1">
                          <Badge tone={pay.tone}>{pay.label}</Badge>
                        </div>
                      </td>
                      <td className="py-3 pr-3">{fmtDate(e.joiningDate)}</td>
                      <td className="py-3 pr-3 text-slate-600">from {fmtDate(e.startDate)}</td>
                      <td className="py-3 pr-3 font-medium">{fmtDate(e.endDate)}</td>
                      <td className="py-3 pr-3">
                        <Badge tone={left <= 3 ? 'red' : left <= 7 ? 'amber' : 'slate'}>{daysLabel(left)}</Badge>
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {rem && (
                          <div className="mt-1" title={e.lastReminder.error ?? ''}>
                            <Badge tone={rem.tone}>{rem.label}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <Button variant="ghost" onClick={() => setRenewing(e)}>
                          Renew
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-10 text-center text-slate-400">No renewals due in this window. 🎉</p>
        )}
      </Card>

      {renewing && (
        <RenewDialog
          enrollment={renewing}
          onClose={() => setRenewing(null)}
          onRenewed={(res) => {
            setRenewing(null);
            setNotice(
              `Renewed: ${fmtDate(res.renewal.renewalStart)} → next expiry ${fmtDate(res.renewal.nextExpiry)}. Invoice ${res.invoice.invoiceNo} raised.`,
            );
            qc.invalidateQueries({ queryKey: ['renewals-due'] });
          }}
        />
      )}
    </div>
  );
}
