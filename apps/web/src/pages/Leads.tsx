import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const SOURCE_TONE: Record<string, 'green' | 'amber' | 'slate' | 'red'> = {
  WHATSAPP: 'green',
  WEBSITE: 'amber',
  GOOGLE_FORM: 'slate',
  LINKEDIN: 'slate',
};
const STATUSES = ['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'LOST'];

export default function Leads() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', status, search],
    queryFn: async () =>
      (await api.get('/api/leads', { params: { status: status || undefined, search: search || undefined } })).data,
    refetchInterval: 30_000, // inbox auto-refreshes
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-slate-500">Every channel — WhatsApp, Website, Google Form, LinkedIn — in one inbox.</p>
        </div>
        <div className="flex gap-2">
          <Input placeholder="Search name/phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : data?.leads?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Phone</th>
                <th className="py-2 font-medium">Message</th>
                <th className="py-2 font-medium">Received</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.leads.map((l: any) => (
                <tr key={l.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setOpenId(l.id)}>
                  <td className="py-3"><Badge tone={SOURCE_TONE[l.source] ?? 'slate'}>{l.source}</Badge></td>
                  <td className="py-3 font-medium">{l.name ?? '—'}</td>
                  <td className="py-3">{l.phone ?? '—'}</td>
                  <td className="py-3 max-w-[220px] truncate text-slate-500">{l.message ?? '—'}</td>
                  <td className="py-3 text-slate-400">{new Date(l.receivedAt).toLocaleDateString()}</td>
                  <td className="py-3"><Badge tone={l.status === 'CONVERTED' ? 'green' : l.status === 'LOST' ? 'red' : 'slate'}>{l.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-10 text-center text-slate-400">No leads yet. They arrive from WhatsApp, the website form, Google Forms and Zapier.</p>
        )}
      </Card>

      {openId && <LeadDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function LeadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const { data, refetch } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => (await api.get(`/api/leads/${id}`)).data,
  });
  const lead = data?.lead;

  const refreshAll = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ['leads'] });
  };

  const setStatus = useMutation({
    mutationFn: async (status: string) => (await api.put(`/api/leads/${id}`, { status })).data,
    onSuccess: refreshAll,
  });
  const addNote = useMutation({
    mutationFn: async () => (await api.post(`/api/leads/${id}/activities`, { type: 'NOTE', content: note })).data,
    onSuccess: () => {
      setNote('');
      refetch();
    },
  });
  const convert = useMutation({
    mutationFn: async () => (await api.post(`/api/leads/${id}/convert`, {})).data,
    onSuccess: (res) => navigate(`/students/${res.student.id}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {!lead ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Badge tone="slate">{lead.source}</Badge>
              <h2 className="text-lg font-bold">{lead.name ?? 'Unknown lead'}</h2>
            </div>
            <div className="space-y-1 text-sm text-slate-600">
              <div>📞 {lead.phone ?? '—'}</div>
              <div>✉️ {lead.email ?? '—'}</div>
              {lead.message && <div className="rounded-xl bg-slate-50 p-3">{lead.message}</div>}
            </div>

            <div className="mt-4">
              <Field label="Status">
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={lead.status}
                  onChange={(e) => setStatus.mutate(e.target.value)}
                >
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            {!lead.convertedStudentId ? (
              <Button className="mt-4 w-full" onClick={() => convert.mutate()} disabled={convert.isPending}>
                {convert.isPending ? 'Converting…' : 'Convert to Student'}
              </Button>
            ) : (
              <p className="mt-4 text-sm text-green-700">✓ Converted to a student.</p>
            )}

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">Activity</h3>
              <div className="mb-2 flex gap-2">
                <Input placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button variant="ghost" onClick={() => note && addNote.mutate()}>Add</Button>
              </div>
              <ul className="space-y-2 text-sm">
                {lead.activities?.map((a: any) => (
                  <li key={a.id} className="border-b border-slate-50 pb-2">
                    <span className="text-xs text-slate-400">{a.type} · {new Date(a.createdAt).toLocaleString()}</span>
                    <div>{a.content}</div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
