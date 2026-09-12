import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Card, Field, Input, Spinner } from '../components/ui';

const empty = {
  fullName: '',
  phone: '',
  email: '',
  roleTitle: '',
  aadhaarNo: '',
  panNo: '',
  dateOfJoining: '',
  address: '',
  salaryRupees: '',
};

export default function Employees() {
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/api/employees')).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees</h1>
          <p className="text-sm text-slate-500">HR records. Aadhaar/PAN are encrypted and masked by default.</p>
        </div>
        <Button onClick={() => setDrawer(true)}>+ New Employee</Button>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : data?.employees?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Phone</th>
                <th className="py-2 font-medium">Aadhaar</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e: any) => (
                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 font-medium">{e.fullName}</td>
                  <td className="py-3 text-slate-500">{e.roleTitle ?? '—'}</td>
                  <td className="py-3">{e.phone}</td>
                  <td className="py-3 font-mono text-xs">{e.aadhaarNo ?? '—'}</td>
                  <td className="py-3 text-right">
                    <Link to={`/employees/${e.id}`} className="text-brand hover:underline">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-10 text-center text-slate-400">No employees yet.</p>
        )}
      </Card>

      {drawer && (
        <Drawer
          onClose={() => setDrawer(false)}
          onSaved={() => {
            setDrawer(false);
            qc.invalidateQueries({ queryKey: ['employees'] });
          }}
        />
      )}
    </div>
  );
}

function Drawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const set = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/api/employees', {
          ...form,
          salaryRupees: form.salaryRupees ? Number(form.salaryRupees) : undefined,
        })
      ).data,
    onSuccess: onSaved,
    onError: (e: any) => setError(e.response?.data?.error ?? 'Failed to save'),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold">New Employee</h2>
        <div className="space-y-3">
          <Field label="Full name"><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Role / title"><Input value={form.roleTitle} onChange={(e) => set('roleTitle', e.target.value)} /></Field>
          </div>
          <Field label="Email"><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Aadhaar" hint="encrypted at rest"><Input value={form.aadhaarNo} onChange={(e) => set('aadhaarNo', e.target.value)} /></Field>
            <Field label="PAN" hint="encrypted at rest"><Input value={form.panNo} onChange={(e) => set('panNo', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of joining"><Input type="date" value={form.dateOfJoining} onChange={(e) => set('dateOfJoining', e.target.value)} /></Field>
            <Field label="Salary (₹/mo)"><Input value={form.salaryRupees} onChange={(e) => set('salaryRupees', e.target.value)} /></Field>
          </div>
          <Field label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={() => form.fullName && form.phone && save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save employee'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
