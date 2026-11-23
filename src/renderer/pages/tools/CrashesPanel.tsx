import { useEffect, useState } from 'preact/hooks';
import type { CrashReport } from '../../../ipc/contract';
import { api } from '../../state/api';
import { crashReports, deleteCrash, isOutOfMemory, latestCrashIsOutOfMemory, recentCrashCount, refreshCrashes } from '../../state/crashes';
import { navigate } from '../../state/navigation';
import { Banner, Button, Dialog, EmptyState, Glyph, IconButton, Panel, Spinner, Tag, toast } from '../../ui';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { formatDayTime, formatNumber, formatShortDate } from '../../util/format';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function copyCrash(report: CrashReport): Promise<void> {
  try {
    await api.copyCrash(report.name);
    toast('Rapport copié, colle-le sur Discord.');
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

async function revealCrash(report: CrashReport): Promise<void> {
  try {
    await api.revealCrash(report.name);
  } catch (error) {
    toast(errorText(error), 'error');
  }
}

type CrashContent = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error' };

function CrashViewer({ report, onClose }: { report: CrashReport | null; onClose: () => void }) {
  const [content, setContent] = useState<CrashContent>({ status: 'loading' });

  useEffect(() => {
    if (!report) return;
    let alive = true;
    setContent({ status: 'loading' });
    api
      .readCrash(report.name)
      .then((text) => {
        if (alive) setContent({ status: 'ready', text });
      })
      .catch(() => {
        if (alive) setContent({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [report?.name]);

  const text = content.status === 'ready' ? content.text : report?.excerpt ?? '';

  return (
    <Dialog
      open={report !== null}
      onClose={onClose}
      size="lg"
      title={report?.summary ?? ''}
      description={report ? `${report.name}, ${formatDayTime(report.mtime)}` : undefined}
      footer={
        report ? (
          <>
            <Button glyph="copy" onClick={() => void copyCrash(report)}>
              Copier
            </Button>
            <Button glyph="folder" onClick={() => void revealCrash(report)}>
              Afficher le fichier
            </Button>
            <Button variant="primary" onClick={onClose}>
              Fermer
            </Button>
          </>
        ) : null
      }
    >
      {content.status === 'loading' ? (
        <div class="tools__crash-loading">
          <Spinner size={14} />
          <span>Chargement du rapport complet…</span>
        </div>
      ) : null}
      {content.status === 'error' ? <p class="tools__crash-error">Rapport complet illisible, voici l'extrait.</p> : null}
      <pre class="tools__crash-text mono selectable" tabIndex={0} aria-label="Contenu du rapport">
        {text}
      </pre>
    </Dialog>
  );
}

function CrashRow({ report, onOpen, onDelete }: { report: CrashReport; onOpen: () => void; onDelete: () => void }) {
  const memory = isOutOfMemory(report);
  return (
    <li class="tools__row">
      <span class={memory ? 'tools__row-icon tools__row-icon--warning' : 'tools__row-icon'} aria-hidden="true">
        <Glyph name="warning" size={16} />
      </span>
      <span class="tools__row-text">
        <span class="tools__row-title">{report.summary}</span>
        <span class="tools__row-sub">
          <span class="num">{formatShortDate(report.mtime)}</span>, <span class="mono">{report.name}</span>
        </span>
      </span>
      <span class="tools__row-actions">
        <Button size="sm" onClick={onOpen}>
          Voir
        </Button>
        <IconButton glyph="copy" size="sm" label="Copier le rapport" onClick={() => void copyCrash(report)} />
        <IconButton glyph="folder" size="sm" label="Afficher le fichier" onClick={() => void revealCrash(report)} />
        <IconButton glyph="trash" size="sm" tone="danger" label="Supprimer le rapport" onClick={onDelete} />
      </span>
    </li>
  );
}

export function CrashesPanel() {
  const [viewing, setViewing] = useState<CrashReport | null>(null);
  const [deleting, setDeleting] = useState<CrashReport | null>(null);
  const reports = crashReports.value;
  const recent = recentCrashCount.value;

  useEffect(() => {
    refreshCrashes().catch((error: unknown) => toast(errorText(error), 'error'));
  }, []);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteCrash(deleting.name);
    } catch (error) {
      toast(errorText(error), 'error');
    }
  };

  return (
    <Panel
      padding="lg"
      title="Rapports de crash"
      actions={recent > 0 ? <Tag tone="warning">{recent === 1 ? '1 récent' : `${formatNumber(recent)} récents`}</Tag> : null}
      class="tools__panel"
    >
      {latestCrashIsOutOfMemory.value ? (
        <Banner
          pixel="lightning"
          tone="warning"
          actions={
            <Button size="sm" variant="primary" onClick={() => navigate('settings', 'memory')}>
              Ouvrir les réglages
            </Button>
          }
        >
          Le dernier crash vient d’un manque de mémoire. Augmente la RAM allouée.
        </Banner>
      ) : null}
      {reports === null ? (
        <div class="tools__loading">
          <Spinner label="Chargement des rapports" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState pixel="shield" title="Aucun crash détecté">
          Les rapports du jeu apparaîtront ici en cas de problème.
        </EmptyState>
      ) : (
        <ul class="tools__list">
          {reports.map((report) => (
            <CrashRow key={report.name} report={report} onOpen={() => setViewing(report)} onDelete={() => setDeleting(report)} />
          ))}
        </ul>
      )}
      <CrashViewer report={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer le rapport"
        description={deleting ? `${deleting.name} sera supprimé définitivement.` : ''}
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </Panel>
  );
}
