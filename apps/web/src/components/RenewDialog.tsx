import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useSingleFlight } from '../lib/useSingleFlight';
import { addDays, fmtDate, inr, isoDate } from '../lib/format';
import { Button, Field, Input } from './ui';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export interface RenewTarget {
  id: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  student?: { fullName: string };
  coursePlan: { title: string; pricePaise: string; course: { name: string } };
  /** Start date suggested by the configured convention (Renewals Due supplies it). */
  suggestedRenewalStart?: string;
}

/**
 * Renew an enrolment. The admin always sees and confirms the renewal start
 * date; the next expiry is calculated from it and shown before saving.
 */
export default function RenewDialog({
  enrollment,
  onClose,
  onRenewed,
}: {
  enrollment: RenewTarget;
  onClose: () => void;
  onRenewed: (res: any) => void;
}) {
  const currentExpiry = isoDate(enrollment.endDate);
  const [startDate, setStartDate] = useState(enrollment.suggestedRenewalStart ?? today());
  const [discount, setDiscount] = useState('0');
  const [error, setError] = useState('');

  const days = enrollment.durationDays ?? 30;
  const nextExpiry = startDate ? addDays(startDate, days) : '';
  const fee = Number(enrollment.coursePlan.pricePaise);
  const discountNum = Number(discount);
  const discountInvalid = discount.trim() !== '' && (!Number.isFinite(discountNum) || discountNum < 0 || discountNum * 100 > fee);
  const tooEarly = !!startDate && startDate < isoDate(enrollment.startDate);
  const overlaps = !!startDate && !tooEarly && startDate <= currentExpiry;
  const gap = !!startDate && startDate > addDays(currentExpiry, 1);

  const renew = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/enrollments/${enrollment.id}/renew`, { startDate, discountRupees: discountNum || 0 })).data,
    onSuccess: onRenewed,
    onError: async (e) => setError(await apiError(e, 'Renewal failed')),
  });
  const once = useSingleFlight();
  const ready = !!startDate && !tooEarly && !discountInvalid && !renew.isPending;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Renew enrolment</h2>
        <p className="mb-4 text-sm text-slate-500">
          {enrollment.student ? `${enrollment.student.fullName} · ` : ''}
          {enrollment.coursePlan.course.name} — {enrollment.coursePlan.title}
        </p>

        <dl className="mb-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Current period</dt>
            <dd>
              {fmtDate(enrollment.startDate)} → {fmtDate(currentExpiry)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Current expiry</dt>
            <dd className="font-medium">{fmtDate(currentExpiry)}</dd>
          </div>
        </dl>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Renewal start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Discount (₹)">
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 hover:bg-slate-200" onClick={() => setStartDate(today())}>
              Start today
            </button>
            <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 hover:bg-slate-200" onClick={() => setStartDate(addDays(currentExpiry, 1))}>
              Day after expiry ({fmtDate(addDays(currentExpiry, 1))})
            </button>
          </div>

          {startDate && !tooEarly && (
            <dl className="space-y-1 rounded-xl border border-brand/30 bg-brand/5 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Renewal period ({days} days)</dt>
                <dd>
                  {fmtDate(startDate)} → {fmtDate(nextExpiry)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Next expiry</dt>
                <dd className="font-semibold">{fmtDate(nextExpiry)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Renewal invoice</dt>
                <dd>{inr(Math.max(0, fee - (discountNum || 0) * 100))}</dd>
              </div>
            </dl>
          )}
          {tooEarly && <p className="text-sm text-red-600">Renewal cannot start before the current period started.</p>}
          {overlaps && (
            <p className="text-xs text-amber-700">
              Starts before the current expiry ({fmtDate(currentExpiry)}) — the remaining days of the current period are not carried over.
            </p>
          )}
          {gap && <p className="text-xs text-amber-700">Leaves a gap after the current expiry ({fmtDate(currentExpiry)}).</p>}
          {discountInvalid && <p className="text-sm text-red-600">Discount must be between 0 and the plan fee.</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" disabled={!ready} onClick={() => ready && once(() => renew.mutateAsync())}>
            {renew.isPending ? 'Renewing…' : 'Confirm renewal'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
