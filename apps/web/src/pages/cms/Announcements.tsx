import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, useFeedback } from '../../components/ui';
import { RowActions, StatusBadge, useCollectionActions, type PublishStatus } from './shared';

interface Announcement {
  id: string;
  message: string;
  linkLabel: string | null;
  linkUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: PublishStatus;
}

/** ISO → value for <input type="datetime-local"> in the browser's local time. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function liveState(a: Announcement): { label: string; tone: 'green' | 'amber' | 'slate' } {
  const now = Date.now();
  if (a.status !== 'PUBLISHED') return { label: 'Not shown', tone: 'slate' };
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'amber' };
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return { label: 'Ended', tone: 'slate' };
  return { label: 'Showing now', tone: 'green' };
}

export default function Announcements() {
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['cms', 'announcements'], queryFn: async () => (await api.get('/api/cms/announcements?includeArchived=true')).data });
  const actions = useCollectionActions('announcements');
  const items: Announcement[] = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        subtitle="A banner across the top of every website page — new batches, holidays, workshops. Set start and end times to schedule them."
        actions={<Button onClick={() => setEditing('new')}>+ New announcement</Button>}
      />
      <Card>
        {isLoading ? (
          <Loading />
        ) : !items.length ? (
          <EmptyState title="No announcements" action={<Button onClick={() => setEditing('new')}>Create one</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((a, i) => {
              const live = liveState(a);
              return (
                <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {a.message} <StatusBadge status={a.status} /> <Badge tone={live.tone}>{live.label}</Badge>
                    </div>
                    <p className="text-xs text-slate-500">
                      {a.startsAt ? `From ${fmtDateTime(a.startsAt)}` : 'From now'} · {a.endsAt ? `until ${fmtDateTime(a.endsAt)}` : 'no end date'}
                      {a.linkUrl ? ` · links to ${a.linkUrl}` : ''}
                    </p>
                  </div>
                  <RowActions
                    status={a.status}
                    index={i}
                    count={items.length}
                    onMove={(d) => actions.move(items.map((x) => x.id), i, d)}
                    onStatus={(s) => actions.setStatus(a.id, s)}
                    onEdit={() => setEditing(a)}
                    onDelete={() => actions.remove(a.id, 'this announcement')}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <AnnouncementForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AnnouncementForm({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    message: item?.message ?? '',
    linkLabel: item?.linkLabel ?? '',
    linkUrl: item?.linkUrl ?? '',
    startsAt: toLocalInput(item?.startsAt ?? null),
    endsAt: toLocalInput(item?.endsAt ?? null),
    status: item?.status ?? ('PUBLISHED' as PublishStatus),
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      };
      return item ? (await api.put(`/api/cms/announcements/${item.id}`, body)).data : (await api.post('/api/cms/announcements', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'announcements'] });
      toast('Saved');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title={item ? 'Edit announcement' : 'New announcement'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || form.message.length < 3} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Message" hint={`${form.message.length}/200 — keep it short; it shows in a single line on phones`}>
          <Input value={form.message} maxLength={200} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="New evening Pilates batch starts 1 November" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Link text (optional)">
            <Input value={form.linkLabel} maxLength={40} onChange={(e) => setForm({ ...form, linkLabel: e.target.value })} placeholder="Enquire now" />
          </Field>
          <Field label="Link (optional)" hint="/contact or https://…">
            <Input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} />
          </Field>
          <Field label="Show from (optional)">
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label="Show until (optional)">
            <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
          </Field>
          <Field label="Visibility">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
