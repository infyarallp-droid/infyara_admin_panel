import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { Badge, Button, useFeedback } from '../../components/ui';

export type PublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export function StatusBadge({ status }: { status: PublishStatus }) {
  return status === 'PUBLISHED' ? <Badge tone="green">Published</Badge> : status === 'DRAFT' ? <Badge tone="amber">Draft</Badge> : <Badge>Archived</Badge>;
}

/** Opens the real website with unpublished drafts visible (short-lived signed link). */
export function usePreview() {
  const { toast } = useFeedback();
  return async (path: string) => {
    const tab = window.open('', '_blank');
    try {
      const { data } = await api.get(`/api/cms/preview?path=${encodeURIComponent(path)}`);
      if (tab) tab.location.href = data.url;
      else window.location.assign(data.url);
    } catch (e) {
      tab?.close();
      toast(await apiError(e, 'Preview is not available'), 'error');
    }
  };
}

/** Status change, delete and reorder for one CMS collection. */
export function useCollectionActions(collection: string) {
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const refresh = () => qc.invalidateQueries({ queryKey: ['cms', collection] });
  const onError = async (e: unknown) => toast(await apiError(e), 'error');

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: PublishStatus }) => (await api.patch(`/api/cms/${collection}/${id}/status`, { status })).data,
    onSuccess: (_r, v) => {
      refresh();
      toast(v.status === 'PUBLISHED' ? 'Published' : v.status === 'ARCHIVED' ? 'Archived' : 'Moved to drafts');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/api/cms/${collection}/${id}`)).data,
    onSuccess: () => {
      refresh();
      toast('Deleted');
    },
    onError,
  });
  const reorder = useMutation({
    mutationFn: async (ids: string[]) => (await api.post(`/api/cms/${collection}/reorder`, { ids })).data,
    onSuccess: refresh,
    onError,
  });

  return {
    setStatus: (id: string, status: PublishStatus) => setStatus.mutate({ id, status }),
    remove: async (id: string, what: string) => {
      if (await confirm({ title: `Delete ${what}?`, body: 'This cannot be undone. To hide it but keep it, archive it instead.', danger: true, confirmLabel: 'Delete' })) {
        remove.mutate(id);
      }
    },
    move: (ids: string[], index: number, delta: number) => {
      const next = [...ids];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      reorder.mutate(next);
    },
    busy: setStatus.isPending || remove.isPending || reorder.isPending,
  };
}

export function RowActions({
  status,
  index,
  count,
  onMove,
  onStatus,
  onEdit,
  onDelete,
}: {
  status: PublishStatus;
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onStatus: (s: PublishStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button variant="subtle" className="!px-2 !py-1" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
        ↑
      </Button>
      <Button variant="subtle" className="!px-2 !py-1" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
        ↓
      </Button>
      {status === 'PUBLISHED' ? (
        <Button variant="subtle" className="!py-1" onClick={() => onStatus('DRAFT')}>
          Unpublish
        </Button>
      ) : (
        <Button variant="subtle" className="!py-1" onClick={() => onStatus('PUBLISHED')}>
          Publish
        </Button>
      )}
      <Button variant="subtle" className="!py-1" onClick={onEdit}>
        Edit
      </Button>
      {status !== 'ARCHIVED' ? (
        <Button variant="subtle" className="!py-1 !text-slate-500" onClick={() => onStatus('ARCHIVED')}>
          Archive
        </Button>
      ) : (
        <Button variant="subtle" className="!py-1 !text-red-600" onClick={onDelete}>
          Delete
        </Button>
      )}
    </div>
  );
}
