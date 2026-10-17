import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../../lib/api';
import { Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useFeedback } from '../../components/ui';
import { RowActions, StatusBadge, useCollectionActions, type PublishStatus } from './shared';

interface Faq {
  id: string;
  question: string;
  answer: string;
  page: 'HOME' | 'CLASSES' | 'TRAINING' | 'CONTACT';
  status: PublishStatus;
}
const PAGES = { HOME: 'Home page', CLASSES: 'Classes page', TRAINING: 'Teacher training page', CONTACT: 'Contact page' } as const;

export default function Faqs() {
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const [page, setPage] = useState<keyof typeof PAGES>('HOME');
  const { data, isLoading } = useQuery({ queryKey: ['cms', 'faqs'], queryFn: async () => (await api.get('/api/cms/faqs?includeArchived=true')).data });
  const actions = useCollectionActions('faqs');
  const items: Faq[] = (data?.items ?? []).filter((f: Faq) => f.page === page);

  return (
    <div className="space-y-6">
      <PageHeader title="FAQs" subtitle="Questions and answers shown on the website. Reorder with the arrows; drafts stay hidden." actions={<Button onClick={() => setEditing('new')}>+ Add question</Button>} />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PAGES) as (keyof typeof PAGES)[]).map((p) => (
          <Button key={p} variant={p === page ? 'primary' : 'ghost'} onClick={() => setPage(p)}>
            {PAGES[p]} <Badge>{(data?.items ?? []).filter((f: Faq) => f.page === p && f.status !== 'ARCHIVED').length}</Badge>
          </Button>
        ))}
      </div>
      <Card>
        {isLoading ? (
          <Loading />
        ) : !items.length ? (
          <EmptyState title={`No FAQs on the ${PAGES[page].toLowerCase()}`} action={<Button onClick={() => setEditing('new')}>Add a question</Button>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((f, i) => (
              <li key={f.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {f.question} <StatusBadge status={f.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-500">{f.answer}</p>
                </div>
                <RowActions
                  status={f.status}
                  index={i}
                  count={items.length}
                  onMove={(d) => actions.move(items.map((x) => x.id), i, d)}
                  onStatus={(s) => actions.setStatus(f.id, s)}
                  onEdit={() => setEditing(f)}
                  onDelete={() => actions.remove(f.id, 'this question')}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <FaqForm item={editing === 'new' ? null : editing} defaultPage={page} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FaqForm({ item, defaultPage, onClose }: { item: Faq | null; defaultPage: Faq['page']; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [form, setForm] = useState({ question: item?.question ?? '', answer: item?.answer ?? '', page: item?.page ?? defaultPage, status: item?.status ?? ('PUBLISHED' as PublishStatus) });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => (item ? (await api.put(`/api/cms/faqs/${item.id}`, form)).data : (await api.post('/api/cms/faqs', form)).data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'faqs'] });
      toast('Saved');
      onClose();
    },
    onError: async (e) => setError(await apiError(e)),
  });
  return (
    <Modal
      title={item ? 'Edit question' : 'Add question'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || form.question.length < 5 || form.answer.length < 5} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Question">
          <Input value={form.question} maxLength={200} onChange={(e) => setForm({ ...form, question: e.target.value })} />
        </Field>
        <Field label="Answer" hint={`${form.answer.length}/2000`}>
          <Textarea value={form.answer} maxLength={2000} rows={5} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Show on">
            <Select value={form.page} onChange={(e) => setForm({ ...form, page: e.target.value as Faq['page'] })}>
              {Object.entries(PAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Visibility">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublishStatus })}>
              <option value="PUBLISHED">Published</option>
              <option value="DRAFT">Draft</option>
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
