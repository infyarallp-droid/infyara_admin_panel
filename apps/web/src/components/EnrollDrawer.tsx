import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Field, Input } from './ui';

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
  const { data } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => (await api.get('/api/courses')).data,
  });
  const courses = data?.courses ?? [];

  const [courseId, setCourseId] = useState('');
  const [planId, setPlanId] = useState('');
  const [timingId, setTimingId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState('0');
  const [error, setError] = useState('');

  const course = useMemo(() => courses.find((c: any) => c.id === courseId), [courses, courseId]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/api/enrollments', {
          studentId,
          coursePlanId: planId,
          classTimingId: timingId || undefined,
          startDate,
          discountRupees: Number(discount) || 0,
        })
      ).data,
    onSuccess: onSaved,
    onError: (e: any) => setError(e.response?.data?.error ?? 'Failed to enroll'),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">Enroll student</h2>
        <div className="space-y-3">
          <Field label="Course">
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setPlanId('');
                setTimingId('');
              }}
            >
              <option value="">Select course…</option>
              {courses.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.category === 'TEACHER_TRAINING' ? 'TTC' : 'Regular'})
                </option>
              ))}
            </select>
          </Field>

          {course && (
            <Field label="Plan">
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">Select plan…</option>
                {course.plans.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — ₹{(Number(p.pricePaise) / 100).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {course && !!course.timings?.length && (
            <Field label="Class timing">
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                value={timingId}
                onChange={(e) => setTimingId(e.target.value)}
              >
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
            <Field label="Start date">
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Discount (₹)">
              <Input value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={() => planId && save.mutate()} disabled={save.isPending}>
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
