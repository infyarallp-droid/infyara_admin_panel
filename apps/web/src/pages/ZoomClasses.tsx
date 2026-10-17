import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, useFeedback } from '../components/ui';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const DAY_LABEL: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', RENEWAL_DUE: 'Renewal due', UPCOMING: 'Starts soon' };

interface ZoomClass {
  id: string;
  courseId: string;
  classTimingId: string | null;
  title: string;
  meetingUrl: string;
  meetingId: string | null;
  passcode: string | null;
  days: string[];
  startTime: string | null;
  startsAt: string | null;
  durationMinutes: number;
  notes: string | null;
  isActive: boolean;
  finished: boolean;
  studentCount: number;
  course: { id: string; name: string };
  classTiming: { id: string; label: string } | null;
}
interface Course {
  id: string;
  name: string;
  timings: { id: string; label: string }[];
}

/** "7:00 am" from "07:00". */
const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
export function scheduleText(z: Pick<ZoomClass, 'days' | 'startTime' | 'startsAt' | 'durationMinutes'>) {
  if (z.startsAt) {
    return `${new Date(z.startsAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · ${z.durationMinutes} min`;
  }
  const days = z.days.length === 7 ? 'Every day' : z.days.map((d) => DAY_LABEL[d]).join(', ');
  return `${days}${z.startTime ? ` · ${time12(z.startTime)}` : ''} · ${z.durationMinutes} min`;
}

