import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, API } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default function InvoiceDetail() {
  const { id } = useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get(`/api/billing/invoices/${id}`)).data,
  });

  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [ref, setRef] = useState('');
  const [msg, setMsg] = useState('');

  const pay = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/billing/invoices/${id}/payments`, {
          amountRupees: Number(amount),
          mode,
          referenceNo: ref || undefined,
        })
      ).data,
    onSuccess: (res) => {
      setMsg(`Payment recorded. Receipt ${res.receipt.receiptNo} generated.`);
      setAmount('');
      setRef('');
      refetch();
    },
    onError: (e: any) => setMsg(e.response?.data?.error ?? 'Payment failed'),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const inv = data?.invoice;
  if (!inv) return <p>Invoice not found.</p>;
  const balance = Number(inv.totalPaise) - Number(inv.amountPaidPaise);

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
            {inv.student?.fullName ?? 'Walk-in'} · {inv.type} · {inv.createdAt?.slice(0, 10)}
          </p>
        </div>
        <a href={`${API}/api/billing/invoices/${id}/pdf`} target="_blank" rel="noreferrer">
          <Button variant="ghost">Download PDF</Button>
        </a>
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

      {balance > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">Record payment</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Amount (₹)">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
            </Field>
            <Field label="Mode">
              <select className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value)}>
                {['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference (optional)">
              <Input value={ref} onChange={(e) => setRef(e.target.value)} className="w-40" />
            </Field>
            <Button onClick={() => Number(amount) > 0 && pay.mutate()} disabled={pay.isPending}>
              {pay.isPending ? 'Saving…' : 'Add payment'}
            </Button>
          </div>
          {msg && <p className="mt-2 text-sm text-slate-500">{msg}</p>}
        </Card>
      )}

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
                  <td className="py-2">{p.paidAt?.slice(0, 10)}</td>
                  <td className="py-2">{inr(Number(p.amountPaise))}</td>
                  <td className="py-2">{p.mode}{p.referenceNo ? ` (${p.referenceNo})` : ''}</td>
                  <td className="py-2">
                    {p.receipt ? (
                      <a href={p.receipt.pdfUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {p.receipt.receiptNo}
                      </a>
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
