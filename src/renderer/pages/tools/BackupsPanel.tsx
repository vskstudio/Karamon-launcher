import { useEffect, useState } from 'preact/hooks';
import type { BackupEntry } from '../../../ipc/contract';
import { api } from '../../state/api';
import { log } from '../../state/console';
import { Button, EmptyState, IconButton, Panel, PixelIcon, Spinner, toast } from '../../ui';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { formatDayTime, formatSize } from '../../util/format';

const KEPT_BACKUPS = 10;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BackupsPanel() {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BackupEntry | null>(null);

  const reload = async () => {
    try {
      setBackups((await api.listBackups()).backups);
    } catch (error) {
      setBackups([]);
      toast(errorText(error), 'error');
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      toast('Sauvegarde créée.');
      log('Sauvegarde créée.', 'success');
      await reload();
    } catch (error) {
      toast(errorText(error), 'error');
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      setBackups((await api.deleteBackup(deleting.name)).backups);
    } catch (error) {
      toast(errorText(error), 'error');
    }
  };

  return (
    <Panel
      padding="lg"
      title="Sauvegardes"
      actions={
        <Button size="sm" variant="primary" loading={creating} onClick={() => void create()}>
          Sauvegarder maintenant
        </Button>
      }
      class="tools__panel"
    >
      <p class="tools__panel-meta">Mondes et configs, les {KEPT_BACKUPS} plus récentes sont gardées.</p>
      {backups === null ? (
        <div class="tools__loading">
          <Spinner label="Chargement des sauvegardes" />
        </div>
      ) : backups.length === 0 ? (
        <EmptyState pixel="chest" title="Aucune sauvegarde">
          Utilise Sauvegarder maintenant pour protéger tes mondes.
        </EmptyState>
      ) : (
        <ul class="tools__list">
          {backups.map((backup) => (
            <li key={backup.name} class="tools__row">
              <PixelIcon name="chest" size={20} />
              <span class="tools__row-text">
                <span class="tools__row-title">{formatDayTime(backup.mtime)}</span>
                <span class="tools__row-sub">
                  <span class="mono">{backup.name}</span>, <span class="num">{formatSize(backup.size)}</span>
                </span>
              </span>
              <span class="tools__row-actions">
                <IconButton glyph="trash" size="sm" tone="danger" label="Supprimer la sauvegarde" onClick={() => setDeleting(backup)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="Supprimer la sauvegarde"
        description={deleting ? `${deleting.name} sera supprimée définitivement.` : ''}
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </Panel>
  );
}
