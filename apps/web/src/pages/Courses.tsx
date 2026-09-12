import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const DURATIONS = ['MONTH_1', 'MONTH_3', 'MONTH_12', 'HRS_200', 'HRS_300', 'HRS_600', 'CUSTOM'];
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export default function Courses() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['courses'] });
  const { data, isLoading } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => (await api.get('/api/courses')).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Courses & Teacher Training</h1>
        <p className="text-sm text-slate-500">Manage the catalog, plans (1/3/12 month & 200/300/600 hr), and class timings.</p>
      </div>

      <NewCourse onSaved={invalidate} />

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        data?.courses?.map((c: any) => <CourseCard key={c.id} course={c} onChanged={invalidate} />)
      )}
    </div>
  );
}

function NewCourse({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('REGULAR');
  const [discipline, setDiscipline] = useState('YOGA');
  const save = useMutation({
    mutationFn: async () => (await api.post('/api/courses', { name, category, discipline })).data,
    onSuccess: () => {
      setName('');
      onSaved();
    },
  });
  return (
    <Card>
      <h3 className="mb-3 font-semibold">Add course</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        </Field>
        <Field label="Category">
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="REGULAR">Regular</option>
            <option value="TEACHER_TRAINING">Teacher Training</option>
          </select>
        </Field>
        <Field label="Discipline">
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            <option>YOGA</option>
            <option>PILATES</option>
            <option>DANCE</option>
          </select>
        </Field>
        <Button onClick={() => name && save.mutate()} disabled={save.isPending}>Add</Button>
      </div>
    </Card>
  );
}

function CourseCard({ course, onChanged }: { course: any; onChanged: () => void }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-semibold">{course.name}</h3>
        <Badge tone={course.category === 'TEACHER_TRAINING' ? 'amber' : 'green'}>
          {course.category === 'TEACHER_TRAINING' ? 'Teacher Training' : 'Regular'}
        </Badge>
        <span className="text-xs text-slate-400">{course.discipline}</span>
      </div>

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
  const save = useMutation({
    mutationFn: async () =>
      (await api.post(`/api/courses/${courseId}/plans`, { title, durationType, priceRupees: Number(priceRupees) })).data,
    onSuccess: () => {
      setTitle('');
      setPrice('');
      onSaved();
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Plan title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-28" />
      <select className="rounded-xl border border-slate-200 px-2 py-2 text-sm" value={durationType} onChange={(e) => setDurationType(e.target.value)}>
        {DURATIONS.map((d) => <option key={d}>{d}</option>)}
      </select>
      <Input placeholder="₹" value={priceRupees} onChange={(e) => setPrice(e.target.value)} className="w-20" />
      <Button variant="ghost" onClick={() => title && priceRupees && save.mutate()}>+ Plan</Button>
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
      <Button variant="ghost" onClick={() => label && save.mutate()}>+ Timing</Button>
    </div>
  );
}
