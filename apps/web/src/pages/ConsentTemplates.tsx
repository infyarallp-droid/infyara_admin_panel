import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, Button, Card, Field, Input, Spinner } from '../components/ui';

/** Editable default content for the consent form. Saving creates a new version;
 *  past finalized forms keep their snapshot, so nothing already signed changes. */
export default function ConsentTemplates() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['consent-templates'],
    queryFn: async () => (await api.get('/api/consent/templates')).data,
  });

  const [title, setTitle] = useState('Student Consent, Risk Acknowledgement & Code of Conduct');
  const [health, setHealth] = useState('');
  const [safety, setSafety] = useState('');
  const [policies, setPolicies] = useState('');
  const [conduct, setConduct] = useState('');
  const [final, setFinal] = useState('');
  const [msg, setMsg] = useState('');

  const active = data?.templates?.find((t: any) => t.isActive);

  // Prefill the editor from the active template.
  useEffect(() => {
    if (!active) return;
    const s = active.sections;
    setTitle(active.title);
    setHealth((s.healthOptions ?? []).map((o: any) => o.label).join('\n'));
    setSafety((s.clauses?.safety ?? []).join('\n'));
    setPolicies((s.clauses?.policies ?? []).join('\n'));
    setConduct((s.clauses?.conduct ?? []).join('\n'));
    setFinal((s.clauses?.final ?? []).join('\n'));
  }, [active?.id]);

  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
  const slug = (l: string) => l.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.post('/api/consent/templates', {
          title,
          sections: {
            healthOptions: lines(health).map((label) => ({ key: slug(label), label })),
            clauses: {
              safety: lines(safety),
              policies: lines(policies),
              conduct: lines(conduct),
              final: lines(final),
            },
          },
          activate: true,
        })
      ).data,
    onSuccess: () => {
      setMsg('New version saved and activated.');
      qc.invalidateQueries({ queryKey: ['consent-templates'] });
    },
    onError: (e: any) => setMsg(e.response?.data?.error ?? 'Save failed'),
  });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Consent Templates</h1>
        <p className="text-sm text-slate-500">
          Edit the default consent content. Saving creates a new version; already-signed forms keep their
          original text.
        </p>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-semibold">Versions</h3>
        </div>
        <ul className="space-y-1 text-sm">
          {data?.templates?.map((t: any) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="text-slate-400">v{t.version}</span>
              {t.title}
              {t.isActive && <Badge tone="green">Active</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-semibold">Edit content (one item per line)</h3>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Editor label="Health declaration options" value={health} onChange={setHealth} />
        <Editor label="Section 2 — Consent & Safety clauses" value={safety} onChange={setSafety} />
        <Editor label="Section 3 — Studio Policies clauses" value={policies} onChange={setPolicies} />
        <Editor label="Section 4 — Code of Conduct clauses" value={conduct} onChange={setConduct} />
        <Editor label="Section 5 — Final Acknowledgement clauses" value={final} onChange={setFinal} />
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save as new active version'}
          </Button>
          {msg && <span className="text-sm text-slate-500">{msg}</span>}
        </div>
      </Card>
    </div>
  );
}

function Editor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
    </label>
  );
}
