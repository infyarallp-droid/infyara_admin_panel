import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

interface Student {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  status: string;
  isMinor: boolean;
}

const empty = {
  fullName: '',
  mobile: '',
  email: '',
  dob: '',
  gender: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
  isMinor: false,
};

export default function Students() {
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['students', search],
    queryFn: async () => (await api.get('/api/students', { params: { search } })).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Students</h1>
          <p className="text-sm text-slate-500">Manage student records, enrollments and consent forms.</p>
        </div>
        <Button onClick={() => setDrawer(true)}>+ New Student</Button>
      </div>

      <Card>
        <Input
          placeholder="Search by name or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-sm"
        />
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : data?.items?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Mobile</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data.items as Student[]).map((s) => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 font-medium">
                    {s.fullName} {s.isMinor && <Badge tone="amber">Minor</Badge>}
                  </td>
                  <td className="py-3">{s.mobile}</td>
                  <td className="py-3 text-slate-500">{s.email ?? '—'}</td>
                  <td className="py-3">
                    <Badge tone={s.status === 'ACTIVE' ? 'green' : 'slate'}>{s.status}</Badge>
                  </td>
                  <td className="py-3 text-right">
                    <Link to={`/students/${s.id}`} className="text-brand hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-10 text-center text-slate-400">No students yet. Add your first one.</p>
        )}
      </Card>

      {drawer && (
        <StudentDrawer
          onClose={() => setDrawer(false)}
          onSaved={() => {
            setDrawer(false);
            qc.invalidateQueries({ queryKey: ['students'] });
          }}
        />
      )}
    </div>
  );
}

function StudentDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => (await api.post('/api/students', form)).data,
    onSuccess: onSaved,
    onError: (e: any) => setError(e.response?.data?.error ?? 'Failed to save'),
  });

  const set = (k: keyof typeof empty, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">New Student</h2>
        <div className="space-y-3">
          <Field label="Full name">
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <Field label="Mobile" hint="10-digit number">
            <Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth">
              <Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} />
            </Field>
            <Field label="Gender">
              <Input value={form.gender} onChange={(e) => set('gender', e.target.value)} />
            </Field>
          </div>
          <Field label="Address">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emergency contact">
              <Input
                value={form.emergencyContactName}
                onChange={(e) => set('emergencyContactName', e.target.value)}
              />
            </Field>
            <Field label="Relationship">
              <Input
                value={form.emergencyContactRelation}
                onChange={(e) => set('emergencyContactRelation', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Emergency phone">
            <Input
              value={form.emergencyContactPhone}
              onChange={(e) => set('emergencyContactPhone', e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isMinor} onChange={(e) => set('isMinor', e.target.checked)} />
            Student is a minor (guardian signature required)
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="flex-1">
            {save.isPending ? 'Saving…' : 'Save student'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
