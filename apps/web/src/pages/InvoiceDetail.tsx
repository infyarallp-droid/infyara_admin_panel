import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiError, openProtected } from '../lib/api';
import { useSingleFlight } from '../lib/useSingleFlight';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get(`/api/billing/invoices/${id}`)).data,
  });

  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // One key per payment attempt: a double click, a retry after a timeout, or a
  // resend of the same form all resolve to the SAME payment on the server.
  // It only changes after a confirmed success or when the admin edits the form.
  const attemptKey = useRef(newKey());
  const once = useSingleFlight();
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    attemptKey.current = newKey();
    setMsg(null);
  };

  const pay = useMutation({
    mutationFn: async () =>
      (
        await api.post(
          `/api/billing/invoices/${id}/payments`,
          { amountRupees: Number(amount), mode, referenceNo: ref.trim() || undefined, paidOn },
          { headers: { 'Idempotency-Key': attemptKey.current } },
        )
      ).data,
    onSuccess: (res) => {
      setMsg({
        ok: true,
        text: res.duplicate
          ? `This payment was already recorded (receipt ${res.receipt?.receiptNo ?? '—'}). No second payment was created.`
          : `Payment recorded. Receipt ${res.receipt.receiptNo} generated.`,
      });
      setAmount('');
      setRef('');
      attemptKey.current = newKey();
      refetch();
    },
    onError: async (e) => {
      setMsg({ ok: false, text: await apiError(e, 'Payment could not be confirmed. Check the payment history below before trying again.') });
      refetch(); // show the true state — a timed-out request may still have been recorded
    },
  });

  const openPdf = async (path: string) => {
    try {
      await openProtected(path);
    } catch (e) {
      setMsg({ ok: false, text: await apiError(e, 'Could not open the PDF') });
    }
  };

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (isError) return <p className="text-sm text-red-600">Could not load this invoice. <button className="underline" onClick={() => refetch()}>Retry</button></p>;
  const inv = data?.invoice;
  if (!inv) return <p>Invoice not found.</p>;
  const balance = Number(inv.totalPaise) - Number(inv.amountPaidPaise);

  const amountNum = Number(amount);
  const amountError =
    amount.trim() === ''
      ? ''
      : !/^\d+(\.\d{1,2})?$/.test(amount.trim())
        ? 'Enter a rupee amount with at most 2 decimals, e.g. 2300 or 2300.50'
        : amountNum <= 0
          ? 'Amount must be greater than zero'
          : Math.round(amountNum * 100) > balance
            ? `Amount is more than the balance of ${inr(balance)}`
            : '';
  const dateError = paidOn > today() ? 'Payment date cannot be in the future' : '';
  const canPay = amount.trim() !== '' && !amountError && !dateError && !pay.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/invoices" className="text-sm text-brand hover:underline">← Invoices</Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{inv.invoiceNo}</h1>
            <Badge tone={inv.status === 'PAID' ? 'green' : inv.status === 'PARTIAL' ? 'amber' : 'red'}>
              {inv.status}
            </Badge>
          </div>
          <p className="text-sm text-slate-500">
            {inv.student ? (
              <Link to={`/students/${inv.student.id}`} className="hover:underline">{inv.student.fullName}</Link>
            ) : (
              'Walk-in'
            )}{' '}
            · {inv.type} · {inv.createdAt?.slice(0, 10)}
          </p>
          {inv.enrollment && (
            <p className="text-xs text-slate-400">
              {inv.type === 'RENEWAL' ? 'Renewal' : 'Enrolment'}: {inv.enrollment.coursePlan.course.name} — {inv.enrollment.coursePlan.title} ·{' '}
              {inv.enrollment.startDate.slice(0, 10)} to {inv.enrollment.endDate.slice(0, 10)}
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={() => openPdf(`/api/billing/invoices/${id}/pdf`)}>
          Download PDF
        </Button>
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="py-2 font-medium">Description</th>
              <th className="py-2 font-medium">Qty</th>
              <th className="py-2 font-medium">Unit</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it: any) => (
              <tr key={it.id} className="border-b border-slate-50">
                <td className="py-2">{it.description}</td>
                <td className="py-2">{it.qty}</td>
                <td className="py-2">{inr(Number(it.unitPricePaise))}</td>
                <td className="py-2 text-right">{inr(Number(it.lineTotalPaise))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <Row label="Subtotal" value={inr(Number(inv.subtotalPaise))} />
          {Number(inv.discountPaise) > 0 && <Row label="Discount" value={`- ${inr(Number(inv.discountPaise))}`} />}
          {Number(inv.taxPaise) > 0 && <Row label="Tax" value={inr(Number(inv.taxPaise))} />}
          <Row label="Total" value={inr(Number(inv.totalPaise))} bold />
          <Row label="Paid" value={inr(Number(inv.amountPaidPaise))} />
          <Row label="Balance" value={inr(balance)} bold />
        </div>
      </Card>

      {balance > 0 && inv.status !== 'CANCELLED' && (
        <Card>
          <h3 className="mb-3 font-semibold">Record payment</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Amount (₹)">
              <Input inputMode="decimal" value={amount} onChange={(e) => edit(setAmount)(e.target.value)} className="w-32" />
            </Field>
            <Field label="Payment date">
              <Input type="date" max={today()} value={paidOn} onChange={(e) => edit(setPaidOn)(e.target.value)} className="w-40" />
            </Field>
            <Field label="Mode">
              <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={mode} onChange={(e) => edit(setMode)(e.target.value)}>
                {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference (optional)">
              <Input value={ref} onChange={(e) => edit(setRef)(e.target.value)} className="w-40" />
            </Field>
            <Button onClick={() => canPay && once(() => pay.mutateAsync())} disabled={!canPay}>
              {pay.isPending ? 'Saving…' : 'Add payment'}
            </Button>
            <button type="button" className="pb-2 text-xs text-brand hover:underline" onClick={() => edit(setAmount)((balance / 100).toFixed(2).replace(/\.00$/, ''))}>
              Full balance ({inr(balance)})
            </button>
          </div>
          {(amountError || dateError) && <p className="mt-2 text-sm text-red-600">{amountError || dateError}</p>}
        </Card>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}

      <Card>
        <h3 className="mb-3 font-semibold">Payments & Receipts</h3>
        {inv.payments?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Mode</th>
                <th className="py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {inv.payments.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2">{new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(p.paidAt))}</td>
                  <td className="py-2">{inr(Number(p.amountPaise))}</td>
                  <td className="py-2">{p.mode}{p.referenceNo ? ` (${p.referenceNo})` : ''}</td>
                  <td className="py-2">
                    {p.receipt ? (
                      <button onClick={() => openPdf(`/api/billing/receipts/${p.receipt.id}/pdf`)} className="text-brand hover:underline">
                        {p.receipt.receiptNo}
                      </button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">No payments yet.</p>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}
