import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MESSAGE_PLACEHOLDERS, REMINDER_TRIGGERS } from '@moksha/shared';
import { api, apiError } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Tabs, Textarea, Toggle, useFeedback, type Tone } from '../components/ui';

type TabKey = 'overview' | 'send' | 'rules' | 'templates' | 'consent' | 'history';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string | null;
  variableCount: number;
  lastSyncedAt: string | null;
}

const MSG_STATUS: Record<string, { label: string; tone: Tone }> = {
  QUEUED: { label: 'Scheduled', tone: 'blue' },
  PENDING: { label: 'Sending', tone: 'blue' },
  SENT: { label: 'Sent', tone: 'green' },
  DELIVERED: { label: 'Delivered', tone: 'green' },
  READ: { label: 'Read', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  NO_CONSENT: { label: 'No opt-in', tone: 'amber' },
  NOT_CONFIGURED: { label: 'WhatsApp not set up', tone: 'amber' },
  INVALID_RECIPIENT: { label: 'Invalid number', tone: 'red' },
  CANCELLED: { label: 'Cancelled', tone: 'slate' },
};

export default function WhatsApp() {
  const [tab, setTab] = useState<TabKey>('overview');
  const status = useQuery({ queryKey: ['wa-status'], queryFn: async () => (await api.get('/api/whatsapp/status')).data });
  const s = status.data;
  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Reminders" subtitle="Send and schedule WhatsApp messages to students who have opted in, and set up automatic reminders." />
      {s && !s.configured && (
        <Callout tone="amber" title="WhatsApp is not connected yet">
          Messages you send or schedule are kept in the queue and go out automatically once the WhatsApp Business credentials are added to the server. See the setup guide (docs/SETUP_WHATSAPP.md).
        </Callout>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'send', label: 'Send / schedule' },
          { value: 'rules', label: 'Automatic reminders' },
          { value: 'templates', label: 'Templates' },
          { value: 'consent', label: 'Opt-ins' },
          { value: 'history', label: 'History' },
        ]}
      />
      {tab === 'overview' && <Overview status={s} loading={status.isLoading} go={setTab} />}
      {tab === 'send' && <Send go={setTab} />}
      {tab === 'rules' && <Rules />}
      {tab === 'templates' && <Templates syncConfigured={!!s?.templateSyncConfigured} />}
      {tab === 'consent' && <Consent />}
      {tab === 'history' && <History />}
    </div>
  );
}

