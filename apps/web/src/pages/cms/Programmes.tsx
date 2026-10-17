import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DELIVERY_MODE, inr } from '../../lib/format';
import MediaPicker from '../../components/MediaPicker';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Textarea, Toggle, useFeedback } from '../../components/ui';
import { usePreview } from './shared';

interface Plan {
  id: string;
  title: string;
  pricePaise: string;
  isActive: boolean;
  isOnlinePurchasable: boolean;
}
interface Course {
  id: string;
  name: string;
  category: 'REGULAR' | 'TEACHER_TRAINING';
  deliveryMode: keyof typeof DELIVERY_MODE | null;
  isActive: boolean;
  slug: string | null;
  isPublished: boolean;
  publicSummary: string | null;
  publicForWhom: string | null;
  displayOrder: number;
  imageUrl: string | null;
  plans: Plan[];
}

export default function Programmes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const preview = usePreview();
  const [editing, setEditing] = useState<Course | null>(null);
  const canSell = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role ?? '');
  const { data, isLoading } = useQuery({ queryKey: ['cms', 'programmes'], queryFn: async () => (await api.get('/api/cms/programmes')).data });
  const online = useMutation({
    mutationFn: async ({ planId, on }: { planId: string; on: boolean }) => (await api.put(`/api/cms/plans/${planId}/online`, { isOnlinePurchasable: on })).data,
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['cms', 'programmes'] });
      toast(v.on ? 'Students can now buy this plan on the website' : 'Removed from online sale');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const courses: Course[] = data?.courses ?? [];

  const toggleOnline = async (plan: Plan, on: boolean) => {
    if (on && !(await confirm({ title: `Sell "${plan.title}" online?`, body: `The fee (${inr(plan.pricePaise)}) will be shown on the website and students can pay for it by card/UPI. Their enrolment is created automatically once the payment is confirmed.`, confirmLabel: 'Sell online' }))) return;
    online.mutate({ planId: plan.id, on });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programmes on the website"
        subtitle="Courses come from the course catalogue. Choose which appear on the website, write their public description, and decide which plans can be bought online."
        actions={
          <>
            <Button variant="ghost" onClick={() => preview('/classes')}>
              Preview classes
            </Button>
            <Button variant="ghost" onClick={() => preview('/teacher-training')}>
              Preview training
            </Button>
          </>
        }
      />
      {isLoading ? (
        <Loading />
      ) : !courses.length ? (
        <EmptyState title="No courses yet">Create courses on the Courses page first.</EmptyState>
      ) : (
        <div className="space-y-3">
          {courses.map((c) => (
            <Card key={c.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {c.name}
                    {c.isPublished ? <Badge tone="green">On website</Badge> : <Badge>Hidden</Badge>}
                    {!c.isActive && <Badge tone="red">Course inactive</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.category === 'TEACHER_TRAINING' ? 'Teacher training' : 'Regular class'} · {c.deliveryMode ? DELIVERY_MODE[c.deliveryMode] : 'Delivery mode not set'}
                    {c.slug && ` · /${c.slug}`}
                  </div>
                  {c.publicSummary && <p className="mt-1 max-w-2xl text-sm text-slate-600">{c.publicSummary}</p>}
                </div>
                <Button variant="ghost" onClick={() => setEditing(c)}>
                  Edit website details
                </Button>
              </div>
              {c.plans.length > 0 && (
                <div className="rounded-xl border border-slate-100">
                  {c.plans.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
                      <span>
                        {p.title} · {inr(p.pricePaise)} {!p.isActive && <Badge>inactive</Badge>}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        Sell online
                        <Toggle
                          label={`Sell ${p.title} online`}
                          checked={p.isOnlinePurchasable}
                          disabled={!canSell || online.isPending || (!p.isOnlinePurchasable && (!p.isActive || Number(p.pricePaise) <= 0))}
                          onChange={(v) => toggleOnline(p, v)}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {!canSell && <Callout tone="blue">Only an Admin or Super Admin can switch online sales on or off.</Callout>}
        </div>
      )}
      {editing && <CourseForm course={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CourseForm({ course, onClose }: { course: Course; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const suggested = course.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [form, setForm] = useState({
    slug: course.slug ?? suggested,
    isPublished: course.isPublished,
    publicSummary: course.publicSummary ?? '',
    publicForWhom: course.publicForWhom ?? '',
    displayOrder: course.displayOrder,
    imageUrl: course.imageUrl ?? '',
  });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => (await api.put(`/api/cms/programmes/${course.id}`, form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'programmes'] });
      toast('Saved — the website updates within a few seconds');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title={course.name}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <Toggle label="Show on website" checked={form.isPublished} onChange={(v) => setForm({ ...form, isPublished: v })} />
          Show this course on the website
        </label>
        <div className="sm:col-span-2">
          <Field label="Summary *" hint={`${form.publicSummary.length}/500 — what the class is like`}>
            <Textarea value={form.publicSummary} maxLength={500} rows={3} onChange={(e) => setForm({ ...form, publicSummary: e.target.value })} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Who it is for" hint={`${form.publicForWhom.length}/300`}>
            <Input value={form.publicForWhom} maxLength={300} onChange={(e) => setForm({ ...form, publicForWhom: e.target.value })} />
          </Field>
        </div>
        <Field label="Web address" hint={`mokshawellness.in/classes#${form.slug || '…'}`}>
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Order on the page" hint="Smaller numbers appear first">
          <Input type="number" min={0} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })} />
        </Field>
        <div className="sm:col-span-2">
          <MediaPicker value={form.imageUrl} onChange={(v) => setForm({ ...form, imageUrl: v })} label="Card image (optional)" />
        </div>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}
