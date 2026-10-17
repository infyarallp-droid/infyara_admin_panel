import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentBlockDef, ContentField } from '@moksha/shared';
import { api, apiError } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import MediaPicker from '../../components/MediaPicker';
import { Badge, Button, Callout, Card, Field, Input, Loading, PageHeader, Select, Textarea, useFeedback } from '../../components/ui';
import { usePreview } from './shared';

type Data = Record<string, unknown>;

interface BlockSummary {
  key: string;
  label: string;
  page: string;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  customised: boolean;
}

export default function WebsiteContent() {
  const { data, isLoading } = useQuery({ queryKey: ['cms-blocks'], queryFn: async () => (await api.get('/api/cms/blocks')).data });
  const [selected, setSelected] = useState<string | null>(null);
  const blocks: BlockSummary[] = useMemo(() => data?.blocks ?? [], [data]);
  const byPage = useMemo(() => {
    const groups = new Map<string, BlockSummary[]>();
    for (const b of blocks) groups.set(b.page, [...(groups.get(b.page) ?? []), b]);
    return [...groups.entries()];
  }, [blocks]);

  useEffect(() => {
    if (!selected && blocks.length) setSelected(blocks[0].key);
  }, [blocks, selected]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Page Content"
        subtitle="Edit the text and images on the website. Save a draft, preview it on the real site, then publish — it goes live within seconds."
      />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
          <Card className="!p-3 lg:sticky lg:top-24 lg:self-start">
            <nav aria-label="Sections" className="space-y-4">
              {byPage.map(([page, items]) => (
                <div key={page}>
                  <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{page === '/' ? 'Home page' : page}</div>
                  {items.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => setSelected(b.key)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                        selected === b.key ? 'bg-brand-soft font-medium text-brand-fg' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate">{b.label}</span>
                      {b.hasUnpublishedChanges && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" title="Unpublished changes" />}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </Card>
          {selected && <BlockEditor key={selected} blockKey={selected} />}
        </div>
      )}
    </div>
  );
}

function BlockEditor({ blockKey }: { blockKey: string }) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const preview = usePreview();
  const { data, isLoading } = useQuery({ queryKey: ['cms-block', blockKey], queryFn: async () => (await api.get(`/api/cms/blocks/${blockKey}`)).data });
  const [form, setForm] = useState<Data | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(data.draft as Data);
      setDirty(false);
    }
  }, [data]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (publish: boolean) => (await api.put(`/api/cms/blocks/${blockKey}`, { data: form, publish })).data,
    onSuccess: (_r, publish) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['cms-blocks'] });
      qc.invalidateQueries({ queryKey: ['cms-block', blockKey] });
      toast(publish ? 'Published — the website updates within a few seconds' : 'Draft saved (not yet live)');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const discard = useMutation({
    mutationFn: async () => (await api.post(`/api/cms/blocks/${blockKey}/discard`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms-block', blockKey] });
      qc.invalidateQueries({ queryKey: ['cms-blocks'] });
      toast('Unpublished changes discarded', 'info');
    },
  });

  if (isLoading || !form) return <Loading />;
  const def: ContentBlockDef = data.def;
  const isLive = !!data.publishedAt;
  const unpublished = isLive && JSON.stringify(data.draft) !== JSON.stringify(data.published);
  const set = (name: string, v: unknown) => {
    setForm((f) => ({ ...(f ?? {}), [name]: v }));
    setDirty(true);
  };

  return (
    <Card className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{def.label}</h2>
          <p className="text-xs text-slate-500">
            {isLive ? `Live since ${fmtDateTime(data.publishedAt)}` : 'Not customised yet — the website shows its original text (pre-filled below).'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty ? <Badge tone="amber">Unsaved changes</Badge> : unpublished ? <Badge tone="amber">Draft differs from live</Badge> : isLive ? <Badge tone="green">Live</Badge> : null}
        </div>
      </div>

      {def.key.startsWith('legal.') && (
        <Callout tone={isLive ? 'blue' : 'amber'} title={isLive ? 'Published policy' : 'Suggested draft — not on the website yet'}>
          {isLive
            ? 'This is your published policy. Update the "Last updated" date whenever you change it.'
            : 'Read it carefully and change anything that does not match how the studio works (ideally with a professional). Once published it becomes your policy, and the page is linked from the website footer. Razorpay checks for these pages during KYC.'}
        </Callout>
      )}

      <div className="space-y-4">
        {def.fields.map((f) => (
          <FieldEditor key={f.name} field={f} value={form[f.name]} onChange={(v) => set(f.name, v)} />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
        {unpublished && !dirty && (
          <Button
            variant="subtle"
            onClick={async () => (await confirm({ title: 'Discard draft?', body: 'Go back to what is live on the website now.', danger: true, confirmLabel: 'Discard' })) && discard.mutate()}
          >
            Discard draft
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={save.isPending}
          onClick={async () => {
            if (dirty) await save.mutateAsync(false);
            preview(def.page);
          }}
        >
          Preview
        </Button>
        <Button variant="ghost" disabled={save.isPending || !dirty} onClick={() => save.mutate(false)}>
          Save draft
        </Button>
        <Button disabled={save.isPending || (!dirty && !unpublished && isLive)} onClick={() => save.mutate(true)}>
          {save.isPending ? 'Saving…' : 'Publish'}
        </Button>
      </div>
    </Card>
  );
}

function FieldEditor({ field, value, onChange }: { field: ContentField; value: unknown; onChange: (v: unknown) => void }) {
  const str = typeof value === 'string' ? value : '';
  const count = field.max ? `${str.length}/${field.max}` : undefined;
  switch (field.type) {
    case 'image':
      return (
        <div>
          <MediaPicker value={str} onChange={onChange} label={field.label} />
          {field.help && <p className="mt-1 text-xs text-slate-400">{field.help}</p>}
        </div>
      );
    case 'textarea':
      return (
        <Field label={field.label} hint={field.help ?? count}>
          <Textarea value={str} maxLength={field.max} rows={(field.max ?? 0) > 1000 ? 8 : 3} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
    case 'lines': {
      const lines = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field label={field.label} hint={field.help}>
          <Textarea value={lines.join('\n')} rows={Math.max(3, lines.length + 1)} onChange={(e) => onChange(e.target.value.split('\n'))} />
        </Field>
      );
    }
    case 'choice':
      return (
        <Field label={field.label} hint={field.help}>
          <Select value={str || field.options?.[0]?.value} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'list':
      return <ListEditor field={field} value={Array.isArray(value) ? (value as Data[]) : []} onChange={onChange} />;
    case 'href':
      return (
        <Field label={field.label} hint={field.help ?? 'A page such as /contact, or a full https:// link'}>
          <Input value={str} onChange={(e) => onChange(e.target.value)} placeholder="/contact" />
        </Field>
      );
    default:
      return (
        <Field label={`${field.label}${field.required ? ' *' : ''}`} hint={field.help ?? count}>
          <Input value={str} maxLength={field.max} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );
  }
}

function ListEditor({ field, value, onChange }: { field: ContentField; value: Data[]; onChange: (v: Data[]) => void }) {
  const move = (i: number, d: number) => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item);
    onChange(next);
  };
  const blank = () => Object.fromEntries((field.fields ?? []).map((f) => [f.name, f.type === 'lines' ? [] : '']));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{field.label}</span>
        <span className="text-xs text-slate-400">
          {value.length}/{field.maxItems ?? '∞'}
        </span>
      </div>
      {!value.length && <Callout tone="blue">No items — this part of the page is hidden until you add one.</Callout>}
      {value.map((item, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">#{i + 1}</span>
            <div className="flex gap-1">
              <Button variant="subtle" className="!px-2 !py-1" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </Button>
              <Button variant="subtle" className="!px-2 !py-1" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </Button>
              <Button variant="subtle" className="!px-2 !py-1 !text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">
                Remove
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(field.fields ?? []).map((f) => (
              <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                <FieldEditor field={f} value={item[f.name]} onChange={(v) => onChange(value.map((it, j) => (j === i ? { ...it, [f.name]: v } : it)))} />
              </div>
            ))}
          </div>
        </div>
      ))}
      {(!field.maxItems || value.length < field.maxItems) && (
        <Button variant="ghost" onClick={() => onChange([...value, blank()])}>
          + Add {field.label.toLowerCase().replace(/s$/, '')}
        </Button>
      )}
    </div>
  );
}
