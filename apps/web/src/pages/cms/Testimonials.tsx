import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import MediaPicker from '../../components/MediaPicker';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useFeedback } from '../../components/ui';
import { RowActions, StatusBadge, useCollectionActions, usePreview, type PublishStatus } from './shared';

type VideoSource = 'NONE' | 'YOUTUBE' | 'VIMEO' | 'UPLOAD';
interface Testimonial {
  id: string;
  studentName: string;
  photoUrl: string | null;
  videoSource: VideoSource;
  videoUrl: string | null;
  posterUrl: string | null;
  quote: string;
  courseName: string | null;
  isFeatured: boolean;
  status: PublishStatus;
  consentName: boolean;
  consentPhoto: boolean;
  consentVideo: boolean;
  consentRecordedAt: string | null;
  consentNote: string | null;
}

const SOURCE_LABEL: Record<VideoSource, string> = { NONE: 'Written only', YOUTUBE: 'YouTube', VIMEO: 'Vimeo', UPLOAD: 'Uploaded video' };

export default function Testimonials() {
  const [editing, setEditing] = useState<Testimonial | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['cms', 'testimonials', showArchived],
    queryFn: async () => (await api.get(`/api/cms/testimonials${showArchived ? '?includeArchived=true' : ''}`)).data,
  });
  const actions = useCollectionActions('testimonials');
  const preview = usePreview();
  const items: Testimonial[] = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Testimonials"
        subtitle="Video and written feedback from students. A testimonial can only be published after you record the student's consent."
        actions={
          <>
            <Button variant="ghost" onClick={() => preview('/testimonials')}>
              Preview
            </Button>
            <Button onClick={() => setEditing('new')}>+ Add testimonial</Button>
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
          <EmptyState title="No testimonials yet" action={<Button onClick={() => setEditing('new')}>Add a testimonial</Button>}>
            Featured testimonials appear on the home page; all published ones appear on the Student Stories page.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((t, i) => (
              <li key={t.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-100 text-xs text-slate-400">
                    {t.posterUrl || t.photoUrl ? <img src={t.posterUrl ?? t.photoUrl!} alt="" className="h-full w-full object-cover" /> : SOURCE_LABEL[t.videoSource]}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {t.studentName} <StatusBadge status={t.status} />
                      {t.isFeatured && <Badge tone="blue">Featured</Badge>}
                      {!t.consentRecordedAt && <Badge tone="red">No consent recorded</Badge>}
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-500">“{t.quote}”</p>
                  </div>
                </div>
                <RowActions
                  status={t.status}
                  index={i}
                  count={items.length}
                  onMove={(d) => actions.move(items.map((x) => x.id), i, d)}
                  onStatus={(s) => actions.setStatus(t.id, s)}
                  onEdit={() => setEditing(t)}
                  onDelete={() => actions.remove(t.id, `${t.studentName}'s testimonial`)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <TestimonialForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TestimonialForm({ item, onClose }: { item: Testimonial | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({
    studentName: item?.studentName ?? '',
    quote: item?.quote ?? '',
    courseName: item?.courseName ?? '',
    photoUrl: item?.photoUrl ?? '',
    videoSource: item?.videoSource ?? ('NONE' as VideoSource),
    videoUrl: item?.videoUrl ?? '',
    posterUrl: item?.posterUrl ?? '',
    isFeatured: item?.isFeatured ?? false,
    status: item?.status ?? ('DRAFT' as PublishStatus),
    consentName: item?.consentName ?? false,
    consentPhoto: item?.consentPhoto ?? false,
    consentVideo: item?.consentVideo ?? false,
    consentNote: item?.consentNote ?? '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const hasVideo = form.videoSource !== 'NONE';
  const consentOk = form.consentName && (!form.photoUrl || form.consentPhoto) && (!hasVideo || form.consentVideo);

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...form, videoUrl: hasVideo ? form.videoUrl : '' };
      return item ? (await api.put(`/api/cms/testimonials/${item.id}`, body)).data : (await api.post('/api/cms/testimonials', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'testimonials'] });
      toast('Testimonial saved');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });

  return (
    <Modal
      title={item ? 'Edit testimonial' : 'Add testimonial'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !form.studentName || form.quote.length < 10} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Student name *">
          <Input value={form.studentName} maxLength={80} onChange={(e) => set('studentName', e.target.value)} />
        </Field>
        <Field label="Course or programme (optional)">
          <Input value={form.courseName} maxLength={120} onChange={(e) => set('courseName', e.target.value)} placeholder="200-Hour Yoga Teacher Training" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Short written feedback *" hint={`${form.quote.length}/600`}>
            <Textarea value={form.quote} maxLength={600} rows={3} onChange={(e) => set('quote', e.target.value)} />
          </Field>
        </div>

        <Field label="Video">
          <Select value={form.videoSource} onChange={(e) => set('videoSource', e.target.value)}>
            <option value="NONE">No video (written only)</option>
            <option value="YOUTUBE">YouTube link (recommended)</option>
            <option value="VIMEO">Vimeo link</option>
            <option value="UPLOAD">Upload a video file</option>
          </Select>
        </Field>
        {(form.videoSource === 'YOUTUBE' || form.videoSource === 'VIMEO') && (
          <Field label={`${SOURCE_LABEL[form.videoSource]} link *`} hint="Unlisted videos work — visitors don't need to find it on YouTube.">
            <Input value={form.videoUrl} onChange={(e) => set('videoUrl', e.target.value)} placeholder={form.videoSource === 'YOUTUBE' ? 'https://www.youtube.com/watch?v=…' : 'https://vimeo.com/123456'} />
          </Field>
        )}
        {form.videoSource === 'UPLOAD' && (
          <div className="sm:col-span-2">
            <MediaPicker kind="VIDEO" value={form.videoUrl} onChange={(v) => set('videoUrl', v)} label="Video file (MP4/WebM, up to 50 MB)" />
            <p className="mt-1 text-xs text-slate-400">For long or high-quality videos, YouTube is better: it adapts to slow connections and costs nothing to stream.</p>
          </div>
        )}
        {hasVideo && (
          <div className="sm:col-span-2">
            <MediaPicker value={form.posterUrl} onChange={(v) => set('posterUrl', v)} label="Video thumbnail (optional)" />
            <p className="mt-1 text-xs text-slate-400">YouTube thumbnails are used automatically if you leave this empty.</p>
          </div>
        )}
        <div className="sm:col-span-2">
          <MediaPicker value={form.photoUrl} onChange={(v) => set('photoUrl', v)} label="Student photo (optional)" />
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:col-span-2">
          <div className="text-sm font-semibold text-slate-800">Student consent for public display</div>
          <p className="text-xs text-slate-500">Tick only what the student has agreed to, in writing or on a recorded message. The website shows only consented items.</p>
          {[
            ['consentName', 'Show their name'],
            ['consentPhoto', 'Show their photo'],
            ['consentVideo', 'Show their video'],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form[k as 'consentName']} onChange={(e) => set(k as keyof typeof form, e.target.checked)} />
              {label}
            </label>
          ))}
          <Field label="How was consent given?" hint="e.g. Signed release form on 14 Oct 2026; WhatsApp message saved.">
            <Input value={form.consentNote} maxLength={500} onChange={(e) => set('consentNote', e.target.value)} />
          </Field>
          {item?.consentRecordedAt && <p className="text-xs text-slate-400">Consent last recorded {fmtDateTime(item.consentRecordedAt)}</p>}
        </div>

        <Field label="Visibility">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="DRAFT">Draft (hidden)</option>
            <option value="PUBLISHED" disabled={!consentOk}>
              Published {consentOk ? '' : '— record consent first'}
            </option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /> Feature on the home page
        </label>
      </div>
      {form.status === 'PUBLISHED' && !consentOk && (
        <div className="mt-4">
          <Callout tone="red">Record consent for everything shown (name{form.photoUrl ? ', photo' : ''}{hasVideo ? ', video' : ''}) before publishing.</Callout>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
