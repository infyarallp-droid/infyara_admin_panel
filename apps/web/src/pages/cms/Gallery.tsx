import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadMedia, type MediaAsset } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { MediaLibraryDialog } from '../../components/MediaPicker';
import { Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Tabs, useFeedback } from '../../components/ui';
import { RowActions, StatusBadge, useCollectionActions, usePreview, type PublishStatus } from './shared';

interface GalleryItem {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
  posterUrl: string | null;
  caption: string | null;
  alt: string | null;
  album: string | null;
  status: PublishStatus;
}

export default function Gallery() {
  const [tab, setTab] = useState<'gallery' | 'library'>('gallery');
  return (
    <div className="space-y-6">
      <PageHeader title="Gallery & Media" subtitle="Photos and videos for the website's Gallery page, and the library of every uploaded file." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'gallery', label: 'Gallery page' },
          { value: 'library', label: 'Media library' },
        ]}
      />
      {tab === 'gallery' ? <GalleryList /> : <Library />}
    </div>
  );
}

function GalleryList() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const preview = usePreview();
  const [picking, setPicking] = useState<'IMAGE' | 'VIDEO' | null>(null);
  const [editing, setEditing] = useState<GalleryItem | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['cms', 'gallery'], queryFn: async () => (await api.get('/api/cms/gallery?includeArchived=true')).data });
  const actions = useCollectionActions('gallery');
  const items: GalleryItem[] = data?.items ?? [];

  const add = async (asset: MediaAsset) => {
    try {
      await api.post('/api/cms/gallery', { kind: asset.kind, url: asset.url, alt: asset.alt ?? '', status: 'PUBLISHED' });
      qc.invalidateQueries({ queryKey: ['cms', 'gallery'] });
    } catch (e) {
      toast(await apiError(e), 'error');
    }
  };
  const uploadMany = async (files: FileList | null) => {
    if (!files?.length) return;
    let done = 0;
    for (const file of Array.from(files)) {
      setUploading(`${done + 1} of ${files.length}`);
      try {
        await add(await uploadMedia(file));
        done++;
      } catch (e) {
        toast(`${file.name}: ${await apiError(e, 'upload failed')}`, 'error');
      }
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = '';
    if (done) toast(`${done} added to the gallery`);
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input ref={fileInput} type="file" multiple className="hidden" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" onChange={(e) => uploadMany(e.target.files)} />
        <Button onClick={() => fileInput.current?.click()} disabled={!!uploading}>
          {uploading ? `Uploading ${uploading}…` : 'Upload photos/videos'}
        </Button>
        <Button variant="ghost" onClick={() => setPicking('IMAGE')}>
          Add from library
        </Button>
        <Button variant="ghost" onClick={() => preview('/gallery')}>
          Preview gallery
        </Button>
      </div>
      {isLoading ? (
        <Loading />
      ) : !items.length ? (
        <EmptyState title="The gallery is empty">The Gallery page and its menu link appear on the website once something is published here.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((g, i) => (
            <li key={g.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {g.kind === 'IMAGE' ? <img src={g.url} alt={g.alt ?? ''} loading="lazy" className="h-full w-full object-cover" /> : <video src={g.url} muted preload="metadata" className="h-full w-full object-cover" />}
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {g.caption || <span className="text-slate-400">No caption</span>} <StatusBadge status={g.status} />
                  </div>
                  <div className="text-xs text-slate-400">{g.album ? `Album: ${g.album}` : g.kind === 'VIDEO' ? 'Video' : 'Photo'}</div>
                </div>
              </div>
              <RowActions
                status={g.status}
                index={i}
                count={items.length}
                onMove={(d) => actions.move(items.map((x) => x.id), i, d)}
                onStatus={(s) => actions.setStatus(g.id, s)}
                onEdit={() => setEditing(g)}
                onDelete={() => actions.remove(g.id, 'this gallery item')}
              />
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <MediaLibraryDialog
          kind={picking}
          onClose={() => setPicking(null)}
          onPick={(a) => {
            setPicking(null);
            add(a);
          }}
        />
      )}
      {editing && <GalleryItemForm item={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function GalleryItemForm({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ caption: item.caption ?? '', alt: item.alt ?? '', album: item.album ?? '', status: item.status });
  const save = useMutation({
    mutationFn: async () => (await api.put(`/api/cms/gallery/${item.id}`, { ...form, kind: item.kind, url: item.url, posterUrl: item.posterUrl })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'gallery'] });
      toast('Saved');
      onClose();
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  return (
    <Modal
      title="Edit gallery item"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Caption">
          <Input value={form.caption} maxLength={200} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
        </Field>
        <Field label="Description for screen readers" hint="What is in the picture, e.g. 'Students in tree pose in the studio'.">
          <Input value={form.alt} maxLength={200} onChange={(e) => setForm({ ...form, alt: e.target.value })} />
        </Field>
        <Field label="Album (optional)">
          <Input value={form.album} maxLength={60} onChange={(e) => setForm({ ...form, album: e.target.value })} placeholder="Studio, Workshops, Retreats…" />
        </Field>
        <Field label="Visibility">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
            <option value="PUBLISHED">Published</option>
            <option value="DRAFT">Draft</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function Library() {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [kind, setKind] = useState<'' | 'IMAGE' | 'VIDEO'>('');
  const { data, isLoading } = useQuery({ queryKey: ['media', kind || 'all'], queryFn: async () => (await api.get(`/api/cms/media?take=200${kind ? `&kind=${kind}` : ''}`)).data });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/cms/media/${id}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] });
      toast('File deleted');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="!w-auto">
          <option value="">All files</option>
          <option value="IMAGE">Images</option>
          <option value="VIDEO">Videos</option>
        </Select>
        {data?.limits && (
          <span className="text-xs text-slate-400">
            Limits: images {data.limits.imageMb} MB, videos {data.limits.videoMb} MB. JPG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV.
          </span>
        )}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.media?.length ? (
        <EmptyState title="No files uploaded yet" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.media.map((m: MediaAsset) => (
            <div key={m.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="aspect-[4/3] bg-slate-100">
                {m.kind === 'IMAGE' ? <img src={m.url} alt={m.alt ?? ''} loading="lazy" className="h-full w-full object-cover" /> : <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" />}
              </div>
              <div className="space-y-1 p-2 text-xs">
                <div className="truncate font-medium text-slate-700" title={m.originalName ?? ''}>
                  {m.originalName ?? m.mimeType}
                </div>
                <div className="text-slate-400">
                  {kb(m.sizeBytes)} · {fmtDateTime(m.createdAt)}
                </div>
                <div className="flex gap-2">
                  <button className="text-brand hover:underline" onClick={() => navigator.clipboard.writeText(m.url).then(() => toast('Link copied', 'info'))}>
                    Copy link
                  </button>
                  <button
                    className="text-red-600 hover:underline"
                    onClick={async () => (await confirm({ title: 'Delete this file?', body: 'Files still used on the website cannot be deleted.', danger: true, confirmLabel: 'Delete' })) && remove.mutate(m.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
