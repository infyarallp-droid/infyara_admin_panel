import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Spinner } from '../components/ui';

export default function EmployeeDetail() {
  const { id } = useParams();
  const [reveal, setReveal] = useState(false);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['employee', id, reveal],
    queryFn: async () => (await api.get(`/api/employees/${id}`, { params: reveal ? { reveal: 'true' } : {} })).data,
  });
  const [msg, setMsg] = useState('');

  const uploadDoc = async (file: File, docType: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    await api.post(`/api/employees/${id}/documents`, fd);
    setMsg('Document uploaded.');
    refetch();
  };

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const e = data?.employee;
  if (!e) return <p>Employee not found.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/employees" className="text-sm text-brand hover:underline">← Employees</Link>
        <h1 className="text-2xl font-bold">{e.fullName}</h1>
        <p className="text-sm text-slate-500">{e.roleTitle ?? '—'} · {e.phone}</p>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Details</h3>
          {data.canReveal && (
            <Button variant="ghost" onClick={() => setReveal((r) => !r)}>
              {reveal ? 'Hide PII' : 'Reveal Aadhaar/PAN'}
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Row label="Email" value={e.email} />
          <Row label="Date of joining" value={e.dateOfJoining?.slice(0, 10)} />
          <Row label="Aadhaar" value={e.aadhaarNo} mono />
          <Row label="PAN" value={e.panNo} mono />
          <Row label="Salary" value={e.salaryPaise ? `₹${(Number(e.salaryPaise) / 100).toLocaleString('en-IN')}/mo` : '—'} />
          <Row label="Address" value={e.address} />
        </dl>
      </Card>

      <Card>
        <h3 className="mb-2 font-semibold">Documents</h3>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          {['AADHAAR', 'PAN', 'PHOTO', 'CERTIFICATE', 'OTHER'].map((t) => (
            <label key={t} className="cursor-pointer text-brand hover:underline">
              + {t}
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf"
                onChange={(ev) => ev.target.files?.[0] && uploadDoc(ev.target.files[0], t)}
              />
            </label>
          ))}
        </div>
        {e.documents?.length ? (
          <ul className="space-y-1 text-sm">
            {e.documents.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2">
                <Badge tone="slate">{d.docType}</Badge>
                <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  {d.fileUrl.split('/').pop()}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No documents uploaded.</p>
        )}
        {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
      </Card>

      {!!e.timings?.length && (
        <Card>
          <h3 className="mb-2 font-semibold">Assigned class timings</h3>
          <ul className="text-sm">
            {e.timings.map((t: any) => <li key={t.id}>{t.label}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className={`font-medium ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
    </div>
  );
}
