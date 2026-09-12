import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Card, Spinner } from '../components/ui';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  PAID: 'green',
  PARTIAL: 'amber',
  UNPAID: 'red',
  CANCELLED: 'slate',
  DRAFT: 'slate',
};

export default function Invoices() {
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', status],
    queryFn: async () => (await api.get('/api/billing/invoices', { params: { status: status || undefined } })).data,
  });
  const inr = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Invoices</h1>
          <p className="text-sm text-slate-500">Enrollment, renewal and product invoices.</p>
        </div>
        <select
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
        </select>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : data?.invoices?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Invoice No</th>
                <th className="py-2 font-medium">Student</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Total</th>
                <th className="py-2 font-medium">Balance</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((i: any) => (
                <tr key={i.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3">
                    <Link to={`/invoices/${i.id}`} className="font-medium text-brand hover:underline">
                      {i.invoiceNo}
                    </Link>
                  </td>
                  <td className="py-3">{i.student?.fullName ?? 'Walk-in'}</td>
                  <td className="py-3 text-slate-500">{i.type}</td>
                  <td className="py-3">{inr(Number(i.totalPaise))}</td>
                  <td className="py-3">{inr(Number(i.totalPaise) - Number(i.amountPaidPaise))}</td>
                  <td className="py-3">
                    <Badge tone={STATUS_TONE[i.status] ?? 'slate'}>{i.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-10 text-center text-slate-400">No invoices yet. They are created when you enroll a student.</p>
        )}
      </Card>
    </div>
  );
}
