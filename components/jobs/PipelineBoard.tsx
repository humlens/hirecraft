import { Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { usePipeline } from 'hooks/usePipeline';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

/**
 * Kanban board. Cards can be dragged between columns with the mouse, or moved
 * with the "Move to" select on every card (keyboard / touch alternative).
 * Several cards can be selected and moved together (bulk action).
 */
const PipelineBoard = ({ slug, jobId }: { slug: string; jobId: string }) => {
  const { t } = useTranslation('common');
  const { isLoading, isError, pipeline, mutatePipeline } = usePipeline(
    slug,
    jobId
  );
  const { can } = usePortalAccess(slug);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState<string | null>(null);

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  if (!pipeline) {
    return null;
  }

  const canMove = can('applications.manage');
  const movable = pipeline.stages.filter((s) => s.kind !== 'WITHDRAWN');

  const move = async (ids: string[], stageId: string) => {
    if (!ids.length) {
      return;
    }

    let reason: string | undefined;
    const target = pipeline.stages.find((s) => s.id === stageId);

    if (target?.kind === 'REJECTED') {
      reason =
        window.prompt(
          t('rejection-reason', 'Reason for rejection (optional)')
        ) ?? undefined;
    }

    const r = await fetch(`/api/teams/${slug}/applications/stage`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify(
        ids.length === 1
          ? { applicationId: ids[0], stageId, rejectionReason: reason }
          : { applicationIds: ids, stageId, rejectionReason: reason }
      ),
    });
    const json = (await r.json()) as ApiResponse<{
      results?: { ok: boolean; error?: string }[];
    }>;

    if (!r.ok) {
      toast.error(json.error.message);
    } else {
      const failed = json.data?.results?.filter((x) => !x.ok) ?? [];

      if (failed.length) {
        toast.error(
          failed[0].error ??
            t('some-moves-failed', 'Some applications could not be moved.')
        );
      } else {
        toast.success(t('application-moved', 'Moved.'));
      }
    }

    setSelected([]);
    mutatePipeline();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-medium">{pipeline.job.title}</h2>
        <Link className="link text-sm" href={`/teams/${slug}/jobs/${jobId}`}>
          {t('edit-job', 'Edit job')}
        </Link>
        {canMove && selected.length > 0 && (
          <span className="ml-auto flex items-center gap-2 text-sm">
            {selected.length} {t('selected', 'selected')}
            <select
              className="select  select-sm"
              aria-label={t('bulk-move', 'Move selected to')}
              defaultValue=""
              onChange={(e) => e.target.value && move(selected, e.target.value)}
            >
              <option value="" disabled>
                {t('bulk-move', 'Move selected to')}
              </option>
              {movable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {pipeline.stages.map((stage) => {
          const cards = pipeline.applications.filter(
            (a) => a.stageId === stage.id
          );

          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              data-stage={stage.name}
              className={`w-64 shrink-0 rounded border p-2 ${
                dragOver === stage.id ? 'border-primary bg-base-200' : ''
              }`}
              onDragOver={(e) => {
                if (canMove && stage.kind !== 'WITHDRAWN') {
                  e.preventDefault();
                  setDragOver(stage.id);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);

                const id = e.dataTransfer.getData('text/plain');

                if (id && canMove && stage.kind !== 'WITHDRAWN') {
                  move([id], stage.id);
                }
              }}
            >
              <h3 className="mb-2 flex justify-between text-sm font-semibold">
                <span>{stage.name}</span>
                <span className="badge badge-sm">{cards.length}</span>
              </h3>
              <ul className="space-y-2">
                {cards.map((a) => (
                  <li
                    key={a.id}
                    draggable={canMove && !a.withdrawnAt}
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', a.id)
                    }
                    className="rounded border bg-base-100 p-2 text-sm shadow-sm"
                  >
                    <div className="flex items-start gap-2">
                      {canMove && !a.withdrawnAt && (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs mt-1"
                          aria-label={`select ${a.candidate.name}`}
                          checked={selected.includes(a.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, a.id]
                                : selected.filter((x) => x !== a.id)
                            )
                          }
                        />
                      )}
                      <Link
                        className="link font-medium"
                        href={`/teams/${slug}/applications/${a.id}`}
                      >
                        {a.candidate.name}
                      </Link>
                    </div>
                    <div className="truncate text-xs opacity-60">
                      {a.candidate.email}
                    </div>
                    {canMove && !a.withdrawnAt && (
                      <select
                        className="select  select-xs mt-2 w-full"
                        aria-label={`Move ${a.candidate.name} to`}
                        value=""
                        onChange={(e) =>
                          e.target.value && move([a.id], e.target.value)
                        }
                      >
                        <option value="" disabled>
                          {t('move-to', 'Move to...')}
                        </option>
                        {movable
                          .filter((s) => s.id !== stage.id)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default PipelineBoard;
