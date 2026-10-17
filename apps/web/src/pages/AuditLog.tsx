import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { fmtDateTime, timeAgo } from '../lib/format';
import { Badge, Button, Callout, Card, EmptyState, Input, Loading, PageHeader, Pagination, useFeedback } from '../components/ui';

export default function AuditLog() {
  const { toast } = useFeedback();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: async () => (await api.get('/api/system/jobs')).data, refetchInterval: 60_000 });
  const { data, isLoading } = useQuery({
    queryKey: ['audit', action, page],
    queryFn: async () => (await api.get(`/api/system/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}`)).data,
  });
  const run = useMutation({
    mutationFn: async () => (await api.post('/api/system/jobs/run')).data.result,
    onSuccess: (r) => {
      jobs.refetch();
      toast(`Job runner finished in ${r.ms} ms`);
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });
  const lastTick = jobs.data?.markers?.find((m: any) => m.key === 'last-tick')?.value as string | undefined;
  const stale = !lastTick || Date.now() - new Date(lastTick).getTime() > 30 * 60_000;

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log & Jobs" subtitle="Who changed what (content, payments, refunds, accounts, WhatsApp), and the health of the background job runner." />
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Background jobs</h2>
            <p className="text-sm text-slate-500">
              Sends scheduled WhatsApp messages, queues automatic reminders, runs the daily renewal check and confirms unfinished payments.
            </p>
          </div>
          <Button variant="ghost" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Running…' : 'Run now'}
          </Button>
        </div>
        {jobs.data && (
          <>
            <p className="text-sm">
              Last run: <strong>{lastTick ? `${timeAgo(lastTick)} (${fmtDateTime(lastTick)})` : 'never'}</strong>
            </p>
            {stale && (
              <Callout tone="amber" title="The job runner has not run in the last 30 minutes">
                Scheduled messages and reminders wait until it runs. Set up a scheduler to call
                <code className="mx-1 break-all rounded bg-white px-1">POST {jobs.data.tickUrl}</code>
                every 5 minutes with header <code className="rounded bg-white px-1">x-cron-secret</code> (see DEPLOYMENT.md).
                {!jobs.data.cronSecretSet && <strong className="block">CRON_SECRET is not set on the server yet.</strong>}
              </Callout>
            )}
          </>
        )}
      </Card>
      <Card>
        <div className="mb-4">
          <Input placeholder="Filter by action, e.g. REFUND, CONTENT, ACCOUNT" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} />
        </div>
        {isLoading ? (
          <Loading />
        ) : !data?.logs?.length ? (
          <EmptyState title="No audit entries" />
        ) : (
          <>
            <ul className="divide-y divide-slate-100 text-sm">
              {data.logs.map((l: any) => (
                <li key={l.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={/REFUND|SUSPEND|DELETE|RESET/.test(l.action) ? 'red' : /PUBLISH|LINK|CREATED/.test(l.action) ? 'green' : 'slate'}>{l.action.replace(/_/g, ' ').toLowerCase()}</Badge>
                      <span className="text-slate-600">{l.entity?.replace(/_/g, ' ')}</span>
                    </div>
                    {l.meta && <p className="mt-0.5 truncate font-mono text-xs text-slate-400">{JSON.stringify(l.meta)}</p>}
                  </div>
                  <div className="shrink-0 text-xs text-slate-500">
                    {l.user?.name ?? 'System'} · {fmtDateTime(l.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
