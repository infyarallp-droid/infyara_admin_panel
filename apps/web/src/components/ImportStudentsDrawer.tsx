import { useRef, useState } from 'react';
import { useSingleFlight } from '../lib/useSingleFlight';
import { api, apiError } from '../lib/api';
import { Badge, Button } from './ui';

interface PreviewRow {
  rowNumber: number;
  status: 'NEW_STUDENT' | 'EXISTING_STUDENT' | 'DUPLICATE' | 'INVALID';
  errors: string[];
  warnings: string[];
  action: string;
  willImport: boolean;
  student: { fullName: string; mobile: string } | null;
}
interface Preview {
  fileErrors: string[];
  rows: PreviewRow[];
  summary: {
    totalRows: number;
    importableRows: number;
    newStudents: number;
    existingStudents: number;
    enrollmentsToCreate: number;
    duplicateRows: number;
    invalidRows: number;
  };
}
interface CommitResult {
  summary: {
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    failedRows: number;
    studentsCreated: number;
    studentsUpdated: number;
    enrollmentsCreated: number;
    paymentsCreated: number;
  };
  results: { rowNumber: number; result: 'IMPORTED' | 'SKIPPED' | 'FAILED'; message: string }[];
}

const ROW_TONE = { NEW_STUDENT: 'green', EXISTING_STUDENT: 'slate', DUPLICATE: 'amber', INVALID: 'red' } as const;
const ROW_LABEL = { NEW_STUDENT: 'New student', EXISTING_STUDENT: 'Existing student', DUPLICATE: 'Duplicate', INVALID: 'Invalid' };
const RESULT_TONE = { IMPORTED: 'green', SKIPPED: 'amber', FAILED: 'red' } as const;

