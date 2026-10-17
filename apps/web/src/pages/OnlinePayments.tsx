import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, inr } from '../lib/format';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, useFeedback, type Tone } from '../components/ui';

const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: 'Started', tone: 'slate' },
  ATTEMPTED: { label: 'In checkout', tone: 'blue' },
  PAID: { label: 'Paid', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
  EXPIRED: { label: 'Abandoned', tone: 'slate' },
  NEEDS_REVIEW: { label: 'Needs review', tone: 'red' },
};

export default function OnlinePayments() {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const gateway = useQuery({ queryKey: ['rzp-status'], queryFn: async () => (await api.get('/api/payments/status')).data.razorpay });
  const params = new URLSearchParams({ page: String(page), ...(status && { status }), ...(q && { q }) });
  const { data, isLoading } = useQuery({ queryKey: ['online-orders', params.toString()], queryFn: async () => (await api.get(`/api/payments/orders?${params}`)).data });
  const reconcile = useMutation({
    mutationFn: async () => (await api.post('/api/payments/reconcile')).data.summary,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['online-orders'] });
      toast(`Checked ${s.checked} open order(s): ${s.paid} paid, ${s.expired} abandoned`);
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const g = gateway.data;
  const sum = (s: string) => data?.summary?.byStatus?.find((x: any) => x.status === s);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Online Payments"
        subtitle="Payments made on the website through Razorpay. Paid orders are recorded on the student's invoice with a receipt automatically."
        actions={
          <Button variant="ghost" disabled={!g?.configured || reconcile.isPending} onClick={() => reconcile.mutate()}>
            {reconcile.isPending ? 'Checking…' : 'Check open payments now'}
          </Button>
        }
      />
      {g && !g.configured && (
        <Callout tone="amber" title="Razorpay is not connected">
          Add RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server (see docs/SETUP_RAZORPAY.md). Until then the website hides the Pay buttons.
        </Callout>
      )}
      {g?.configured && (
        <Callout tone={g.mode === 'live' ? 'green' : 'blue'} title={g.mode === 'live' ? 'Live mode — real money' : 'Test mode — no real money moves'}>
          {g.mode === 'test' ? 'Use Razorpay test cards/UPI to try payments. Switch to live keys after KYC is approved.' : 'Payments are settled to the studio bank account by Razorpay.'}
          {!g.webhookSecretSet && <p className="mt-1 font-medium text-red-700">Webhook secret missing — set RAZORPAY_WEBHOOK_SECRET.</p>}
          <p className="mt-1 break-all text-xs">Webhook URL: {g.webhookUrl}</p>
        </Callout>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Collected online" value={inr(sum('PAID')?.amountPaise ?? 0)} sub={`${sum('PAID')?.count ?? 0} payment(s)`} />
          <Stat label="Refunded" value={inr(data.summary.refundedPaise)} />
          <Stat label="Needs review" value={String(sum('NEEDS_REVIEW')?.count ?? 0)} sub="paid but not applied" alert={(sum('NEEDS_REVIEW')?.count ?? 0) > 0} />
          <Stat label="Abandoned / failed" value={String((sum('EXPIRED')?.count ?? 0) + (sum('FAILED')?.count ?? 0))} />
        </div>
      )}

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input placeholder="Search name, mobile, description or Razorpay id" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </div>
        {isLoading ? (
          <Loading />
        ) : !data?.orders?.length ? (
          <EmptyState title="No online payments yet" />
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Student</th>
                    <th className="py-2 font-medium">For</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o: any) => {
                    const refunded = o.transactions.reduce((s: number, t: any) => s + Number(t.refundedPaise), 0);
                    return (
                      <tr key={o.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={() => setOpenId(o.id)}>
                        <td className="px-5 py-2.5 text-slate-500">{fmtDateTime(o.paidAt ?? o.createdAt)}</td>
                        <td className="py-2.5">
                          <div className="font-medium">{o.account.fullName}</div>
                          <div className="font-mono text-xs text-slate-400">{o.account.mobile}</div>
                        </td>
                        <td className="py-2.5">{o.description}</td>
                        <td className="py-2.5 text-right">
                          {inr(o.amountPaise)}
                          {refunded > 0 && <div className="text-xs text-red-600">−{inr(refunded)} refunded</div>}
                        </td>
                        <td className="px-5 py-2.5">
                          <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <Card className={`!p-4 ${alert ? '!border-red-200 !bg-red-50' : ''}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const canRefund = ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'].includes(user?.role ?? '');
  const [refunding, setRefunding] = useState<any | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['online-order', id], queryFn: async () => (await api.get(`/api/payments/orders/${id}`)).data });
  const sync = useMutation({
    mutationFn: async () => (await api.post(`/api/payments/orders/${id}/sync`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['online-order', id] });
      qc.invalidateQueries({ queryKey: ['online-orders'] });
      toast('Updated from Razorpay', 'info');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const o = data?.order;
  return (
    <Modal title="Online payment" onClose={onClose} wide>
      {isLoading || !o ? (
        <Loading />
      ) : (
        <div className="space-y-5 text-sm">
          {o.status === 'NEEDS_REVIEW' && (
            <Callout tone="red" title="Money received but not applied">
              {o.failureReason}. Refund it below, or record it manually on the right invoice and note the Razorpay payment id.
            </Callout>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="For" value={o.description} />
            <Info label="Amount" value={inr(o.amountPaise, true)} />
            <Info label="Student" value={`${o.account.fullName} · ${o.account.mobile}`} />
            <Info label="Status" value={ORDER_STATUS[o.status]?.label ?? o.status} />
            <Info label="Razorpay order" value={o.gatewayOrderId} mono />
            <Info label="Created / paid" value={`${fmtDateTime(o.createdAt)}${o.paidAt ? ` / ${fmtDateTime(o.paidAt)}` : ''}`} />
          </div>
          {data.invoice && (
            <Link to={`/invoices/${data.invoice.id}`} className="inline-block font-medium text-brand hover:underline">
              Open invoice {data.invoice.invoiceNo} →
            </Link>
          )}
          <div>
            <h3 className="mb-2 font-semibold">Payment attempts</h3>
            {!o.transactions.length ? (
              <p className="text-slate-400">No payment attempt reached Razorpay.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {o.transactions.map((t: any) => (
                  <li key={t.id} className="space-y-2 px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs">{t.gatewayPaymentId}</span>
                      <span className="flex items-center gap-2">
                        {t.method && <Badge>{t.method}</Badge>}
                        <Badge tone={t.status === 'captured' ? 'green' : t.status === 'failed' ? 'red' : 'slate'}>{t.status}</Badge>
                        {inr(t.amountPaise)}
                      </span>
                    </div>
                    {t.errorReason && <p className="text-xs text-red-600">{t.errorReason}</p>}
                    {t.feePaise && <p className="text-xs text-slate-400">Razorpay fee {inr(t.feePaise, true)} (incl. tax {inr(t.taxPaise ?? 0, true)})</p>}
                    {t.refunds.map((r: any) => (
                      <p key={r.id} className="text-xs text-slate-600">
                        Refund {inr(r.amountPaise)} · <Badge tone={r.status === 'PROCESSED' ? 'green' : r.status === 'FAILED' ? 'red' : 'amber'}>{r.status.toLowerCase()}</Badge> · {r.reason} · {fmtDateTime(r.createdAt)}
                      </p>
                    ))}
                    {canRefund && t.status === 'captured' && Number(t.refundedPaise) < Number(t.amountPaise) && (
                      <Button variant="ghost" onClick={() => setRefunding(t)}>
                        Refund…
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            variant="ghost"
            disabled={sync.isPending}
            onClick={async () => (await confirm({ title: 'Check this order with Razorpay?', body: 'Fetches the latest state of every payment attempt and records any captured payment.', confirmLabel: 'Check now' })) && sync.mutate()}
          >
            Refresh from Razorpay
          </Button>
          {refunding && <RefundForm txn={refunding} orderId={id} onClose={() => setRefunding(null)} />}
        </div>
      )}
    </Modal>
  );
}

function RefundForm({ txn, orderId, onClose }: { txn: any; orderId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const committed = txn.refunds.filter((r: any) => r.status !== 'FAILED').reduce((s: number, r: any) => s + Number(r.amountPaise), 0);
  const maxRupees = (Number(txn.amountPaise) - committed) / 100;
  const [amount, setAmount] = useState(String(maxRupees));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const refund = useMutation({
    mutationFn: async () => (await api.post(`/api/payments/gateway-payments/${txn.id}/refund`, { amountRupees: Number(amount), reason })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['online-order', orderId] });
      qc.invalidateQueries({ queryKey: ['online-orders'] });
      toast(r.refund.status === 'PROCESSED' ? 'Refund processed' : 'Refund started — Razorpay will confirm it shortly');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title="Refund payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={refund.isPending || !reason.trim() || !(Number(amount) > 0) || Number(amount) > maxRupees} onClick={() => refund.mutate()}>
            {refund.isPending ? 'Refunding…' : `Refund ₹${Number(amount || 0).toLocaleString('en-IN')}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="amber">The money goes back to the student's card/UPI/bank through Razorpay (usually 5–7 working days). The invoice's paid amount is reduced to match.</Callout>
        <Field label="Amount (₹)" hint={`Up to ₹${maxRupees.toLocaleString('en-IN')}`}>
          <Input type="number" min={1} max={maxRupees} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" hint="Recorded in the audit log and sent to Razorpay.">
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Batch cancelled" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 break-all text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}
