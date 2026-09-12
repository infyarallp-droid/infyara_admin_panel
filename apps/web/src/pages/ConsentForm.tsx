import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Spinner } from '../components/ui';
import SignaturePad from '../components/SignaturePad';

interface HealthOption {
  key: string;
  label: string;
}

export default function ConsentForm() {
  const { id } = useParams();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [healthOther, setHealthOther] = useState('');
  const [acks, setAcks] = useState({ safety: false, policies: false, conduct: false, final: false });
  const [studentSig, setStudentSig] = useState<string | null>(null);
  const [guardianSig, setGuardianSig] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const formQ = useQuery({
    queryKey: ['consent-form', id],
    queryFn: async () => (await api.get(`/api/consent/forms/${id}`)).data,
  });
  const tplQ = useQuery({
    queryKey: ['consent-template-active'],
    queryFn: async () => (await api.get('/api/consent/templates/active')).data,
  });

  const form = formQ.data?.form;
  const template = tplQ.data?.template;
  const finalized = form?.status === 'FINALIZED';

  useEffect(() => {
    if (form) {
      setFlags(form.healthFlags ?? {});
      setHealthOther(form.healthOther ?? '');
      setAcks({
        safety: form.consentSafetyAck,
        policies: form.studioPoliciesAck,
        conduct: form.codeOfConductAck,
        final: form.finalAck,
      });
    }
  }, [form]);

  const healthOptions: HealthOption[] = useMemo(
    () => template?.sections?.healthOptions ?? [],
    [template],
  );

  const savePayload = () => ({
    healthFlags: flags,
    healthOther,
    consentSafetyAck: acks.safety,
    studioPoliciesAck: acks.policies,
    codeOfConductAck: acks.conduct,
    finalAck: acks.final,
    studentSignatureDataUrl: studentSig ?? undefined,
    guardianSignatureDataUrl: guardianSig ?? undefined,
    studentSignedDate: studentSig ? new Date().toISOString().slice(0, 10) : undefined,
  });

  const saveDraft = async () => {
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/consent/forms/${id}`, savePayload());
      setMsg('Draft saved.');
      formQ.refetch();
    } catch (e: any) {
      setMsg(e.response?.data?.error ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/consent/forms/${id}`, savePayload());
      const res = await api.post(`/api/consent/forms/${id}/finalize`);
      setMsg('Finalized. Opening PDF…');
      window.open(res.data.pdfUrl, '_blank');
      formQ.refetch();
    } catch (e: any) {
      setMsg(e.response?.data?.error ?? 'Finalize failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadScan = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await api.post(`/api/consent/forms/${id}/uploads`, fd);
    setMsg('Signed scan uploaded.');
    formQ.refetch();
  };

  if (formQ.isLoading || tplQ.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!form) return <p>Consent form not found.</p>;

  const clauses = template?.sections?.clauses ?? { safety: [], policies: [], conduct: [], final: [] };

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/students/${form.studentId}`} className="text-sm text-brand hover:underline">
          ← Back to student
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Consent Form</h1>
          <Badge tone={finalized ? 'green' : 'amber'}>{form.status}</Badge>
        </div>
        <p className="text-sm text-slate-500">
          {form.student?.fullName} · {form.formDate?.slice(0, 10)}
        </p>
      </div>

      {/* Fee details */}
      {form.courseName && (
        <Card>
          <h3 className="mb-2 font-semibold">Course & Fee</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <span>{form.courseName} — {form.planTitle}</span>
            <span>Fee: ₹{(Number(form.feePaise) / 100).toLocaleString('en-IN')}</span>
            <span>Balance: ₹{(Number(form.balancePaise) / 100).toLocaleString('en-IN')}</span>
          </div>
        </Card>
      )}

      {/* Section 1 — health */}
      <Card>
        <h3 className="mb-3 font-semibold">1. Health & Medical Declaration</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {healthOptions.map((o) => (
            <label key={o.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={finalized}
                checked={!!flags[o.key]}
                onChange={(e) => setFlags((f) => ({ ...f, [o.key]: e.target.checked }))}
              />
              {o.label}
            </label>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          placeholder="Other conditions…"
          value={healthOther}
          disabled={finalized}
          onChange={(e) => setHealthOther(e.target.value)}
        />
      </Card>

      {/* Sections 2–5 acknowledgements */}
      {(
        [
          ['safety', '2. Consent, Safety & Personal Responsibility', clauses.safety],
          ['policies', '3. Studio Policies & Operational Consent', clauses.policies],
          ['conduct', '4. Student Code of Conduct', clauses.conduct],
          ['final', '5. Final Acknowledgement & Consent', clauses.final],
        ] as const
      ).map(([key, title, items]) => (
        <Card key={key}>
          <h3 className="mb-2 font-semibold">{title}</h3>
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {items.map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              disabled={finalized}
              checked={acks[key]}
              onChange={(e) => setAcks((a) => ({ ...a, [key]: e.target.checked }))}
            />
            I have read and agree to the above.
          </label>
        </Card>
      ))}

      {/* Signatures */}
      {!finalized && (
        <Card>
          <h3 className="mb-3 font-semibold">Signatures</h3>
          <div className="grid gap-6 md:grid-cols-2">
            <SignaturePad label="Student signature" onChange={setStudentSig} />
            {form.student?.isMinor && (
              <SignaturePad label="Parent/Guardian signature" onChange={setGuardianSig} />
            )}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {!finalized && (
          <>
            <Button variant="ghost" onClick={saveDraft} disabled={busy}>
              Save draft
            </Button>
            <Button onClick={finalize} disabled={busy}>
              {busy ? 'Working…' : 'Finalize & Download PDF'}
            </Button>
          </>
        )}
        {finalized && form.pdfUrl && (
          <a href={form.pdfUrl} target="_blank" rel="noreferrer">
            <Button>Download PDF</Button>
          </a>
        )}
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
      </div>

      {/* Signed-scan upload */}
      <Card>
        <h3 className="mb-2 font-semibold">Upload Signed Copy</h3>
        <p className="mb-3 text-sm text-slate-500">
          After the student signs the printed form, upload a photo/scan here for the record.
        </p>
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => e.target.files?.[0] && uploadScan(e.target.files[0])}
          className="text-sm"
        />
        {!!form.uploads?.length && (
          <ul className="mt-3 space-y-1 text-sm">
            {form.uploads.map((u: any) => (
              <li key={u.id}>
                <a href={u.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  {u.fileUrl.split('/').pop()}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
