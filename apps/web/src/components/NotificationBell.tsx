import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/** Bell that polls unread notifications every ~30s (no websocket needed). */
export default function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/api/notifications')).data,
    refetchInterval: 30_000,
  });
  const unread = data?.unread ?? 0;

  const markAll = useMutation({
    mutationFn: async () => (await api.post('/api/notifications/read-all')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2 hover:bg-slate-100">
        <span className="text-xl">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-xs text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 space-y-1 overflow-auto">
            {data?.items?.length ? (
              data.items.map((n: any) => (
                <li key={n.id} className={`rounded-xl p-2 text-sm ${n.isRead ? 'bg-white' : 'bg-brand/5'}`}>
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-xs text-slate-500">{n.body}</div>}
                  <div className="text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
                </li>
              ))
            ) : (
              <li className="p-3 text-center text-sm text-slate-400">No notifications.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
