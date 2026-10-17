import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadMedia } from '../../lib/api';
import MediaPicker, { MediaLibraryDialog } from '../../components/MediaPicker';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useFeedback } from '../../components/ui';
import { StatusBadge, useCollectionActions, usePreview, type PublishStatus } from './shared';

interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  coverImageUrl: string | null;
  coverAlt: string | null;
  authorName: string | null;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  isFeatured: boolean;
  publishedAt: string | null;
  status: PublishStatus;
}

const dateLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

export default function Blog() {
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['cms', 'blog', showArchived],
    queryFn: async () => (await api.get(`/api/cms/blog${showArchived ? '?includeArchived=true' : ''}`)).data,
  });
  const actions = useCollectionActions('blog');
  const preview = usePreview();
  const items: Post[] = data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blog"
        subtitle="Articles shown on the website's Blog page, newest first. Drafts stay hidden until you publish them; “Blog” appears in the website menu once an article is published."
        actions={
          <>
            <Button variant="ghost" onClick={() => preview('/blog')}>
              Preview blog page
            </Button>
            <Button onClick={() => setEditing('new')}>+ Write an article</Button>
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
          <EmptyState title="No articles yet" action={<Button onClick={() => setEditing('new')}>Write the first one</Button>}>
            Share class tips, wellbeing advice, studio news and student journeys.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((p) => {
              const scheduled = p.status === 'PUBLISHED' && p.publishedAt && new Date(p.publishedAt) > new Date();
              return (
                <li key={p.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="truncate">{p.title}</span> <StatusBadge status={p.status} />
                        {scheduled && <Badge tone="blue">Scheduled</Badge>}
                        {p.isFeatured && <Badge tone="blue">Featured</Badge>}
                      </div>
                      <div className="truncate text-sm text-slate-500">
                        {[dateLabel(p.publishedAt), p.authorName, `/blog/${p.slug}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <Button variant="subtle" className="!py-1" onClick={() => preview(`/blog/${p.slug}`)}>
                      Preview
                    </Button>
                    {p.status === 'PUBLISHED' ? (
                      <Button variant="subtle" className="!py-1" onClick={() => actions.setStatus(p.id, 'DRAFT')}>
                        Unpublish
                      </Button>
                    ) : (
                      <Button variant="subtle" className="!py-1" onClick={() => actions.setStatus(p.id, 'PUBLISHED')}>
                        Publish
                      </Button>
                    )}
                    <Button variant="subtle" className="!py-1" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    {p.status !== 'ARCHIVED' ? (
                      <Button variant="subtle" className="!py-1 !text-slate-500" onClick={() => actions.setStatus(p.id, 'ARCHIVED')}>
                        Archive
                      </Button>
                    ) : (
                      <Button variant="subtle" className="!py-1 !text-red-600" onClick={() => actions.remove(p.id, `“${p.title}”`)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <PostForm post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const toDateInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : '');

function PostForm({ post, onClose }: { post: Post | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const preview = usePreview();
  const [form, setForm] = useState({
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    body: post?.body ?? '',
    coverImageUrl: post?.coverImageUrl ?? '',
    coverAlt: post?.coverAlt ?? '',
    authorName: post?.authorName ?? '',
    tags: (post?.tags ?? []).join(', '),
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
    isFeatured: post?.isFeatured ?? false,
    publishedAt: toDateInput(post?.publishedAt ?? null),
    status: post?.status ?? ('DRAFT' as PublishStatus),
  });
  const [error, setError] = useState('');
  const team = useQuery({ queryKey: ['cms', 'team', false], queryFn: async () => (await api.get('/api/cms/team')).data });
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async (then: 'close' | 'preview') => {
      const body = {
        ...form,
        slug: form.slug || undefined,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        // Midday local time, so the date shows the same everywhere in India.
        publishedAt: form.publishedAt ? new Date(`${form.publishedAt}T12:00:00`).toISOString() : null,
      };
      const res = post ? (await api.put(`/api/cms/blog/${post.id}`, body)).data : (await api.post('/api/cms/blog', body)).data;
      return { item: res.item as Post, then };
    },
    onSuccess: ({ item, then }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'blog'] });
      toast(form.status === 'PUBLISHED' ? 'Saved and published' : 'Saved as draft');
      if (then === 'preview') preview(`/blog/${item.slug}`);
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });

  const ready = form.title.trim() && form.excerpt.trim().length >= 10 && form.body.trim().length >= 20;

  return (
    <Modal
      title={post ? 'Edit article' : 'Write an article'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" disabled={save.isPending || !ready} onClick={() => save.mutate('preview')}>
            Save &amp; preview
          </Button>
          <Button disabled={save.isPending || !ready} onClick={() => save.mutate('close')}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title *">
            <Input value={form.title} maxLength={160} onChange={(e) => set('title', e.target.value)} placeholder="5 gentle stretches for desk workers" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Summary *" hint={`${form.excerpt.length}/400 — shown on the blog list and in search results`}>
            <Textarea value={form.excerpt} maxLength={400} rows={2} onChange={(e) => set('excerpt', e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <MediaPicker value={form.coverImageUrl} onChange={(v) => set('coverImageUrl', v)} label="Cover image" />
          <p className="mt-1 text-xs text-slate-400">A landscape photo, at least 1200px wide.</p>
        </div>
        {form.coverImageUrl && (
          <div className="sm:col-span-2">
            <Field label="Cover image description" hint="Describes the photo for visually impaired visitors and search engines.">
              <Input value={form.coverAlt} maxLength={200} onChange={(e) => set('coverAlt', e.target.value)} />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <BodyEditor value={form.body} onChange={(v) => set('body', v)} />
        </div>
        <Field label="Author">
          <Input value={form.authorName} maxLength={80} list="blog-authors" onChange={(e) => set('authorName', e.target.value)} placeholder="Teacher's name" />
          <datalist id="blog-authors">
            {team.data?.items?.map((m: { id: string; name: string }) => <option key={m.id} value={m.name} />)}
          </datalist>
        </Field>
        <Field label="Tags" hint="Separate with commas, e.g. Yoga, Beginners, Breathing">
          <Input value={form.tags} maxLength={300} onChange={(e) => set('tags', e.target.value)} />
        </Field>
        <Field label="Article date" hint="Leave empty to use the day it is first published. A future date schedules it.">
          <Input type="date" value={form.publishedAt} onChange={(e) => set('publishedAt', e.target.value)} />
        </Field>
        <Field label="Visibility">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="DRAFT">Draft (hidden)</option>
            <option value="PUBLISHED">Published (visible on the website)</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={form.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /> Feature this article at the top of the blog
        </label>
        <details className="rounded-xl border border-slate-200 p-4 sm:col-span-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Web address &amp; search engines (optional)</summary>
          <div className="mt-4 grid gap-4">
            <Field label="Web address" hint={`Website link: /blog/${form.slug || '(made from the title)'}. Changing it breaks links people have already shared.`}>
              <Input value={form.slug} maxLength={80} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="made-from-the-title" />
            </Field>
            <Field label="Search title" hint={`${form.seoTitle.length}/70 — defaults to the title`}>
              <Input value={form.seoTitle} maxLength={70} onChange={(e) => set('seoTitle', e.target.value)} />
            </Field>
            <Field label="Search description" hint={`${form.seoDescription.length}/170 — defaults to the summary`}>
              <Textarea value={form.seoDescription} maxLength={170} rows={2} onChange={(e) => set('seoDescription', e.target.value)} />
            </Field>
          </div>
        </details>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

/** Article text with a small formatting toolbar. Stored as Markdown. */
function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const { toast } = useFeedback();

  /** Wrap the selection (or a placeholder) with before/after, or start each selected line with a prefix. */
  const apply = (before: string, after = '', placeholder = 'text', linePrefix = false) => {
    const el = area.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    let insert: string;
    if (linePrefix) {
      const atLineStart = start === 0 || value[start - 1] === '\n';
      insert = `${atLineStart ? '' : '\n'}${selected
        .split('\n')
        .map((l, i) => before.replace('1.', `${i + 1}.`) + l)
        .join('\n')}`;
    } else {
      insert = before + selected + after;
    }
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      const caret = start + insert.length;
      el?.setSelectionRange(caret, caret);
    });
  };
  const insertImage = (url: string) => apply(`\n![`, `](${url})\n`, 'Describe the photo');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(0);
    try {
      const asset = await uploadMedia(f, undefined, setUploading);
      if (asset.kind !== 'IMAGE') toast('Choose an image file', 'error');
      else insertImage(asset.url);
    } catch (e) {
      toast(await apiError(e, 'Upload failed'), 'error');
    } finally {
      setUploading(null);
      if (file.current) file.current.value = '';
    }
  };

  const tools: { label: string; title: string; run: () => void }[] = [
    { label: 'H2', title: 'Section heading', run: () => apply('## ', '', 'Heading', true) },
    { label: 'H3', title: 'Sub-heading', run: () => apply('### ', '', 'Sub-heading', true) },
    { label: 'B', title: 'Bold', run: () => apply('**', '**', 'bold text') },
    { label: 'I', title: 'Italic', run: () => apply('*', '*', 'italic text') },
    { label: 'Link', title: 'Link', run: () => apply('[', '](https://)', 'link text') },
    { label: '• List', title: 'Bulleted list', run: () => apply('- ', '', 'List item', true) },
    { label: '1. List', title: 'Numbered list', run: () => apply('1. ', '', 'List item', true) },
    { label: '❝ Quote', title: 'Quote', run: () => apply('> ', '', 'Quote', true) },
  ];

  return (
    <div className="space-y-1">
      <span className="text-sm font-medium text-slate-700">Article *</span>
      <div className="flex flex-wrap gap-1 rounded-t-xl border border-b-0 border-slate-200 bg-slate-50 p-1.5">
        {tools.map((t) => (
          <Button key={t.label} variant="subtle" className="!px-2.5 !py-1 text-xs" title={t.title} onClick={t.run}>
            {t.label}
          </Button>
        ))}
        <input ref={file} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="subtle" className="!px-2.5 !py-1 text-xs" disabled={uploading != null} onClick={() => file.current?.click()}>
          {uploading != null ? `Uploading ${uploading}%` : '+ Image'}
        </Button>
        <Button variant="subtle" className="!px-2.5 !py-1 text-xs" onClick={() => setLibrary(true)}>
          Image from library
        </Button>
      </div>
      <textarea
        ref={area}
        value={value}
        rows={16}
        maxLength={50_000}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-b-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20"
        placeholder={'Write your article here.\n\nLeave a blank line between paragraphs.\n\n## A section heading\n\n- a bulleted point\n- another point'}
      />
      <span className="block text-xs text-slate-400">
        Leave a blank line between paragraphs. Use the buttons for headings, bold text, lists, links and photos — “Save &amp; preview” shows exactly how it will look.
      </span>
      {library && (
        <MediaLibraryDialog
          kind="IMAGE"
          onClose={() => setLibrary(false)}
          onPick={(a) => {
            insertImage(a.url);
            setLibrary(false);
          }}
        />
      )}
    </div>
  );
}
