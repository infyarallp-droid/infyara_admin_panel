import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useSingleFlight } from '../lib/useSingleFlight';
import { addDays, DELIVERY_MODE, fmtDate, inr } from '../lib/format';
import { Button, Field, Input } from './ui';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());


/** Enroll a student into a course plan + class timing. */
export default function EnrollDrawer({
  studentId,
  onClose,
  onSaved,
}: {
  studentId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['courses', 'active'],
    queryFn: async () => (await api.get('/api/courses', { params: { active: true } })).data,
  });
  const courses: any[] = useMemo(() => data?.courses ?? [], [data]);

  const [courseId, setCourseId] = useState('');
  const [planId, setPlanId] = useState('');
  const [timingId, setTimingId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [discount, setDiscount] = useState('0');
  const [error, setError] = useState('');
  // Offered only when the server says this admin may override a duplicate (business setting).
  const [canOverride, setCanOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const course = useMemo(() => courses.find((c: any) => c.id === courseId), [courses, courseId]);
  const plan = useMemo(() => course?.plans.find((p: any) => p.id === planId), [course, planId]);
  const endPreview = plan && startDate ? addDays(startDate, plan.durationDays) : '';
  const discountNum = Number(discount);
  const discountInvalid = discount.trim() !== '' && (!Number.isFinite(discountNum) || discountNum < 0);

  const save = useMutation({
    mutationFn: async (override: boolean) =>
      (
        await api.post('/api/enrollments', {
          studentId,
          coursePlanId: planId,
          classTimingId: timingId || undefined,
          startDate,
          discountRupees: discountNum || 0,
          ...(override ? { allowDuplicate: true, overrideReason } : {}),
        })
      ).data,
    onSuccess: onSaved,
    onError: async (e: any) => {
      setCanOverride(e.response?.data?.code === 'DUPLICATE_ENROLLMENT' && !!e.response?.data?.canOverride);
      setError(await apiError(e, 'Failed to enroll'));
    },
  });

  const once = useSingleFlight();
  const ready = !!planId && !!startDate && !discountInvalid && !save.isPending;
  const selectClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">Enroll student</h2>
        <p className="mb-4 text-sm text-slate-500">
          A student can hold several courses at once — each enrolment has its own dates, fee and invoice.
        </p>
        <div className="space-y-3">
          <Field label="Course">
            <select
              className={selectClass}
              value={courseId}
              disabled={isLoading}
              onChange={(e) => {
                setCourseId(e.target.value);
                setPlanId('');
                setTimingId('');
                setError('');
                setCanOverride(false);
              }}
            >
              <option value="">{isLoading ? 'Loading courses…' : 'Select course…'}</option>
              {(['TEACHER_TRAINING', 'REGULAR'] as const).map((cat) => (
                <optgroup key={cat} label={cat === 'TEACHER_TRAINING' ? 'Teacher Training' : 'Regular Classes'}>
                  {courses
                    .filter((c: any) => c.category === cat)
                    .map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.deliveryMode ? ` — ${DELIVERY_MODE[c.deliveryMode]}` : ''}
                        {c.plans.length ? '' : ' (no plan set up yet)'}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>

          {course && !course.plans.length && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              This course has no plan, duration or fee set up yet, so it cannot take enrolments.{' '}
              <Link to="/courses" className="underline">
                Add a plan under Courses
              </Link>{' '}
              first.
            </p>
          )}

          {course && !!course.plans.length && (
            <Field label="Plan">
              <select className={selectClass} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Select plan…</option>
                {course.plans.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — {inr(p.pricePaise)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {course && !!course.timings?.length && (
            <Field label="Class timing">
              <select className={selectClass} value={timingId} onChange={(e) => setTimingId(e.target.value)}>
                <option value="">Select timing…</option>
                {course.timings.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.label} {(t.days ?? []).join(', ')}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start (joining) date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Discount (₹)">
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          </div>
          {discountInvalid && <p className="text-sm text-red-600">Discount must be a number of rupees, 0 or more.</p>}

          {plan && endPreview && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              {fmtDate(startDate)} → <b>{fmtDate(endPreview)}</b> · fee{' '}
              <b>{inr(Math.max(0, Number(plan.pricePaise) - (discountNum || 0) * 100))}</b>
              {startDate > today() && <span className="block text-xs text-slate-400">Starts in the future — status will be Upcoming.</span>}
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {canOverride && (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <Field label="Reason for overriding the duplicate check">
                <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </Field>
              <Button variant="danger" disabled={overrideReason.trim().length < 5 || save.isPending} onClick={() => once(() => save.mutateAsync(true))}>
                Enroll anyway
              </Button>
            </div>
          )}
        </div>
        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={() => ready && once(() => save.mutateAsync(false))} disabled={!ready}>
            {save.isPending ? 'Enrolling…' : 'Enroll'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
