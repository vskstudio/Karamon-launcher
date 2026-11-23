import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ScreenshotEntry } from '../../../ipc/contract';
import { api } from '../../state/api';
import { EmptyState, Page, PageHeader, Segmented, Spinner, TextField, toast, type SegmentedItem } from '../../ui';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { dayLabel, formatNumber, formatSize, formatTime } from '../../util/format';
import { ScreenshotViewer } from './ScreenshotViewer';
import './captures.css';

type SortOrder = 'recent' | 'oldest';

interface DayGroup {
  key: string;
  label: string;
  items: ScreenshotEntry[];
}

const sortItems: readonly SegmentedItem<SortOrder>[] = [
  { value: 'recent', label: 'Plus récentes' },
  { value: 'oldest', label: 'Plus anciennes' },
];

function groupByDay(items: readonly ScreenshotEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const key = new Date(item.mtime).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.mtime), items: [item] });
  }
  return groups;
}

async function copyScreenshot(entry: ScreenshotEntry): Promise<void> {
  try {
    const blob = await fetch(entry.url).then((response) => response.blob());
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    toast('Capture copiée.');
  } catch {
    toast('Copie impossible.', 'error');
  }
}

export function CapturesPage() {
  const [shots, setShots] = useState<ScreenshotEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('recent');
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScreenshotEntry | null>(null);

  useEffect(() => {
    api
      .listScreenshots()
      .then((result) => setShots(result.screenshots))
      .catch(() => {
        setShots([]);
        toast('Impossible de charger les captures.', 'error');
      });
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const direction = sort === 'recent' ? -1 : 1;
    return (shots ?? []).filter((item) => item.name.toLowerCase().includes(needle)).sort((a, b) => (a.mtime - b.mtime) * direction);
  }, [shots, query, sort]);

  const groups = useMemo(() => groupByDay(visible), [visible]);
  const viewingIndex = viewing === null ? -1 : visible.findIndex((item) => item.name === viewing);

  const remove = async () => {
    if (!deleting) return;
    const position = visible.findIndex((item) => item.name === deleting.name);
    let next: ScreenshotEntry[];
    try {
      next = (await api.deleteScreenshot(deleting.name)).screenshots;
    } catch {
      toast('Suppression impossible.', 'error');
      return;
    }
    setShots(next);
    toast('Capture supprimée.');
    if (viewing === deleting.name) {
      const remaining = visible.filter((item) => item.name !== deleting.name && next.some((shot) => shot.name === item.name));
      setViewing(remaining[Math.min(position, remaining.length - 1)]?.name ?? null);
    }
  };

  const count = shots?.length ?? 0;
  const totalSize = (shots ?? []).reduce((sum, item) => sum + item.size, 0);
  const description =
    shots === null
      ? 'Tes captures F2, rangées par jour.'
      : count === 0
        ? 'Appuie sur F2 en jeu pour prendre une capture.'
        : `${formatNumber(count)} capture${count > 1 ? 's' : ''}, ${formatSize(totalSize)}. Clique pour agrandir, F2 en jeu pour en prendre une.`;

  return (
    <Page label="Captures" class="captures">
      <PageHeader eyebrow="Souvenirs" title="Captures d'écran" description={description} />
      {shots === null ? (
        <div class="captures__loading">
          <Spinner label="Chargement des captures" />
        </div>
      ) : count === 0 ? (
        <EmptyState pixel="compass" title="Aucune capture">
          Appuie sur F2 en jeu pour en prendre une.
        </EmptyState>
      ) : (
        <>
          <div class="captures__toolbar">
            <TextField
              type="search"
              label="Rechercher une capture"
              hideLabel
              placeholder="Rechercher une capture"
              value={query}
              onInput={setQuery}
              class="captures__search"
            />
            <Segmented items={sortItems} value={sort} onChange={setSort} label="Ordre des captures" size="sm" />
          </div>
          {visible.length === 0 ? (
            <EmptyState pixel="magnifier" title="Aucun résultat">
              Aucune capture ne correspond à ta recherche.
            </EmptyState>
          ) : (
            groups.map((group) => (
              <section key={group.key} class="captures__group" aria-label={group.label}>
                <h2 class="captures__day">
                  <span class="ui-eyebrow">{group.label}</span>
                  <span class="captures__count num">{formatNumber(group.items.length)}</span>
                </h2>
                <div class="captures__grid">
                  {group.items.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      class="captures__tile surface"
                      aria-label={`Capture de ${formatTime(item.mtime)}`}
                      title={item.name}
                      onClick={() => setViewing(item.name)}
                    >
                      <img src={item.url} alt="" loading="lazy" draggable={false} />
                      <span class="captures__time num" aria-hidden="true">
                        {formatTime(item.mtime)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
      <ScreenshotViewer
        entries={visible}
        index={viewingIndex >= 0 ? viewingIndex : null}
        onIndexChange={(index) => setViewing(visible[index]?.name ?? null)}
        onClose={() => setViewing(null)}
        onCopy={(entry) => void copyScreenshot(entry)}
        onDelete={setDeleting}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer la capture"
        description={deleting ? `${deleting.name} sera supprimée définitivement.` : ''}
        confirmLabel="Supprimer"
        danger
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </Page>
  );
}
