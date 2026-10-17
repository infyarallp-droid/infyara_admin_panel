import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deviceLabel, fmtDateTime, inr, timeAgo } from '../lib/format';
import { Badge, Button, Callout, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Tabs, useFeedback } from '../components/ui';

interface StudentRef {
  id: string;
  fullName: string;
  studentCode: string | null;
  mobile: string;
}

interface Account {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  signupMethod: 'MOBILE_PASSWORD' | 'EMAIL_PASSWORD' | 'GOOGLE';
  status: 'ACTIVE' | 'SUSPENDED';
  studentId: string | null;
  student: StudentRef | null;
  linkedAt: string | null;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
  hasPassword: boolean;
  mustChangePassword: boolean;
  identities: { provider: string; email: string | null }[];
  suggestedStudent?: StudentRef | null;
  whatsapp?: 'OPTED_IN' | 'OPTED_OUT' | null;
}

const METHOD = { MOBILE_PASSWORD: 'Mobile', EMAIL_PASSWORD: 'Email', GOOGLE: 'Google' } as const;
const MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];

export default function WebsiteLogins() {
  const [q, setQ] = useState('');
  const [linked, setLinked] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'accounts' | 'activity'>('accounts');
  const [openId, setOpenId] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), ...(q && { q }), ...(linked && { linked }), ...(method && { method }) });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['website-logins', params.toString()],
    queryFn: async () => (await api.get(`/api/website-logins?${params}`)).data,
    enabled: tab === 'accounts',
  });
  const activity = useQuery({
    queryKey: ['website-logins-activity'],
    queryFn: async () => (await api.get('/api/website-logins/activity?limit=100')).data,
    enabled: tab === 'activity',
    refetchInterval: 30_000,
  });

  const stats = data?.stats;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Website Logins"
        subtitle="Everyone who has created an account or signed in on the website. Link each account to its studio student so they can see their classes, invoices and receipts."
      />

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Website accounts', stats.accounts],
            ['Waiting to be linked', stats.unlinked],
            ['New this week', stats.newThisWeek],
            ['Sign-ins this week', stats.signInsThisWeek],
          ].map(([label, value]) => (
            <Card key={label as string} className="!p-4">
              <div className="text-2xl font-bold text-slate-900">{value as number}</div>
              <div className="text-xs text-slate-500">{label as string}</div>
            </Card>
          ))}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'accounts', label: 'Accounts' },
          { value: 'activity', label: 'Recent sign-in activity' },
        ]}
      />

      {tab === 'accounts' && (
        <Card>
          <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="Search name, mobile or email"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            <Select value={linked} onChange={(e) => (setLinked(e.target.value), setPage(1))} aria-label="Link status">
              <option value="">All accounts</option>
              <option value="no">Not linked yet</option>
              <option value="yes">Linked to a student</option>
            </Select>
            <Select value={method} onChange={(e) => (setMethod(e.target.value), setPage(1))} aria-label="Sign-up method">
              <option value="">Any sign-up method</option>
              <option value="MOBILE_PASSWORD">Mobile number</option>
              <option value="EMAIL_PASSWORD">Email</option>
              <option value="GOOGLE">Google</option>
            </Select>
          </div>

          {isLoading ? (
            <Loading />
          ) : isError ? (
            <Callout tone="red">Could not load website accounts. Please refresh.</Callout>
          ) : !data.accounts.length ? (
            <EmptyState title={q || linked || method ? 'No accounts match these filters' : 'No website accounts yet'}>
              Accounts appear here as soon as someone signs up on the website.
            </EmptyState>
          ) : (
            <>
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="px-5 py-2 font-medium">Name</th>
                      <th className="py-2 font-medium">Mobile</th>
                      <th className="py-2 font-medium">Signed up with</th>
                      <th className="py-2 font-medium">Studio student</th>
                      <th className="py-2 font-medium">Last sign-in</th>
                      <th className="px-5 py-2 text-right font-medium">Sign-ins</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a: Account) => (
                      <tr key={a.id} onClick={() => setOpenId(a.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-5 py-3">
                          <div className="font-medium text-slate-900">{a.fullName}</div>
                          <div className="text-xs text-slate-400">{a.email ?? 'no email'}</div>
                        </td>
                        <td className="py-3 font-mono text-xs">{a.mobile}</td>
                        <td className="py-3">
                          <Badge tone={a.signupMethod === 'GOOGLE' ? 'blue' : a.signupMethod === 'EMAIL_PASSWORD' ? 'amber' : 'slate'}>{METHOD[a.signupMethod]}</Badge>
                          {a.status === 'SUSPENDED' && (
                            <span className="ml-1">
                              <Badge tone="red">Suspended</Badge>
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          {a.student ? (
                            <span className="text-slate-700">
                              {a.student.fullName} <span className="text-xs text-slate-400">{a.student.studentCode}</span>
                            </span>
                          ) : a.suggestedStudent ? (
                            <Badge tone="amber">Possible match: {a.suggestedStudent.fullName}</Badge>
                          ) : (
                            <span className="text-slate-400">Not linked</span>
                          )}
                        </td>
                        <td className="py-3 text-slate-500" title={fmtDateTime(a.lastLoginAt)}>
                          {timeAgo(a.lastLoginAt)}
                        </td>
                        <td className="px-5 py-3 text-right">{a.loginCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          {activity.isLoading ? (
            <Loading />
          ) : !activity.data?.events?.length ? (
            <EmptyState title="No sign-in activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {activity.data.events.map((e: any) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={e.success ? 'green' : 'red'}>{e.success ? (e.reason === 'SIGNUP' ? 'Signed up' : 'Signed in') : 'Failed'}</Badge>
                    {e.account ? (
                      <button className="font-medium text-slate-800 hover:underline" onClick={() => setOpenId(e.account.id)}>
                        {e.account.fullName}
                      </button>
                    ) : (
                      <span className="text-slate-500">Unknown number {e.mobile}</span>
                    )}
                    <span className="text-xs text-slate-400">via {METHOD[e.method as keyof typeof METHOD]}</span>
                    {!e.success && e.reason && <span className="text-xs text-red-500">{e.reason.replace(/_/g, ' ').toLowerCase()}</span>}
                  </div>
                  <span className="text-xs text-slate-400" title={e.ip ?? ''}>
                    {deviceLabel(e.userAgent)} · {fmtDateTime(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {openId && <AccountDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function AccountDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const canManage = MANAGE_ROLES.includes(user?.role ?? '');
  const [search, setSearch] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['website-login', id], queryFn: async () => (await api.get(`/api/website-logins/${id}`)).data });
  const students = useQuery({
    queryKey: ['student-search', search],
    queryFn: async () => (await api.get(`/api/students?search=${encodeURIComponent(search)}&page=1&pageSize=8`)).data,
    enabled: search.trim().length >= 2,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['website-login', id] });
    qc.invalidateQueries({ queryKey: ['website-logins'] });
  };
  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => (await api.post(`/api/website-logins/${id}/${path}`, body)).data,
    onSuccess: (res, vars) => {
      refresh();
      if (vars.path === 'reset-password') setTempPassword(res.temporaryPassword);
      else toast('Saved');
    },
    onError: async (e) => toast(await apiError(e), 'error'),
  });

  const a: Account | undefined = data?.account;
  const link = async (s: StudentRef) => {
    const ok = await confirm({
      title: `Link to ${s.fullName}?`,
      body: (
        <>
          <p>
            <strong>{a?.fullName}</strong> ({a?.mobile}) will see <strong>{s.fullName}</strong>'s ({s.mobile}) enrolments, invoices and receipts when
            signed in on the website.
          </p>
          {a && a.mobile !== s.mobile && <p className="mt-2 text-amber-700">The mobile numbers differ. Confirm with the student first.</p>}
        </>
      ),
      confirmLabel: 'Link account',
    });
    if (ok) action.mutate({ path: 'link', body: { studentId: s.id } });
  };

  return (
    <Modal title={a?.fullName ?? 'Website account'} onClose={onClose} wide>
      {isLoading || !a ? (
        <Loading />
      ) : (
        <div className="space-y-6 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <Info label="Mobile" value={a.mobile} />
            <Info label="Email" value={a.email ?? '—'} />
            <Info label="Signed up" value={`${fmtDateTime(a.createdAt)} with ${METHOD[a.signupMethod]}`} />
            <Info label="Last sign-in" value={a.lastLoginAt ? `${fmtDateTime(a.lastLoginAt)} (${a.loginCount} total)` : 'Never'} />
            <Info label="Google" value={a.identities.find((i) => i.provider === 'GOOGLE')?.email ?? (a.identities.length ? 'Connected' : 'Not connected')} />
            <Info label="Password" value={a.hasPassword ? (a.mustChangePassword ? 'Temporary — must change' : 'Set') : 'Not set (Google only)'} />
          </div>

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">Studio student</h3>
            {a.student ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <Link to={`/students/${a.student.id}`} className="font-medium text-brand hover:underline">
                  {a.student.fullName} · {a.student.studentCode} · {a.student.mobile}
                </Link>
                {canManage && (
                  <Button
                    variant="ghost"
                    onClick={async () => (await confirm({ title: 'Unlink this student?', body: 'The website account will no longer show their records.', danger: true, confirmLabel: 'Unlink' })) && action.mutate({ path: 'unlink' })}
                  >
                    Unlink
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Callout tone="blue">
                  Not linked yet. Website sign-ups are never linked automatically because mobile numbers are not verified. Confirm it is the same person, then link.
                </Callout>
                {data.suggestedStudent && canManage && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <span>
                      Same mobile as <strong>{data.suggestedStudent.fullName}</strong> ({data.suggestedStudent.studentCode})
                    </span>
                    <Button onClick={() => link(data.suggestedStudent)}>Link to this student</Button>
                  </div>
                )}
                {canManage && (
                  <Field label="Or find a student">
                    <Input placeholder="Name, mobile or student ID" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </Field>
                )}
                {students.data?.items?.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {students.data.items.slice(0, 8).map((s: StudentRef) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span>
                          {s.fullName} <span className="text-xs text-slate-400">{s.studentCode} · {s.mobile}</span>
                        </span>
                        <Button variant="subtle" onClick={() => link(s)}>
                          Link
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {canManage && (
            <section className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                onClick={async () =>
                  (await confirm({ title: 'Reset password?', body: 'A temporary password is created and the person is signed out everywhere. Share it with them privately; they must change it at next sign-in.', confirmLabel: 'Reset password' })) &&
                  action.mutate({ path: 'reset-password' })
                }
              >
                Reset password
              </Button>
              <Button variant="ghost" disabled={!data.sessions.length} onClick={() => action.mutate({ path: 'revoke-sessions' })}>
                Sign out everywhere ({data.sessions.length})
              </Button>
              {a.status === 'ACTIVE' ? (
                <Button
                  variant="danger"
                  onClick={async () =>
                    (await confirm({ title: 'Suspend this account?', body: 'They are signed out and cannot sign in until reactivated.', danger: true, confirmLabel: 'Suspend' })) &&
                    action.mutate({ path: 'status', body: { status: 'SUSPENDED' } })
                  }
                >
                  Suspend
                </Button>
              ) : (
                <Button onClick={() => action.mutate({ path: 'status', body: { status: 'ACTIVE' } })}>Reactivate</Button>
              )}
            </section>
          )}

          {tempPassword && (
            <Callout tone="green" title="Temporary password (shown once)">
              <code className="select-all rounded bg-white px-2 py-1 text-base">{tempPassword}</code>
              <p className="mt-1">Share it privately. They will be asked to choose a new password after signing in.</p>
            </Callout>
          )}

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">Sign-in history</h3>
            {!data.events.length ? (
              <p className="text-slate-400">No sign-ins recorded.</p>
            ) : (
              <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {data.events.map((e: any) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={e.success ? 'green' : 'red'}>{e.success ? (e.reason === 'SIGNUP' ? 'Signed up' : 'Signed in') : 'Failed'}</Badge>
                      <span className="text-xs text-slate-500">{METHOD[e.method as keyof typeof METHOD]}</span>
                    </span>
                    <span className="text-xs text-slate-400">
                      {deviceLabel(e.userAgent)} · {fmtDateTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.orders.length > 0 && (
            <section>
              <h3 className="mb-2 font-semibold text-slate-800">Online payments</h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.orders.map((o: any) => (
                  <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>{o.description}</span>
                    <span className="flex items-center gap-2">
                      {inr(o.amountPaise)} <Badge tone={o.status === 'PAID' ? 'green' : o.status === 'NEEDS_REVIEW' ? 'red' : 'slate'}>{o.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">WhatsApp consent history</h3>
            {!data.consents.length ? (
              <p className="text-slate-400">No WhatsApp opt-in recorded. They will not receive WhatsApp messages.</p>
            ) : (
              <ul className="space-y-1">
                {data.consents.map((c: any) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={c.state === 'OPTED_IN' ? 'green' : 'slate'}>{c.state === 'OPTED_IN' ? 'Opted in' : 'Opted out'}</Badge>
                    <span className="text-xs text-slate-500">
                      {c.source.replace(/_/g, ' ').toLowerCase()} · {fmtDateTime(c.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-slate-800">{value}</div>
    </div>
  );
}
