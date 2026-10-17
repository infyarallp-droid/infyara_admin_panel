import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError, uploadMedia, type MediaAsset } from '../lib/api';
import { Button, EmptyState, Loading, Modal, useFeedback } from './ui';

/**
 * A media field: shows the current image/video, and lets the admin upload a new
 * file or pick one already in the library. Value is the file's public URL.
 */
export default function MediaPicker({
  value,
  onChange,
  kind = 'IMAGE',
  label = kind === 'IMAGE' ? 'Image' : 'Video',
}: {
  value: string | null | undefined;
  onChange: (url: string) => void;
  kind?: 'IMAGE' | 'VIDEO';
  label?: string;
}) {
  const [library, setLibrary] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { toast } = useFeedback();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProgress(0);
    try {
      const asset = await uploadMedia(file, undefined, setProgress);
      if (asset.kind !== kind) {
        toast(`That file is ${asset.kind === 'IMAGE' ? 'an image' : 'a video'} — choose ${kind === 'IMAGE' ? 'an image' : 'a video'}.`, 'error');
      } else {
        onChange(asset.url);
        toast('Uploaded');
      }
      qc.invalidateQueries({ queryKey: ['media'] });
    } catch (e) {
      toast(await apiError(e, 'Upload failed'), 'error');
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-24 w-32 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
          {value ? (
            kind === 'IMAGE' ? (
              <img src={value} alt="" className="h-full w-full object-cover" />
            ) : (
              <video src={value} className="h-full w-full object-cover" muted preload="metadata" />
            )
          ) : (
            <span className="text-xs text-slate-400">None</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            className="hidden"
            accept={kind === 'IMAGE' ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : 'video/mp4,video/webm,video/quicktime'}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button variant="ghost" onClick={() => input.current?.click()} disabled={progress != null}>
            {progress != null ? `Uploading ${progress}%` : 'Upload'}
          </Button>
          <Button variant="ghost" onClick={() => setLibrary(true)}>
            From library
          </Button>
          {value && (
            <Button variant="subtle" onClick={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {library && (
        <MediaLibraryDialog
          kind={kind}
          onClose={() => setLibrary(false)}
          onPick={(a) => {
            onChange(a.url);
            setLibrary(false);
          }}
        />
      )}
    </div>
  );
}

export function MediaLibraryDialog({ kind, onClose, onPick }: { kind: 'IMAGE' | 'VIDEO'; onClose: () => void; onPick: (a: MediaAsset) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['media', kind], queryFn: async () => (await api.get(`/api/cms/media?kind=${kind}&take=120`)).data });
  return (
    <Modal title={kind === 'IMAGE' ? 'Choose an image' : 'Choose a video'} onClose={onClose} wide>
      {isLoading ? (
        <Loading />
      ) : !data?.media?.length ? (
        <EmptyState title="The library is empty">Upload a file first.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.media.map((m: MediaAsset) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              className="group overflow-hidden rounded-xl border border-slate-200 text-left hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <div className="aspect-[4/3] bg-slate-100">
                {m.kind === 'IMAGE' ? (
                  <img src={m.url} alt={m.alt ?? ''} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="truncate px-2 py-1 text-xs text-slate-500">{m.originalName ?? m.mimeType}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
