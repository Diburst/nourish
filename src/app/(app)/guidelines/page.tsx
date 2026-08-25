'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorText, Modal } from '@/components/ui';
import { useGuidelines, useNutrients, useApiMutation } from '@/hooks/useApi';
import { fetchApi, queryKeys } from '@/lib/apiClient';
import { formatRelative } from '@/lib/format';
import type { ApiGuidelineSection } from '@/types/api';

const invalidate = [['guidelines'], ['suggestions']];

export default function GuidelinesPage() {
  const { data } = useGuidelines();
  const [creating, setCreating] = useState(false);
  const sections = data?.sections ?? [];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Guidelines</h1>
        <button className="btn" onClick={() => setCreating(true)}>
          New section
        </button>
      </div>
      {sections.length === 0 && (
        <Card>
          <EmptyState>No guidelines yet — create a section like “Pantry Staples” or “Meal Ideas”.</EmptyState>
        </Card>
      )}
      {sections.map((s) => (
        <SectionCard key={s.slug} section={s} />
      ))}
      <CreateSectionModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function SectionCard({ section }: { section: ApiGuidelineSection }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <Card
      title={<span id={section.slug}>{section.title}</span>}
      action={
        <div className="flex gap-2 text-sm">
          <button className="text-muted underline hover:text-ink" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button className="text-muted underline hover:text-ink" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      }
    >
      {section.body ? (
        <div className="prose-guidelines">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
            {section.body}
          </ReactMarkdown>
        </div>
      ) : (
        <EmptyState>Empty section</EmptyState>
      )}
      {section.links.length > 0 && (
        <p className="mt-2 border-t border-hairline pt-2 text-xs text-muted">
          Linked: {section.links.map((l) => `${l.label} (${l.nutrients.join(', ')})`).join(' · ')}
        </p>
      )}
      {section.editedBy && section.editedAt && (
        <p className="mt-2 text-xs text-muted">
          edited by {section.editedBy} · {formatRelative(section.editedAt)}
        </p>
      )}
      {editing && <EditSectionModal section={section} onClose={() => setEditing(false)} />}
      {historyOpen && <HistoryModal section={section} onClose={() => setHistoryOpen(false)} />}
    </Card>
  );
}

function CreateSectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const create = useApiMutation(
    () =>
      fetchApi('/api/guidelines', {
        method: 'POST',
        json: {
          slug: title
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
          title,
          body: '',
        },
      }),
    invalidate
  );
  return (
    <Modal open={open} onClose={onClose} title="New section">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined as never, {
            onSuccess: () => {
              setTitle('');
              onClose();
            },
          });
        }}
        className="space-y-3"
      >
        <div>
          <label className="label" htmlFor="section-title">Title</label>
          <input id="section-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </div>
        <ErrorText error={create.error} />
        <button type="submit" className="btn-primary w-full" disabled={create.isPending}>
          Create
        </button>
      </form>
    </Modal>
  );
}

function EditSectionModal({ section, onClose }: { section: ApiGuidelineSection; onClose: () => void }) {
  const [body, setBody] = useState(section.body);
  const [links, setLinks] = useState(section.links);
  const [preview, setPreview] = useState(false);
  const { data: nutrientsData } = useNutrients();
  const micros = (nutrientsData?.nutrients ?? []).filter((n) => n.kind === 'MICRO');

  const save = useApiMutation(async () => {
    await fetchApi(`/api/guidelines/${section.slug}`, { method: 'PUT', json: { body } });
    await fetchApi(`/api/guidelines/${section.slug}/links`, { method: 'PUT', json: { links } });
  }, invalidate);

  return (
    <Modal open onClose={onClose} title={`Edit ${section.title}`}>
      <div className="space-y-3">
        <div className="flex gap-2 text-xs">
          <button className={`btn ${!preview ? 'bg-page' : ''}`} onClick={() => setPreview(false)}>
            Write
          </button>
          <button className={`btn ${preview ? 'bg-page' : ''}`} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
        {preview ? (
          <div className="prose-guidelines max-h-64 overflow-y-auto rounded border border-hairline p-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {body}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            className="input h-48 font-mono text-xs"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-label="Section body (Markdown)"
          />
        )}

        <div>
          <p className="label">Links (label → nutrients)</p>
          <div className="space-y-2">
            {links.map((link, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  className="input flex-1"
                  value={link.label}
                  onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
                  placeholder="Pumpkin seeds"
                />
                <select
                  multiple
                  className="input h-16 flex-1 text-xs"
                  value={link.nutrients}
                  onChange={(e) =>
                    setLinks(
                      links.map((l, j) =>
                        j === i
                          ? { ...l, nutrients: Array.from(e.target.selectedOptions).map((o) => o.value) }
                          : l
                      )
                    )
                  }
                >
                  {micros.map((n) => (
                    <option key={n.code} value={n.code}>
                      {n.displayName}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove link">
                  ✕
                </button>
              </div>
            ))}
            <button className="btn w-full" onClick={() => setLinks([...links, { label: '', nutrients: [] }])}>
              Add link
            </button>
          </div>
        </div>

        <ErrorText error={save.error} />
        <button
          className="btn-primary w-full"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(undefined as never, { onSuccess: onClose })
          }
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function HistoryModal({ section, onClose }: { section: ApiGuidelineSection; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: queryKeys.guidelineRevisions(section.slug),
    queryFn: () =>
      fetchApi<{ revisions: { id: string; body: string; editedBy: string | null; createdAt: string }[] }>(
        `/api/guidelines/${section.slug}/revisions`
      ),
  });
  const revert = useApiMutation(
    (revisionId: string) =>
      fetchApi(`/api/guidelines/${section.slug}/revisions/${revisionId}/revert`, { method: 'POST' }),
    [...invalidate, ['guidelines', section.slug, 'revisions']]
  );
  return (
    <Modal open onClose={onClose} title={`History — ${section.title}`}>
      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {(data?.revisions ?? []).map((r, i) => (
          <li key={r.id} className="flex items-center justify-between rounded border border-hairline p-2 text-sm">
            <span>
              {r.editedBy ?? 'unknown'} <span className="text-muted">· {formatRelative(r.createdAt)}</span>
              {i === 0 && <span className="ml-1 text-xs text-muted">(current)</span>}
            </span>
            {i > 0 && (
              <button className="btn" disabled={revert.isPending} onClick={() => revert.mutate(r.id, { onSuccess: onClose })}>
                Revert
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
