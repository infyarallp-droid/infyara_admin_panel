import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import MediaPicker from '../../components/MediaPicker';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useFeedback } from '../../components/ui';
import { RowActions, StatusBadge, useCollectionActions, usePreview, type PublishStatus } from './shared';

interface Member {
  id: string;
  name: string;
  slug: string;
  title: string;
  shortBio: string;
  bio: string | null;
  photoUrl: string | null;
  specialization: string | null;
  experience: string | null;
  qualifications: string | null;
  socialLinks: Record<string, string> | null;
  employeeId: string | null;
  status: PublishStatus;
}

const SOCIALS = ['instagram', 'facebook', 'youtube', 'linkedin', 'website'] as const;

export default function Team() {
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['cms', 'team', showArchived],
    queryFn: async () => (await api.get(`/api/cms/team${showArchived ? '?includeArchived=true' : ''}`)).data,
  });
  const actions = useCollectionActions('team');
  const preview = usePreview();
  const items: Member[] = data?.items ?? [];
  const ids = items.map((i) => i.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle="Teachers and staff shown on the website's Team page. These public profiles are separate from HR records — no private details are shown."
        actions={
          <>
            <Button variant="ghost" onClick={() => preview('/team')}>
              Preview team page
            </Button>
            <Button onClick={() => setEditing('new')}>+ Add team member</Button>
          </>
        }
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
      </label>
      <Card>
        {isLoading ? (
          <Loading />
        ) : !items.length ? (
          <EmptyState title="No team members yet" action={<Button onClick={() => setEditing('new')}>Add the first one</Button>}>
            Published profiles appear on the website in the order shown here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((m, i) => (
              <li key={m.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100">
                    {m.photoUrl ? <img src={m.photoUrl} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-lg font-semibold text-slate-400">{m.name[0]}</div>}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {m.name} <StatusBadge status={m.status} />
                    </div>
                    <div className="text-sm text-slate-500">{m.title}</div>
                  </div>
                </div>
                <RowActions
                  status={m.status}
                  index={i}
                  count={items.length}
                  onMove={(d) => actions.move(ids, i, d)}
                  onStatus={(s) => actions.setStatus(m.id, s)}
                  onEdit={() => setEditing(m)}
                  onDelete={() => actions.remove(m.id, m.name)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <MemberForm member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MemberForm({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    name: member?.name ?? '',
    title: member?.title ?? '',
    shortBio: member?.shortBio ?? '',
    bio: member?.bio ?? '',
    photoUrl: member?.photoUrl ?? '',
    specialization: member?.specialization ?? '',
    experience: member?.experience ?? '',
    qualifications: member?.qualifications ?? '',
    socialLinks: (member?.socialLinks ?? {}) as Record<string, string>,
    employeeId: member?.employeeId ?? '',
    status: member?.status ?? ('DRAFT' as PublishStatus),
  });
  const [error, setError] = useState('');
  const employees = useQuery({ queryKey: ['employees'], queryFn: async () => (await api.get('/api/employees')).data });
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        employeeId: form.employeeId || null,
        socialLinks: Object.fromEntries(Object.entries(form.socialLinks).filter(([, v]) => v)),
      };
      return member ? (await api.put(`/api/cms/team/${member.id}`, body)).data : (await api.post('/api/cms/team', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'team'] });
      toast(form.status === 'PUBLISHED' ? 'Saved and published' : 'Saved as draft');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });

  return (
    <Modal
      title={member ? `Edit ${member.name}` : 'Add team member'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !form.name || !form.title || !form.shortBio} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <MediaPicker value={form.photoUrl} onChange={(v) => set('photoUrl', v)} label="Profile photo" />
          <p className="mt-1 text-xs text-slate-400">A square or portrait photo, at least 600px wide. It is resized automatically for each screen.</p>
        </div>
        <Field label="Name *">
          <Input value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Job title / designation *">
          <Input value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="Senior Yoga Teacher" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Short description *" hint={`${form.shortBio.length}/400 — shown on the profile card`}>
            <Textarea value={form.shortBio} maxLength={400} rows={2} onChange={(e) => set('shortBio', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Full biography (optional)" hint="Shown when a visitor opens the profile. Separate paragraphs with a blank line.">
            <Textarea value={form.bio} maxLength={4000} rows={5} onChange={(e) => set('bio', e.target.value)} />
          </Field>
        </div>
        <Field label="Specialisation">
          <Input value={form.specialization} maxLength={200} onChange={(e) => set('specialization', e.target.value)} placeholder="Hatha, prenatal yoga" />
        </Field>
        <Field label="Experience">
          <Input value={form.experience} maxLength={100} onChange={(e) => set('experience', e.target.value)} placeholder="12 years" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Qualifications">
            <Input value={form.qualifications} maxLength={500} onChange={(e) => set('qualifications', e.target.value)} placeholder="RYT-500, Mat Pilates certified" />
          </Field>
        </div>
        {SOCIALS.map((s) => (
          <Field key={s} label={`${s[0].toUpperCase()}${s.slice(1)} link`}>
            <Input value={form.socialLinks[s] ?? ''} placeholder="https://" onChange={(e) => set('socialLinks', { ...form.socialLinks, [s]: e.target.value })} />
          </Field>
        ))}
        <Field label="Linked HR record (optional, internal)" hint="Never shown on the website.">
          <Select value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
            <option value="">None</option>
            {employees.data?.employees?.map((e: { id: string; fullName: string }) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Visibility">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="DRAFT">Draft (hidden)</option>
            <option value="PUBLISHED">Published (visible on the website)</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