function Overview({ status, loading, go }: { status: any; loading: boolean; go: (t: TabKey) => void }) {
  if (loading || !status) return <Loading />;
  const steps = [
    { done: status.configured, text: 'WhatsApp Business credentials added on the server', hint: 'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN' },
    { done: status.webhookSignatureConfigured, text: 'Webhook secured (delivery receipts and STOP replies)', hint: `Callback URL: ${status.webhookUrl}` },
    { done: status.counts.approvedTemplates > 0, text: 'At least one approved message template', hint: 'Templates tab' },
    { done: status.counts.optedIn > 0, text: 'Students have opted in', hint: 'Opt-ins tab, or at website sign-up' },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <h2 className="mb-3 font-semibold">Setup checklist</h2>
        <ul className="space-y-3">
          {steps.map((st) => (
            <li key={st.text} className="flex gap-3">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs text-white ${st.done ? 'bg-green-600' : 'bg-slate-300'}`}>{st.done ? '✓' : ''}</span>
              <span>
                <span className="block text-sm text-slate-800">{st.text}</span>
                <span className="block break-all text-xs text-slate-400">{st.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Opted-in numbers', status.counts.optedIn, 'consent'],
          ['Approved templates', status.counts.approvedTemplates, 'templates'],
          ['Scheduled / queued', status.counts.queued, 'history'],
          ['Failed (7 days)', status.counts.failedLast7Days, 'history'],
        ].map(([label, value, tab]) => (
          <button key={label as string} onClick={() => go(tab as TabKey)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-brand">
            <div className="text-2xl font-bold">{value as number}</div>
            <div className="text-xs text-slate-500">{label as string}</div>
          </button>
        ))}
        <div className="col-span-2">
          <Callout tone="blue">
            Every message goes only to numbers with a recorded opt-in. Students can opt out by replying <strong>STOP</strong> or from their website account.
          </Callout>
        </div>
      </div>
    </div>
  );
}

function useTemplates() {
  return useQuery({ queryKey: ['wa-templates'], queryFn: async () => (await api.get('/api/whatsapp/templates')).data.templates as Template[] });
}

/** Inputs for each {{n}} variable of a template, with placeholder chips. */
function ParamsEditor({ template, params, onChange }: { template: Template | undefined; params: string[]; onChange: (p: string[]) => void }) {
  if (!template) return null;
  if (!template.variableCount) return <p className="text-sm text-slate-500">This template has no variables.</p>;
  return (
    <div className="space-y-3">
      {template.bodyText && (
        <div className="whitespace-pre-wrap rounded-xl bg-[#e7f6e7] px-4 py-3 text-sm text-slate-800">
          {template.bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => (params[Number(n) - 1] ? `[${params[Number(n) - 1]}]` : `{{${n}}}`))}
        </div>
      )}
      {Array.from({ length: template.variableCount }, (_, i) => (
        <Field key={i} label={`Value for {{${i + 1}}}`}>
          <Input value={params[i] ?? ''} onChange={(e) => onChange(Object.assign([...params], { [i]: e.target.value }))} placeholder="Text, or a placeholder such as {name}" />
        </Field>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {MESSAGE_PLACEHOLDERS.map((p) => (
          <span key={p.token} title={p.label} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
            {p.token}
          </span>
        ))}
      </div>
      <p className="text-xs text-slate-400">Placeholders are replaced for each student, e.g. {'{name}'} → their name, {'{end_date}'} → their enrolment end date.</p>
    </div>
  );
}

function Send({ go }: { go: (t: TabKey) => void }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const templates = useTemplates();
  const approved = (templates.data ?? []).filter((t) => t.status === 'APPROVED');
  const [templateId, setTemplateId] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, { id: string; fullName: string; consent: string | null }>>(new Map());
  const students = useQuery({
    queryKey: ['wa-consents', search],
    queryFn: async () => (await api.get(`/api/whatsapp/consents?${search ? `q=${encodeURIComponent(search)}` : ''}`)).data.students,
  });
  const template = approved.find((t) => t.id === templateId);
  const optedIn = [...selected.values()].filter((s) => s.consent === 'OPTED_IN').length;

  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post('/api/whatsapp/campaigns', {
          name: name || `${template?.name} — ${new Date().toLocaleDateString('en-IN')}`,
          templateId,
          params,
          studentIds: [...selected.keys()],
          ...(when === 'later' && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        })
      ).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wa-campaigns'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast(
        when === 'later'
          ? `Scheduled for ${r.queued} student(s)${r.skipped ? ` · ${r.skipped} skipped (no opt-in)` : ''}`
          : `${r.delivery?.sent ?? 0} sent${r.queued - (r.delivery?.sent ?? 0) > 0 ? `, ${r.queued - (r.delivery?.sent ?? 0)} queued` : ''}${r.skipped ? ` · ${r.skipped} skipped (no opt-in)` : ''}`,
      );
      setSelected(new Map());
      go('history');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });

  const toggle = (s: { id: string; fullName: string; consent: string | null }) =>
    setSelected((m) => {
      const n = new Map(m);
      if (n.has(s.id)) n.delete(s.id);
      else n.set(s.id, s);
      return n;
    });

  if (templates.isLoading) return <Loading />;
  if (!approved.length) {
    return (
      <EmptyState title="No approved templates yet" action={<Button onClick={() => go('templates')}>Go to Templates</Button>}>
        WhatsApp only allows businesses to start a conversation with a template approved by Meta.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card className="space-y-4">
        <h2 className="font-semibold">1. Message</h2>
        <Field label="Template">
          <Select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setParams([]);
            }}
          >
            <option value="">Choose a template…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language}, {t.category.toLowerCase()})
              </option>
            ))}
          </Select>
        </Field>
        <ParamsEditor template={template} params={params} onChange={setParams} />
        <Field label="Name for this send (optional)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali holiday notice" />
        </Field>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Send now
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> Schedule
          </label>
        </div>
        {when === 'later' && (
          <Field label="Send at">
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </Field>
        )}
      </Card>
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">2. Students</h2>
          <span className="text-sm text-slate-500">
            {selected.size} selected · {optedIn} opted in
          </span>
        </div>
        <Input placeholder="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2 text-xs">
          <button
            className="text-brand hover:underline"
            onClick={() =>
              setSelected((m) => {
                const n = new Map(m);
                for (const s of students.data ?? []) if (s.consent === 'OPTED_IN') n.set(s.id, s);
                return n;
              })
            }
          >
            Select all opted-in shown
          </button>
          <button className="text-slate-500 hover:underline" onClick={() => setSelected(new Map())}>
            Clear
          </button>
        </div>
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {(students.data ?? []).map((s: { id: string; fullName: string; mobile: string; studentCode: string; consent: string | null }) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s)} />
                  {s.fullName} <span className="text-xs text-slate-400">{s.studentCode}</span>
                </span>
                {s.consent === 'OPTED_IN' ? <Badge tone="green">Opted in</Badge> : s.consent === 'OPTED_OUT' ? <Badge tone="red">Opted out</Badge> : <Badge>No opt-in</Badge>}
              </label>
            </li>
          ))}
        </ul>
        {selected.size > optedIn && <Callout tone="amber">{selected.size - optedIn} selected student(s) have not opted in and will be skipped.</Callout>}
        <Button
          className="w-full"
          disabled={!template || !optedIn || send.isPending || params.length < (template?.variableCount ?? 0) || params.some((p) => !p?.trim()) || (when === 'later' && !scheduledAt)}
          onClick={async () => {
            if (await confirm({ title: when === 'now' ? `Send to ${optedIn} student(s) now?` : `Schedule for ${optedIn} student(s)?`, confirmLabel: when === 'now' ? 'Send' : 'Schedule' })) send.mutate();
          }}
        >
          {send.isPending ? 'Working…' : when === 'now' ? `Send to ${optedIn} student(s)` : `Schedule for ${optedIn} student(s)`}
        </Button>
      </Card>
    </div>
  );
}

function Rules() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['wa-rules'], queryFn: async () => (await api.get('/api/whatsapp/rules')).data.rules });
  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => (await api.patch(`/api/whatsapp/rules/${id}/enabled`, { isEnabled: on })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-rules'] }),
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/whatsapp/rules/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-rules'] });
      toast('Rule deleted');
    },
  });
  const trigger = (v: string) => REMINDER_TRIGGERS.find((t) => t.value === v);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">Reminders sent automatically. Each one is sent once per student and event, only to opted-in students.</p>
        <Button onClick={() => setEditing('new')}>+ New rule</Button>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="No automatic reminders yet">Example: “Renewal reminder 5 days before an enrolment ends”.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((r: any) => (
            <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-500">
                  {trigger(r.trigger)?.label.split(':')[0]}
                  {trigger(r.trigger)?.usesOffset && ` · ${Math.abs(r.offsetDays)} day(s) ${r.offsetDays >= 0 ? 'before' : 'after'}`} · template {r.template.name}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(r.statusCounts ?? {}).map(([k, v]) => (
                    <Badge key={k} tone={MSG_STATUS[k]?.tone}>
                      {MSG_STATUS[k]?.label ?? k}: {v as number}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Toggle label="Enabled" checked={r.isEnabled} onChange={(on) => toggle.mutate({ id: r.id, on })} />
                <Button variant="subtle" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button
                  variant="subtle"
                  className="!text-red-600"
                  onClick={async () => (await confirm({ title: `Delete "${r.name}"?`, body: 'Messages it has already queued are cancelled.', danger: true, confirmLabel: 'Delete' })) && remove.mutate(r.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Callout tone="blue">
        The built-in renewal reminder (configured on the server) keeps working until you enable a “Renewal reminder” rule here, which then replaces it.
      </Callout>
      {editing && <RuleForm rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RuleForm({ rule, onClose }: { rule: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const templates = useTemplates();
  const approved = (templates.data ?? []).filter((t) => t.status === 'APPROVED');
  const [form, setForm] = useState({
    name: rule?.name ?? '',
    trigger: rule?.trigger ?? 'ENROLLMENT_EXPIRY',
    offsetDays: rule?.offsetDays ?? 3,
    templateId: rule?.templateId ?? '',
    params: (rule?.params as string[]) ?? [],
    isEnabled: rule?.isEnabled ?? true,
  });
  const [error, setError] = useState('');
  const trig = REMINDER_TRIGGERS.find((t) => t.value === form.trigger);
  const save = useMutation({
    mutationFn: async () => (rule ? (await api.put(`/api/whatsapp/rules/${rule.id}`, form)).data : (await api.post('/api/whatsapp/rules', form)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-rules'] });
      toast('Rule saved');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title={rule ? 'Edit reminder rule' : 'New reminder rule'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !form.name || !form.templateId} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Renewal reminder — 5 days before" />
        </Field>
        <Field label="When">
          <Select value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
            {REMINDER_TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {trig?.usesOffset && (
          <Field label="Days" hint={form.trigger === 'INVOICE_DUE' ? 'Positive = before the due date, negative = after (overdue).' : 'How many days before the date.'}>
            <Input type="number" min={-60} max={60} value={form.offsetDays} onChange={(e) => setForm({ ...form, offsetDays: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Template">
          <Select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value, params: [] })}>
            <option value="">Choose…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.language})
              </option>
            ))}
          </Select>
        </Field>
        <ParamsEditor template={approved.find((t) => t.id === form.templateId)} params={form.params} onChange={(p) => setForm({ ...form, params: p })} />
        <label className="flex items-center gap-3 text-sm">
          <Toggle label="Enabled" checked={form.isEnabled} onChange={(v) => setForm({ ...form, isEnabled: v })} /> Enabled
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function Templates({ syncConfigured }: { syncConfigured: boolean }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const { data, isLoading } = useTemplates();
  const [adding, setAdding] = useState(false);
  const sync = useMutation({
    mutationFn: async () => (await api.post('/api/whatsapp/templates/sync')).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast(`${r.synced} template(s) synced from Meta`);
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/whatsapp/templates/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-templates'] }),
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const tone = (s: string): Tone => (s === 'APPROVED' ? 'green' : s === 'PENDING' ? 'amber' : 'red');
  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-slate-500">
          Templates are created and approved in Meta's WhatsApp Manager. Sync them here, or add an approved one by hand with exactly the same name and language.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setAdding(true)}>
            Add manually
          </Button>
          <Button disabled={!syncConfigured || sync.isPending} onClick={() => sync.mutate()} title={syncConfigured ? '' : 'Set WHATSAPP_BUSINESS_ACCOUNT_ID on the server first'}>
            {sync.isPending ? 'Syncing…' : 'Sync from Meta'}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="No templates" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                  {t.name} <Badge>{t.language}</Badge> <Badge tone="blue">{t.category.toLowerCase()}</Badge> <Badge tone={tone(t.status)}>{t.status.toLowerCase()}</Badge>
                </div>
                {t.bodyText && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{t.bodyText}</p>}
                <p className="text-xs text-slate-400">
                  {t.variableCount} variable(s){t.lastSyncedAt ? ` · synced ${fmtDateTime(t.lastSyncedAt)}` : ' · added manually'}
                </p>
              </div>
              <Button
                variant="subtle"
                className="!text-red-600"
                onClick={async () => (await confirm({ title: `Remove ${t.name}?`, body: 'This only removes it from the admin panel, not from Meta.', danger: true })) && remove.mutate(t.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && <TemplateForm onClose={() => setAdding(false)} />}
    </Card>
  );
}

function TemplateForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: '', language: 'en', category: 'UTILITY', bodyText: '', status: 'APPROVED' });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => (await api.post('/api/whatsapp/templates', form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wa-templates'] });
      toast('Template added');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title="Add an approved template"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.name || save.isPending} onClick={() => save.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="blue">Use exactly the name and language shown in WhatsApp Manager → Message templates. Sending fails if they don't match.</Callout>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Template name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="renewal_reminder" />
          </Field>
          <Field label="Language code">
            <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="en or en_US" />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="UTILITY">Utility (reminders, confirmations)</option>
              <option value="MARKETING">Marketing (offers, announcements)</option>
            </Select>
          </Field>
          <Field label="Status in Meta">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
            </Select>
          </Field>
        </div>
        <Field label="Body text (copy it from Meta)" hint="Used to count the {{1}}, {{2}}… variables and show a preview.">
          <Textarea value={form.bodyText} rows={4} onChange={(e) => setForm({ ...form, bodyText: e.target.value })} placeholder="Hi {{1}}, your {{2}} ends on {{3}}. Reply to renew." />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function Consent() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<'OPTED_IN' | 'OPTED_OUT' | null>(null);
  const [note, setNote] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['wa-consents', q, state],
    queryFn: async () => (await api.get(`/api/whatsapp/consents?${new URLSearchParams({ ...(q && { q }), ...(state && { state }) })}`)).data.students,
  });
  const save = useMutation({
    mutationFn: async () => (await api.post('/api/whatsapp/consents', { studentIds: [...selected], state: recording, note })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wa-consents'] });
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      toast(`${r.changed} record(s) updated`);
      setRecording(null);
      setSelected(new Set());
      setNote('');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  return (
    <Card className="space-y-4">
      <p className="text-sm text-slate-500">
        Who may receive WhatsApp messages. Opt-ins come from website sign-ups, from staff (record how the student agreed), and STOP/START replies. Every change is kept as history.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input placeholder="Search students" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">Everyone</option>
          <option value="OPTED_IN">Opted in</option>
          <option value="OPTED_OUT">Opted out</option>
          <option value="NONE">Not asked yet</option>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!selected.size} onClick={() => setRecording('OPTED_IN')}>
          Record opt-in ({selected.size})
        </Button>
        <Button variant="ghost" disabled={!selected.size} onClick={() => setRecording('OPTED_OUT')}>
          Record opt-out
        </Button>
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {(data ?? []).map((s: any) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() =>
                      setSelected((x) => {
                        const n = new Set(x);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                    }
                  />
                  {s.fullName} <span className="text-xs text-slate-400">{s.mobile}</span>
                </span>
                {s.consent === 'OPTED_IN' ? <Badge tone="green">Opted in</Badge> : s.consent === 'OPTED_OUT' ? <Badge tone="red">Opted out</Badge> : <Badge>Not asked</Badge>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {recording && (
        <Modal
          title={recording === 'OPTED_IN' ? 'Record WhatsApp opt-in' : 'Record opt-out'}
          onClose={() => setRecording(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRecording(null)}>
                Cancel
              </Button>
              <Button disabled={note.trim().length < 5 || save.isPending} onClick={() => save.mutate()}>
                Save for {selected.size} student(s)
              </Button>
            </>
          }
        >
          <Field label="How did they agree / ask?" hint="Kept as evidence, e.g. “Ticked WhatsApp box on admission form, 12 Oct 2026”.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </Field>
          {recording === 'OPTED_IN' && <p className="mt-3 text-xs text-slate-500">Only record an opt-in the student actually gave. Meta can restrict the business number if people report unwanted messages.</p>}
        </Modal>
      )}
    </Card>
  );
}

function History() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const campaigns = useQuery({ queryKey: ['wa-campaigns'], queryFn: async () => (await api.get('/api/whatsapp/campaigns')).data.campaigns });
  const messages = useQuery({
    queryKey: ['wa-messages', status, page],
    queryFn: async () => (await api.get(`/api/whatsapp/messages?page=${page}${status ? `&status=${status}` : ''}`)).data,
    refetchInterval: 20_000,
  });
  const retry = useMutation({
    mutationFn: async (ids: string[]) => (await api.post('/api/whatsapp/messages/retry', { ids })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wa-messages'] });
      toast(`${r.requeued} message(s) retried${r.skipped.length ? `, ${r.skipped.length} not eligible` : ''}`);
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => (await api.post(`/api/whatsapp/campaigns/${id}/cancel`)).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['wa-campaigns'] });
      qc.invalidateQueries({ queryKey: ['wa-messages'] });
      toast(`${r.cancelled} scheduled message(s) cancelled`);
    },
  });
  const failedIds = useMemo(() => (messages.data?.messages ?? []).filter((m: any) => ['FAILED', 'NOT_CONFIGURED'].includes(m.status)).map((m: any) => m.id), [messages.data]);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 font-semibold">Sends</h2>
        {campaigns.isLoading ? (
          <Loading />
        ) : !campaigns.data?.length ? (
          <p className="text-sm text-slate-400">Nothing sent from the admin panel yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {campaigns.data.map((c: any) => (
              <li key={c.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-medium">
                    {c.name} {c.status === 'CANCELLED' && <Badge>Cancelled</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.template.name} · {new Date(c.scheduledAt) > new Date() ? `scheduled for ${fmtDateTime(c.scheduledAt)}` : fmtDateTime(c.scheduledAt)} · {c.recipientCount} recipient(s){c.skippedCount ? `, ${c.skippedCount} skipped` : ''}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(c.statusCounts ?? {}).map(([k, v]) => (
                      <Badge key={k} tone={MSG_STATUS[k]?.tone}>
                        {MSG_STATUS[k]?.label ?? k}: {v as number}
                      </Badge>
                    ))}
                  </div>
                </div>
                {c.statusCounts?.QUEUED > 0 && c.status !== 'CANCELLED' && (
                  <Button variant="ghost" onClick={async () => (await confirm({ title: 'Cancel the scheduled messages?', danger: true, confirmLabel: 'Cancel them' })) && cancel.mutate(c.id)}>
                    Cancel scheduled
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Messages</h2>
          <div className="flex gap-2">
            <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} className="!w-auto">
              <option value="">All statuses</option>
              {Object.entries(MSG_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <Button variant="ghost" disabled={!failedIds.length || retry.isPending} onClick={() => retry.mutate(failedIds)}>
              Retry failed on this page ({failedIds.length})
            </Button>
          </div>
        </div>
        {messages.isLoading ? (
          <Loading />
        ) : !messages.data?.messages?.length ? (
          <EmptyState title="No messages" />
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 font-medium">Student</th>
                    <th className="py-2 font-medium">Message</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.data.messages.map((m: any) => (
                    <tr key={m.id} className="border-b border-slate-50 align-top">
                      <td className="px-5 py-2.5">
                        <div className="font-medium">{m.studentName ?? '—'}</div>
                        <div className="font-mono text-xs text-slate-400">{m.recipient ?? ''}</div>
                      </td>
                      <td className="py-2.5">
                        <div className="font-mono text-xs">{m.templateName}</div>
                        <div className="text-xs text-slate-500">{(m.params ?? []).join(' · ')}</div>
                      </td>
                      <td className="py-2.5">
                        <Badge tone={MSG_STATUS[m.status]?.tone}>{MSG_STATUS[m.status]?.label ?? m.status}</Badge>
                        {m.error && <div className="mt-1 max-w-xs text-xs text-red-600">{m.error}</div>}
                        {m.attempts > 1 && <div className="text-xs text-slate-400">{m.attempts} attempts</div>}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">
                        {m.status === 'QUEUED' && m.scheduledFor ? `Due ${fmtDateTime(m.scheduledFor)}` : fmtDateTime(m.sentAt ?? m.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={messages.data.page} pageSize={messages.data.pageSize} total={messages.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
