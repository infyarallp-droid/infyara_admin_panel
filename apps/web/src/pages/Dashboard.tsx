import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { Button, Card, Spinner } from '../components/ui';

const COLORS = ['#0d9488', '#f59e0b', '#6366f1', '#ec4899', '#14b8a6', '#64748b'];
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function Dashboard() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: async () => (await api.get('/api/analytics/summary')).data,
    refetchInterval: 60_000,
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const runReminders = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await api.post('/api/automations/run-reminders');
      const s = res.data.summary;
      setMsg(`Reminders run: ${s.renewalNotifications} renewal alerts, ${s.whatsappSent} WhatsApp sent (${s.whatsappSkipped} skipped), ${s.lowStockNotifications} low-stock.`);
      refetch();
    } catch {
      setMsg('Failed to run reminders.');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  const s = data?.summary;
  if (!s) return <p>No data.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">Studio at a glance.</p>
        </div>
        <Button variant="ghost" onClick={runReminders} disabled={busy}>
          {busy ? 'Running…' : 'Run renewal reminders'}
        </Button>
      </div>
      {msg && <p className="text-sm text-slate-500">{msg}</p>}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue this month" value={inr(s.revenueMonthRupees)} sub={`Today ${inr(s.revenueTodayRupees)}`} />
        <Stat label="Pending collection" value={inr(s.pendingRupees)} tone="amber" />
        <Stat label="Active students" value={s.activeStudents} sub={`+${s.newStudentsThisMonth} this month`} />
        <Stat label="Renewals due (30d)" value={s.renewalsDue30} tone={s.renewalsDue30 ? 'amber' : 'slate'} link="/renewals" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total leads" value={s.totalLeads} sub={`${s.conversionRate}% converted`} link="/leads" />
        <Stat label="Converted leads" value={s.convertedLeads} tone="green" />
        <Stat label="Low-stock items" value={s.lowStockCount} tone={s.lowStockCount ? 'red' : 'slate'} link="/inventory" />
        <Stat label="Active employees" value={s.activeEmployees} link="/employees" />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Leads by source</h3>
          {s.leadsBySource.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={s.leadsBySource} dataKey="count" nameKey="source" outerRadius={90} label>
                  {s.leadsBySource.map((_: unknown, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
          <Legend items={s.leadsBySource.map((r: any, i: number) => ({ label: r.source, value: r.count, color: COLORS[i % COLORS.length] }))} />
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Course popularity (enrollments)</h3>
          {s.coursePopularity.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={s.coursePopularity}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0d9488" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Lead funnel</h3>
        {s.leadFunnel.length ? (
          <div className="flex flex-wrap gap-3">
            {s.leadFunnel.map((f: any) => (
              <div key={f.status} className="rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-400">{f.status}</div>
                <div className="text-xl font-bold">{f.count}</div>
              </div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'brand',
  link,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'brand' | 'amber' | 'green' | 'red' | 'slate';
  link?: string;
}) {
  const color = { brand: 'text-brand', amber: 'text-amber-600', green: 'text-green-600', red: 'text-red-600', slate: 'text-slate-700' }[tone];
  const body = (
    <Card>
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </Card>
  );
  return link ? <Link to={link}>{body}</Link> : body;
}

function Legend({ items }: { items: { label: string; value: number; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} /> {i.label} ({i.value})
        </span>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-sm text-slate-400">No data yet.</p>;
}