export default function ZoomClasses() {
  const { user } = useAuth();
  const canEdit = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(user?.role ?? '');
  const [courseId, setCourseId] = useState('');
  const [editing, setEditing] = useState<ZoomClass | 'new' | null>(null);
  const [showStudents, setShowStudents] = useState<ZoomClass | null>(null);
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();

  const courses = useQuery({ queryKey: ['courses', 'active'], queryFn: async () => (await api.get('/api/courses?active=true')).data });
  const { data, isLoading } = useQuery({
    queryKey: ['zoom-classes', courseId],
    queryFn: async () => (await api.get(`/api/zoom-classes${courseId ? `?courseId=${courseId}` : ''}`)).data,
  });
  const items: ZoomClass[] = data?.items ?? [];
  const courseList: Course[] = courses.data?.courses ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['zoom-classes'] });
  const setActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => (await api.patch(`/api/zoom-classes/${id}/active`, { isActive })).data,
    onSuccess: (_r, v) => {
      refresh();
      toast(v.isActive ? 'Students can see this class again' : 'Hidden from students');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/zoom-classes/${id}`)).data,
    onSuccess: () => {
      refresh();
      toast('Deleted');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Link copied');
    } catch {
      toast('Could not copy — select the link and copy it instead', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zoom Classes"
        subtitle="Online class links for each course. A student sees the links of the courses they are currently enrolled in, on their website account (My account). Nothing here is public."
        actions={canEdit && <Button onClick={() => setEditing('new')}>+ Add Zoom class</Button>}
      />
      <Callout tone="blue">
        Students see a link when their enrolment in the course is active, due for renewal or starting soon, and they have a website login linked to their
        record (Website Logins). Enrolments waiting for payment, ended or cancelled do not see links.
      </Callout>
      <div className="max-w-xs">
        <Field label="Course">
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All courses</option>
            {courseList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Card>
        {isLoading ? (
          <Loading />
        ) : !items.length ? (
          <EmptyState title="No Zoom classes yet" action={canEdit && <Button onClick={() => setEditing('new')}>Add the first one</Button>}>
            Add the Zoom link for a course, and its enrolled students will find it on their account.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Class</th>
                  <th className="py-2 pr-4 font-medium">Schedule</th>
                  <th className="py-2 pr-4 font-medium">Meeting</th>
                  <th className="py-2 pr-4 font-medium">Students</th>
                  <th className="py-2 pr-4 font-medium">Visible</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((z) => (
                  <tr key={z.id} className={z.isActive && !z.finished ? '' : 'text-slate-400'}>
                    <td className="py-3 pr-4 align-top">
                      <div className="font-medium text-slate-900">{z.title}</div>
                      <div className="text-xs text-slate-500">
                        {z.course.name}
                        {z.classTiming ? ` · ${z.classTiming.label} batch only` : ''}
                      </div>
                    </td>
                    <td className="py-3 pr-4 align-top">
                      {scheduleText(z)}
                      {z.finished && (
                        <div className="mt-1">
                          <Badge>Finished</Badge>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <div className="flex items-center gap-2">
                        <a href={z.meetingUrl} target="_blank" rel="noopener noreferrer" className="max-w-[14rem] truncate text-brand underline underline-offset-2">
                          {z.meetingUrl.replace(/^https:\/\//, '')}
                        </a>
                        <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => copy(z.meetingUrl)}>
                          Copy
                        </Button>
                      </div>
                      {(z.meetingId || z.passcode) && (
                        <div className="text-xs text-slate-500">{[z.meetingId && `ID ${z.meetingId}`, z.passcode && `Passcode ${z.passcode}`].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className="py-3 pr-4 align-top">
                      <button type="button" className="font-medium text-brand underline underline-offset-2" onClick={() => setShowStudents(z)}>
                        {z.studentCount} student{z.studentCount === 1 ? '' : 's'}
                      </button>
                    </td>
                    <td className="py-3 pr-4 align-top">
                      {canEdit ? (
                        <Toggle checked={z.isActive} label={z.isActive ? 'Shown' : 'Hidden'} onChange={(v) => setActive.mutate({ id: z.id, isActive: v })} disabled={setActive.isPending} />
                      ) : z.isActive ? (
                        <Badge tone="green">Shown</Badge>
                      ) : (
                        <Badge>Hidden</Badge>
                      )}
                    </td>
                    <td className="py-3 text-right align-top">
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          <Button variant="subtle" className="!py-1" onClick={() => setEditing(z)}>
                            Edit
                          </Button>
                          <Button
                            variant="subtle"
                            className="!py-1 !text-red-600"
                            onClick={async () => {
                              if (await confirm({ title: `Delete “${z.title}”?`, body: 'Students will no longer see this link. To pause it instead, switch it off.', danger: true, confirmLabel: 'Delete' })) {
                                remove.mutate(z.id);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ZoomForm item={editing === 'new' ? null : editing} courses={courseList} defaultCourseId={courseId} onClose={() => setEditing(null)} />}
      {showStudents && <StudentsDialog item={showStudents} onClose={() => setShowStudents(null)} />}
    </div>
  );
}

const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

function ZoomForm({ item, courses, defaultCourseId, onClose }: { item: ZoomClass | null; courses: Course[]; defaultCourseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    courseId: item?.courseId ?? defaultCourseId,
    classTimingId: item?.classTimingId ?? '',
    title: item?.title ?? '',
    meetingUrl: item?.meetingUrl ?? '',
    meetingId: item?.meetingId ?? '',
    passcode: item?.passcode ?? '',
    kind: item?.startsAt ? 'ONCE' : 'WEEKLY',
    days: item?.days ?? [],
    startTime: item?.startTime ?? '',
    startsAt: toLocalInput(item?.startsAt ?? null),
    durationMinutes: item?.durationMinutes ?? 60,
    notes: item?.notes ?? '',
    isActive: item?.isActive ?? true,
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const course = courses.find((c) => c.id === form.courseId);
  // A course that is no longer active still shows its name while editing.
  const courseOptions = item && !course ? [{ id: item.courseId, name: item.course.name, timings: [] }, ...courses] : courses;
  const timings = course?.timings ?? (item?.classTiming ? [item.classTiming] : []);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        courseId: form.courseId,
        classTimingId: form.classTimingId || null,
        title: form.title,
        meetingUrl: form.meetingUrl.trim(),
        meetingId: form.meetingId,
        passcode: form.passcode,
        days: form.kind === 'WEEKLY' ? form.days : [],
        startTime: form.kind === 'WEEKLY' ? form.startTime : '',
        // The time is entered in India time on the studio's computer.
        startsAt: form.kind === 'ONCE' && form.startsAt ? new Date(form.startsAt).toISOString() : null,
        durationMinutes: Number(form.durationMinutes),
        notes: form.notes,
        isActive: form.isActive,
      };
      return item ? (await api.put(`/api/zoom-classes/${item.id}`, body)).data : (await api.post('/api/zoom-classes', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['zoom-classes'] });
      toast('Saved');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });

  const ready =
    form.courseId && form.title.trim() && form.meetingUrl.trim() && (form.kind === 'ONCE' ? form.startsAt : form.days.length && form.startTime);

  return (
    <Modal
      title={item ? 'Edit Zoom class' : 'Add Zoom class'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course *">
          <Select value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value, classTimingId: '' }))}>
            <option value="">Choose a course</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Batch" hint="Limit it to students enrolled in one batch/timing, or leave as everyone in the course.">
          <Select value={form.classTimingId} onChange={(e) => set('classTimingId', e.target.value)} disabled={!form.courseId}>
            <option value="">Everyone in the course</option>
            {timings.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Class name *">
            <Input value={form.title} maxLength={120} onChange={(e) => set('title', e.target.value)} placeholder="Morning Hatha Yoga (online)" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Zoom meeting link *" hint="The invite link from Zoom, e.g. https://us02web.zoom.us/j/12345678901?pwd=…">
            <Input value={form.meetingUrl} maxLength={500} onChange={(e) => set('meetingUrl', e.target.value)} placeholder="https://" />
          </Field>
        </div>
        <Field label="Meeting ID">
          <Input value={form.meetingId} maxLength={40} onChange={(e) => set('meetingId', e.target.value)} placeholder="123 4567 8901" />
        </Field>
        <Field label="Passcode">
          <Input value={form.passcode} maxLength={40} onChange={(e) => set('passcode', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Schedule">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="WEEKLY">Repeats every week</option>
              <option value="ONCE">One-off session (workshop, special class)</option>
            </Select>
          </Field>
        </div>
        {form.kind === 'WEEKLY' ? (
          <>
            <div className="sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Days *</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = form.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set('days', on ? form.days.filter((x) => x !== d) : [...form.days, d])}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? 'border-brand bg-brand text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}
                    >
                      {DAY_LABEL[d]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Start time (India time) *">
              <Input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Date and start time (India time) *" hint="It disappears from students' accounts once it is over.">
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
        )}
        <Field label="Length (minutes)">
          <Input type="number" min={10} max={600} value={form.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note for students (optional)" hint="e.g. Join 5 minutes early, keep a mat and a block ready.">
            <Textarea value={form.notes} maxLength={1000} rows={2} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Show to enrolled students" />
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function StudentsDialog({ item, onClose }: { item: ZoomClass; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['zoom-classes', 'students', item.id],
    queryFn: async () => (await api.get(`/api/zoom-classes/${item.id}/students`)).data,
  });
  const students: { id: string; fullName: string; studentCode: string | null; plan: string; batch: string | null; status: string; hasWebsiteLogin: boolean }[] = data?.students ?? [];
  const noLogin = students.filter((s) => !s.hasWebsiteLogin).length;

  return (
    <Modal title={`Who sees “${item.title}”`} onClose={onClose} wide>
      {isLoading ? (
        <Loading />
      ) : !students.length ? (
        <p className="text-sm text-slate-500">No student is currently enrolled in {item.course.name}{item.classTiming ? ` (${item.classTiming.label} batch)` : ''}.</p>
      ) : (
        <div className="space-y-4">
          {noLogin > 0 && (
            <Callout tone="amber">
              {noLogin} student{noLogin === 1 ? ' has' : 's have'} no website login linked yet, so they cannot see the link. Connect them on the{' '}
              <Link to="/website-logins" className="font-medium underline">
                Website Logins
              </Link>{' '}
              page.
            </Callout>
          )}
          <ul className="divide-y divide-slate-100">
            {students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <Link to={`/students/${s.id}`} className="font-medium text-slate-900 hover:underline">
                    {s.fullName}
                  </Link>
                  <span className="text-slate-500">
                    {s.studentCode ? ` · ${s.studentCode}` : ''} · {s.plan}
                    {s.batch ? ` · ${s.batch}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={s.status === 'UPCOMING' ? 'blue' : s.status === 'RENEWAL_DUE' ? 'amber' : 'green'}>{STATUS_LABEL[s.status] ?? s.status}</Badge>
                  {s.hasWebsiteLogin ? <Badge tone="green">Can see it</Badge> : <Badge tone="amber">No website login</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
