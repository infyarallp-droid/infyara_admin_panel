import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Spinner } from '../components/ui';

export default function Renewals() {
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery({
    queryKey: ['renewals-due', days],
    queryFn: async () => (await api.get('/api/enrollments/renewals-due', { params: { days } })).data,
    refetchInterval: 60_000,
  });

  const renew = useMutation({
    mutationFn: async (id: string) => (await api.post(`/api/enrollments/${id}/renew`, {})).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['renewals-due'] }),
  });

  const daysLeft = (end: string) => Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Renewals Due</h1>
          <p className="text-sm text-slate-500">Enrollments ending soon. (Auto WhatsApp reminders land in M7.)</p>
        </div>
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Next 7 days</option>
          <option value={15}>Next 15 days</option>
          <option value={30}>Next 30 days</option>
        </select>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : data?.enrollments?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="py-2 font-medium">Student</th>
                <th className="py-2 font-medium">Course</th>
                <th className="py-2 font-medium">Ends</th>
                <th className="py-2 font-medium">Days left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.enrollments.map((e: any) => {
                const left = daysLeft(e.endDate);
                return (
                  <tr key={e.id} className="border-b border-slate-50">
                    <td className="py-3">
                      <Link to={`/students/${e.studentId}`} className="font-medium text-brand hover:underline">
                        {e.student.fullName}
                      </Link>
                      <div className="text-xs text-slate-400">{e.student.mobile}</div>
                    </td>
                    <td className="py-3">
                      {e.coursePlan.course.name} — {e.coursePlan.title}
                    </td>
                    <td className="py-3">{e.endDate.slice(0, 10)}</td>
                    <td className="py-3">
                      <Badge tone={left <= 3 ? 'red' : left <= 7 ? 'amber' : 'slate'}>
                        {left < 0 ? 'expired' : `${left}d`}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <Button variant="ghost" onClick={() => renew.mutate(e.id)} disabled={renew.isPending}>
                        Renew
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="py-10 text-center text-slate-400">No renewals due in this window. 🎉</p>
        )}
      </Card>
    </div>
  );
}
