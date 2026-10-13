import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { DELIVERY_MODE } from '../lib/format';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const DURATIONS = ['MONTH_1', 'MONTH_3', 'MONTH_12', 'HRS_200', 'HRS_300', 'HRS_600', 'CUSTOM'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function Courses() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['courses'] });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => (await api.get('/api/courses')).data,
  });
  const groups = [
    { key: 'TEACHER_TRAINING', title: 'Teacher Training Programs' },
    { key: 'REGULAR', title: 'Regular Classes' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Courses & Teacher Training</h1>
        <p className="text-sm text-slate-500">Manage the catalog, plans (1/3/12 month & 200/300/600 hr), and class timings.</p>
      </div>

      <NewCourse onSaved={invalidate} />

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load the course catalogue. Please refresh.</p>
      ) : (
        groups.map((g) => {
          const list = (data?.courses ?? []).filter((c: any) => c.category === g.key);
          return (
            <section key={g.key} className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                {g.title} ({list.length})
              </h2>
              {list.map((c: any) => (
                <CourseCard key={c.id} course={c} onChanged={invalidate} />
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

function NewCourse({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('REGULAR');
  const [discipline, setDiscipline] = useState('YOGA');
  const [deliveryMode, setDeliveryMode] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (await api.post('/api/courses', { name, category, discipline, deliveryMode: deliveryMode || undefined })).data,
    onSuccess: () => {
      setName('');
      setError('');
      onSaved();
    },
    onError: async (e) => setError(await apiError(e, 'Could not add the course')),
  });
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Add course</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        </Field>
        <Field label="Category">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="REGULAR">Regular</option>
            <option value="TEACHER_TRAINING">Teacher Training</option>
          </select>
        </Field>
        <Field label="Discipline">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option>YOGA</option>
            <option>PILATES</option>
            <option>DANCE</option>
          </select>
        </Field>
        <Field label="Delivery mode">
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value)}>
            <option value="">To be confirmed</option>
            {Object.entries(DELIVERY_MODE).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </Field>
        <Button onClick={() => name.trim() && !save.isPending && save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

function CourseCard({ course, onChanged }: { course: any; onChanged: () => void }) {
  const [error, setError] = useState('');
  const update = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await api.put('/api/courses/' + course.id, patch)).data,
    onSuccess: () => {
      setError('');
      onChanged();
    },
    onError: async (e) => setError(await apiError(e, 'Could not update the course')),
  });
  return (
    <Card className={course.isActive ? '' : 'opacity-60'}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{course.name}</h3>
        <Badge tone={course.category === 'TEACHER_TRAINING' ? 'amber' : 'green'}>
          {course.category === 'TEACHER_TRAINING' ? 'Teacher Training' : 'Regular'}
        </Badge>
        <span className="text-xs text-slate-400">{course.discipline}</span>
        {course.code && <span className="text-xs text-slate-400">· {course.code}</span>}
        <select
          aria-label="Delivery mode"
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          value={course.deliveryMode ?? ''}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ deliveryMode: e.target.value || null })}
        >
          <option value="">Mode: to be confirmed</option>
          {Object.entries(DELIVERY_MODE).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <label className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={course.isActive}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ isActive: e.target.checked })}
          />
          Open for enrolment
        </label>
      </div>
      {course.description && <p className="mb-3 text-sm text-slate-500">{course.description}</p>}
      {!!course.setupPending?.length && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          To be confirmed and set up before taking enrolments: {course.setupPending.join(', ')}.
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-500">Plans</h4>
          <ul className="mb-2 space-y-1 text-sm">
            {course.plans?.length ? course.plans.map((p: any) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.title} <span className="text-slate-400">({p.durationType})</span></span>
                <span className="font-medium">₹{(Number(p.pricePaise) / 100).toLocaleString('en-IN')}</span>
              </li>
            )) : <li className="text-slate-400">No plans yet.</li>}
          </ul>
          <AddPlan courseId={course.id} onSaved={onChanged} />
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-500">Class timings</h4>
          <ul className="mb-2 space-y-1 text-sm">
            {course.timings?.length ? course.timings.map((t: any) => (
              <li key={t.id}>{t.label} <span className="text-slate-400">{(t.days ?? []).join(', ')}</span></li>
            )) : <li className="text-slate-400">No timings yet.</li>}
          </ul>
          <AddTiming courseId={course.id} onSaved={onChanged} />
        </div>
      </div>
    </Card>
  );
}

function AddPlan({ courseId, onSaved }: { courseId: string; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [durationType, setDurationType] = useState('MONTH_1');
  const [priceRupees, setPrice] = useState('');
  const [days, setDays] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/api/courses/' + courseId + '/plans', {
          title,
          durationType,
          priceRupees: Number(priceRupees),
          durationValue: durationType === 'CUSTOM' ? Number(days) : undefined,
        })
      ).data,
    onSuccess: () => {
      setTitle('');
      setPrice('');
      setDays('');
      setError('');
      onSaved();
    },
    onError: async (e) => setError(await apiError(e, 'Could not add the plan')),
  });
  const valid =
    !!title.trim() &&
    /^[0-9]+([.][0-9]{1,2})?$/.test(priceRupees.trim()) &&
    (durationType !== 'CUSTOM' || /^[1-9][0-9]*$/.test(days.trim()));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Plan title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-28" />
      <select className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm" value={durationType} onChange={(e) => setDurationType(e.target.value)}>
        {DURATIONS.map((d) => <option key={d}>{d}</option>)}
      </select>
      {durationType === 'CUSTOM' && (
        <Input placeholder="Days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className="w-20" />
      )}
      <Input placeholder="Fee ₹" inputMode="decimal" value={priceRupees} onChange={(e) => setPrice(e.target.value)} className="w-24" />
      <Button variant="ghost" disabled={!valid || save.isPending} onClick={() => valid && !save.isPending && save.mutate()}>
        {save.isPending ? 'Adding…' : '+ Plan'}
      </Button>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AddTiming({ courseId, onSaved }: { courseId: string; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: async () => (await api.post('/api/courses/timings', { courseId, label, days })).data,
    onSuccess: () => {
      setLabel('');
      setDays([]);
      onSaved();
    },
  });
  const toggle = (d: string) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  return (
    <div className="space-y-2">
      <Input placeholder='e.g. "6:00 – 7:00 AM"' value={label} onChange={(e) => setLabel(e.target.value)} className="w-48" />
      <div className="flex flex-wrap gap-1">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggle(d)}
            className={`rounded-lg px-2 py-1 text-xs ${days.includes(d) ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {d}
          </button>
        ))}
      </div>
      <Button variant="ghost" disabled={save.isPending} onClick={() => label.trim() && !save.isPending && save.mutate()}>
        + Timing
      </Button>
    </div>
  );
}