/** Legacy ("old student") bulk upload: template → choose file → preview → import → summary. */
export default function ImportStudentsDrawer({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [policy, setPolicy] = useState<'skip' | 'fill_blanks'>('skip');
  const [busy, setBusy] = useState<'' | 'template' | 'preview' | 'import'>('');
  const [error, setError] = useState('');
  const once = useSingleFlight();

  const downloadTemplate = async () => {
    setBusy('template');
    setError('');
    try {
      const res = await api.get('/api/students/import/template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'moksha-legacy-students-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(await apiError(e, 'Could not download the template'));
    } finally {
      setBusy('');
    }
  };

  const choose = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    setError('');
    if (!f) return;
    setBusy('preview');
    try {
      const fd = new FormData();
      fd.append('file', f);
      setPreview((await api.post('/api/students/import/preview', fd)).data);
    } catch (e) {
      setError(await apiError(e, 'The file could not be checked'));
    } finally {
      setBusy('');
    }
  };

  const runImport = async () => {
    if (!file || busy) return;
    setBusy('import');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('updatePolicy', policy);
      setResult((await api.post('/api/students/import/commit', fd)).data);
      setPreview(null);
      onImported();
    } catch (e) {
      setError(await apiError(e, 'Import failed — nothing was changed by the failed request'));
    } finally {
      setBusy('');
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">Import old students</h2>
            <p className="text-sm text-slate-500">Upload existing students and their enrolments from a spreadsheet.</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <ol className="mb-4 space-y-3 text-sm">
          <li className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 font-medium">1. Download the template</div>
            <Button variant="ghost" onClick={downloadTemplate} disabled={busy === 'template'}>
              {busy === 'template' ? 'Preparing…' : 'Download template (CSV, opens in Excel)'}
            </Button>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
              <li>
                <b>Full Name</b> and <b>Mobile Number</b> are required. Student ID is optional — one is generated if left blank.
              </li>
              <li>
                To import an enrolment fill <b>Course Name or Code</b>, <b>Joining Date</b> and <b>Plan / Duration</b> (must match a plan
                set up under Courses). Expiry Date, Fee and Amount Paid are optional.
              </li>
              <li>Dates: YYYY-MM-DD or DD-MM-YYYY. Amounts: plain rupees, e.g. 2500.</li>
              <li>Save from Excel as “CSV UTF-8 (Comma delimited)”.</li>
            </ul>
          </li>
          <li className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 font-medium">2. Choose the filled-in file</div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="text-sm"
              disabled={!!busy}
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
            {busy === 'preview' && <span className="ml-2 text-xs text-slate-400">Checking file…</span>}
          </li>
        </ol>

        {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {preview && preview.fileErrors.length > 0 && (
          <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">The file cannot be imported:</p>
            <ul className="list-disc pl-5">
              {preview.fileErrors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {preview && !preview.fileErrors.length && (
          <div className="space-y-3">
            <div className="font-medium">3. Review before importing — nothing has been saved yet</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>{preview.summary.totalRows} rows</Badge>
              <Badge tone="green">{preview.summary.newStudents} new students</Badge>
              <Badge>{preview.summary.existingStudents} matched existing</Badge>
              <Badge tone="green">{preview.summary.enrollmentsToCreate} enrolments to add</Badge>
              <Badge tone="amber">{preview.summary.duplicateRows} duplicates (skipped)</Badge>
              <Badge tone="red">{preview.summary.invalidRows} invalid (not imported)</Badge>
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">Row</th>
                    <th className="px-2 py-2 font-medium">Student</th>
                    <th className="px-2 py-2 font-medium">Result</th>
                    <th className="px-2 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2 text-slate-400">{r.rowNumber}</td>
                      <td className="px-2 py-2">
                        {r.student ? (
                          <>
                            {r.student.fullName}
                            <div className="text-slate-400">{r.student.mobile}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={ROW_TONE[r.status]}>{ROW_LABEL[r.status]}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        {r.errors.map((e) => (
                          <div key={e} className="text-red-600">
                            {e}
                          </div>
                        ))}
                        {!r.errors.length && <div>{r.action}</div>}
                        {r.warnings.map((w) => (
                          <div key={w} className="text-amber-600">
                            Note: {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <fieldset className="rounded-xl border border-slate-200 p-3 text-sm">
              <legend className="px-1 font-medium">Students that already exist</legend>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={policy === 'skip'} onChange={() => setPolicy('skip')} />
                <span>
                  Keep their details exactly as they are <span className="text-slate-400">(recommended — only new enrolments are added)</span>
                </span>
              </label>
              <label className="mt-1 flex items-start gap-2">
                <input type="radio" className="mt-1" checked={policy === 'fill_blanks'} onChange={() => setPolicy('fill_blanks')} />
                <span>
                  Fill in blank fields only <span className="text-slate-400">(existing values and payments are never overwritten)</span>
                </span>
              </label>
            </fieldset>

            <div className="flex items-center gap-2">
              <Button onClick={() => once(runImport)} disabled={!!busy || preview.summary.importableRows === 0}>
                {busy === 'import' ? 'Importing…' : `Import ${preview.summary.importableRows} row(s)`}
              </Button>
              <Button variant="ghost" onClick={reset} disabled={!!busy}>
                Choose another file
              </Button>
              {preview.summary.importableRows === 0 && <span className="text-xs text-slate-400">Nothing to import in this file.</span>}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="font-medium">Import finished</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge>{result.summary.totalRows} total rows</Badge>
              <Badge tone="green">{result.summary.importedRows} imported</Badge>
              <Badge tone="amber">{result.summary.skippedRows} skipped</Badge>
              <Badge tone="red">{result.summary.failedRows} failed</Badge>
            </div>
            <p className="text-xs text-slate-500">
              {result.summary.studentsCreated} students created · {result.summary.studentsUpdated} existing students updated ·{' '}
              {result.summary.enrollmentsCreated} enrolments added · {result.summary.paymentsCreated} payments recorded
            </p>
            <div className="max-h-[45vh] overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-xs">
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-slate-100 align-top first:border-t-0">
                      <td className="px-2 py-2 text-slate-400">Row {r.rowNumber}</td>
                      <td className="px-2 py-2">
                        <Badge tone={RESULT_TONE[r.result]}>{r.result}</Badge>
                      </td>
                      <td className="px-2 py-2">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="ghost" onClick={reset}>
              Import another file
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
