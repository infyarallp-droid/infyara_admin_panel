import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiError, openProtected, printProtected } from '../lib/api';
import { Badge, Button, Card, Spinner } from '../components/ui';
import SignaturePad from '../components/SignaturePad';

interface HealthOption {
  key: string;
  label: string;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const SCAN_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_SCAN_BYTES = 10 * 1024 * 1024;

export default function ConsentForm() {
  const { id } = useParams();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [healthOther, setHealthOther] = useState('');
  const [acks, setAcks] = useState({ safety: false, policies: false, conduct: false, final: false });
  const [studentSig, setStudentSig] = useState<string | null>(null);
  const [guardianSig, setGuardianSig] = useState<string | null>(null);
  const [resign, setResign] = useState({ student: false, guardian: false });
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const formQ = useQuery({
    queryKey: ['consent-form', id],
    queryFn: async () => (await api.get(`/api/consent/forms/${id}`)).data,
  });

  const form = formQ.data?.form;
  // The wording this form is signed against (its own template version, frozen once finalised).
  const sections = formQ.data?.sections;
  const finalized = form?.status === 'FINALIZED';
  const pdfPath = `/api/consent/forms/${id}/pdf`;

  // Fill the editable fields once per form — a background refetch must not
  // wipe what the admin is in the middle of ticking.
  useEffect(() => {
    if (form && loadedFor.current !== form.id) {
      loadedFor.current = form.id;
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

  const healthOptions: HealthOption[] = useMemo(() => sections?.healthOptions ?? [], [sections]);

  const savePayload = () => ({
    healthFlags: flags,
    healthOther,
    consentSafetyAck: acks.safety,
    studioPoliciesAck: acks.policies,
    codeOfConductAck: acks.conduct,
    finalAck: acks.final,
    studentSignatureDataUrl: studentSig ?? undefined,
    guardianSignatureDataUrl: guardianSig ?? undefined,
    studentSignedDate: studentSig ? today() : undefined,
  });

  const run = async (fn: () => Promise<void>, fallback: string) => {
    if (busy) return; // ignore repeated clicks while a request is in flight
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: await apiError(e, fallback) });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(async () => {
      await api.put(`/api/consent/forms/${id}`, savePayload());
      setMsg({ ok: true, text: 'Draft saved.' });
      setResign({ student: false, guardian: false });
      setStudentSig(null);
      setGuardianSig(null);
      await formQ.refetch();
    }, 'Save failed — your entries are still on this page, please try again.');

  const finalize = () =>
    run(async () => {
      // Open the tab now (inside the click) so the PDF is not blocked as a pop-up.
      const tab = window.open('', '_blank');
      try {
        await api.put(`/api/consent/forms/${id}`, savePayload());
        await api.post(`/api/consent/forms/${id}/finalize`);
        const res = await api.get(pdfPath, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data as Blob);
        if (tab) tab.location.href = url;
        setMsg({ ok: true, text: tab ? 'Finalized. The PDF opened in a new tab.' : 'Finalized. Use “Open PDF” below.' });
      } catch (e) {
        tab?.close();
        throw e;
      } finally {
        await formQ.refetch();
      }
    }, 'Finalize failed — the draft is saved and unchanged, please try again.');

  const openPdf = () => run(() => openProtected(pdfPath), 'Could not open the PDF');
  const printPdf = () => run(() => printProtected(pdfPath), 'Could not print the PDF');
  const printDraft = () =>
    run(async () => {
      await api.put(`/api/consent/forms/${id}`, savePayload()); // print what is on screen
      await openProtected(pdfPath);
      await formQ.refetch();
    }, 'Could not prepare the form for printing');

  const uploadScan = async (file: File) => {
    setMsg(null);
    if (!SCAN_TYPES.includes(file.type)) {
      setMsg({ ok: false, text: 'Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF of the signed form.' });
      return;
    }
    if (file.size > MAX_SCAN_BYTES) {
      setMsg({ ok: false, text: 'That file is larger than 10 MB. Please upload a smaller scan.' });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/consent/forms/${id}/uploads`, fd);
      setMsg({ ok: true, text: 'Signed copy uploaded and attached to this consent form.' });
      await formQ.refetch();
    } catch (e) {
      setMsg({ ok: false, text: await apiError(e, 'Upload failed — the signed copy was not saved.') });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openUpload = async (u: any) => {
    try {
      if (u.fileKey) await openProtected(`/api/consent/uploads/${u.id}/file`);
      else window.open(u.fileUrl, '_blank', 'noreferrer');
    } catch (e) {
      setMsg({ ok: false, text: await apiError(e, 'Could not open the file') });
    }
  };

  if (formQ.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (formQ.isError) return <p className="text-sm text-red-600">Could not load this consent form. <button className="underline" onClick={() => formQ.refetch()}>Retry</button></p>;
  if (!form) return <p>Consent form not found.</p>;

  const clauses = sections?.clauses ?? { safety: [], policies: [], conduct: [], final: [] };
  const hasStudentSig = !!form.studentSignatureUrl;
  const hasGuardianSig = !!form.guardianSignatureUrl;

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
          {form.student?.fullName}
          {form.student?.studentCode ? ` (${form.student.studentCode})` : ''} · {form.student?.mobile} · {form.formDate?.slice(0, 10)}
          {form.templateVersion != null ? ` · form version v${form.templateVersion}` : ''}
        </p>
      </div>

      {/* Fee details */}
      {form.courseName && (
        <Card>
          <h3 className="mb-2 font-semibold">Course & Fee</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <span>{form.courseName} — {form.planTitle}</span>
            {form.enrollment && (
              <span>
                {form.enrollment.startDate.slice(0, 10)} to {form.enrollment.endDate.slice(0, 10)}
              </span>
            )}
            <span>Fee: ₹{(Number(form.feePaise) / 100).toLocaleString('en-IN')}</span>
            <span>Paid: ₹{(Number(form.amountPaidPaise ?? 0) / 100).toLocaleString('en-IN')}</span>
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
      <Card>
        <h3 className="mb-1 font-semibold">Signatures</h3>
        {!finalized && (
          <p className="mb-3 text-sm text-slate-500">
            Sign here on screen, <b>or</b> print the form, sign on paper and upload the signed copy below.
          </p>
        )}
        <div className="grid gap-6 md:grid-cols-2">
          <SignatureBlock
            label="Student signature"
            saved={hasStudentSig ? form.studentSignatureUrl : null}
            editable={!finalized}
            redo={resign.student}
            onRedo={() => setResign((r) => ({ ...r, student: true }))}
            onChange={setStudentSig}
          />
          {(form.student?.isMinor || hasGuardianSig) && (
            <SignatureBlock
              label="Parent/Guardian signature"
              saved={hasGuardianSig ? form.guardianSignatureUrl : null}
              editable={!finalized}
              redo={resign.guardian}
              onRedo={() => setResign((r) => ({ ...r, guardian: true }))}
              onChange={setGuardianSig}
            />
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {!finalized && (
          <>
            <Button variant="ghost" onClick={saveDraft} disabled={busy}>
              Save draft
            </Button>
            <Button variant="ghost" onClick={printDraft} disabled={busy} title="Opens the form as a PDF to print and sign on paper">
              Print for signature
            </Button>
            <Button onClick={finalize} disabled={busy}>
              {busy ? 'Working…' : 'Finalize & Download PDF'}
            </Button>
          </>
        )}
        {finalized && (
          <>
            <Button onClick={openPdf} disabled={busy}>
              Open / Download PDF
            </Button>
            <Button variant="ghost" onClick={printPdf} disabled={busy}>
              Print
            </Button>
          </>
        )}
        {busy && <Spinner />}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}

      {/* Signed-scan upload */}
      <Card>
        <h3 className="mb-2 font-semibold">Upload Signed Copy</h3>
        <p className="mb-3 text-sm text-slate-500">
          After the student signs the printed form, upload a photo/scan here for the record (JPG, PNG or PDF, up to 10 MB).
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          disabled={uploading}
          onChange={(e) => e.target.files?.[0] && uploadScan(e.target.files[0])}
          className="text-sm"
        />
        {uploading && <span className="ml-2 text-xs text-slate-400">Uploading…</span>}
        {form.uploads?.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {form.uploads.map((u: any) => (
              <li key={u.id}>
                <button onClick={() => openUpload(u)} className="text-brand hover:underline">
                  {u.fileName ?? u.fileUrl.split('/').pop()?.split('?')[0]}
                </button>
                <span className="ml-2 text-xs text-slate-400">uploaded {u.uploadedAt?.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-slate-400">No signed copy uploaded yet.</p>
        )}
      </Card>
    </div>
  );
}

function SignatureBlock({
  label,
  saved,
  editable,
  redo,
  onRedo,
  onChange,
}: {
  label: string;
  saved: string | null;
  editable: boolean;
  redo: boolean;
  onRedo: () => void;
  onChange: (dataUrl: string | null) => void;
}) {
  // A saved signature is shown as-is; the pad only appears to capture a new one.
  if (saved && !redo) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {editable && (
            <button type="button" onClick={onRedo} className="text-xs text-brand hover:underline">
              Sign again
            </button>
          )}
        </div>
        <div className="grid h-[120px] place-items-center rounded-xl border border-slate-200 bg-slate-50">
          <img src={saved} alt={`${label} (saved)`} className="max-h-[110px] max-w-full" />
        </div>
        <span className="block text-xs text-green-700">Saved</span>
      </div>
    );
  }
  if (!editable) {
    return (
      <div className="space-y-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <p className="text-sm text-slate-400">Signed on paper — see the uploaded signed copy.</p>
      </div>
    );
  }
  return <SignaturePad label={label} onChange={onChange} />;
}
