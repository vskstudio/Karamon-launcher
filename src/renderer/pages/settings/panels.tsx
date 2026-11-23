import { useEffect, useId, useState } from 'preact/hooks';
import type { UpdateCheckResult } from '../../../ipc/contract';
import { api } from '../../state/api';
import { system } from '../../state/config';
import { formatGo } from '../../state/memory';
import { pendingUpdate } from '../../state/notices';
import { refreshStats, resetStats, stats } from '../../state/stats';
import { activeTask, isBusy, repairInstall } from '../../state/tasks';
import { Button, cx, Panel, SettingRow, Stat, toast } from '../../ui';
import { ConfirmDialog } from '../../ui/components/ConfirmDialog';
import { formatDuration, formatNumber, formatShortDate } from '../../util/format';

function platformName(platform: string): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

export function SystemPanel() {
  const info = system.value;
  return (
    <Panel padding="lg" title="Ce PC">
      <div class="settings__stats">
        <Stat label="RAM" value={info ? formatGo(info.totalMemMb, 0) : '…'} />
        <Stat label="Processeur" value={info ? `${formatNumber(info.cpuCount)} threads` : '…'} />
        <Stat label="Système" value={info ? <span title={`${info.platform} ${info.arch}`}>{platformName(info.platform)}</span> : '…'} />
      </div>
    </Panel>
  );
}

export function ActivityPanel() {
  const [confirming, setConfirming] = useState(false);
  const played = stats.value;

  useEffect(() => {
    void refreshStats().catch(() => undefined);
  }, []);

  const reset = async () => {
    try {
      await resetStats();
      toast('Activité réinitialisée.');
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  return (
    <Panel
      padding="lg"
      title="Ton activité"
      actions={
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Réinitialiser
        </Button>
      }
    >
      <div class="settings__stats">
        <Stat label="Temps de jeu" value={played ? formatDuration(played.totalPlayMs) : '…'} />
        <Stat label="Sessions" value={played ? formatNumber(played.sessions) : '…'} />
        <Stat label="Première fois" value={played ? (played.firstPlayedAt ? formatShortDate(played.firstPlayedAt) : 'Jamais') : '…'} />
      </div>
      <ConfirmDialog
        open={confirming}
        title="Réinitialiser ton activité ?"
        description="Le temps de jeu et le nombre de sessions repartent de zéro."
        confirmLabel="Réinitialiser"
        danger
        onConfirm={reset}
        onClose={() => setConfirming(false)}
      />
    </Panel>
  );
}

type UpdateTone = 'default' | 'success' | 'danger';

interface UpdateView {
  text: string;
  tone: UpdateTone;
  installLabel: string | null;
}

function viewOfCheck(result: UpdateCheckResult): UpdateView {
  switch (result.status) {
    case 'no-update':
      return { text: `À jour, version ${result.currentVersion}.`, tone: 'success', installLabel: null };
    case 'downloading':
      return { text: `Version ${result.version} en cours de téléchargement.`, tone: 'default', installLabel: null };
    case 'downloaded':
      return { text: `Version ${result.version} prête.`, tone: 'success', installLabel: 'Redémarrer' };
    case 'available':
      return { text: `Version ${result.version} disponible, installe le .dmg de la dernière release.`, tone: 'default', installLabel: 'Télécharger' };
    case 'unsupported':
      return { text: 'Indisponible en mode développement.', tone: 'default', installLabel: null };
    case 'error':
      return { text: `Erreur : ${result.error}`, tone: 'danger', installLabel: null };
  }
}

export function VersionPanel() {
  const [checked, setChecked] = useState<UpdateView | null>(null);
  const [checking, setChecking] = useState(false);
  const statusId = useId();
  const info = system.value;
  const ready = pendingUpdate.value;

  const view: UpdateView =
    checked ??
    (ready
      ? viewOfCheck(ready.install === 'download' ? { status: 'available', version: ready.version } : { status: 'downloaded', version: ready.version })
      : { text: 'Vérifie si une nouvelle version existe.', tone: 'default', installLabel: null });

  const check = async () => {
    setChecking(true);
    try {
      setChecked(viewOfCheck(await api.checkForUpdate()));
    } catch (error) {
      setChecked({ text: `Erreur : ${error instanceof Error ? error.message : String(error)}`, tone: 'danger', installLabel: null });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Panel padding="lg" title="Version">
      <SettingRow
        title={info ? `Launcher ${info.appVersion}` : 'Launcher'}
        description={
          <span id={statusId} class={cx('settings__update', `settings__update--${view.tone}`)} role="status">
            {view.text}
          </span>
        }
        control={() =>
          view.installLabel ? (
            <Button variant="primary" describedBy={statusId} onClick={() => api.installUpdate()}>
              {view.installLabel}
            </Button>
          ) : (
            <Button glyph="refresh" loading={checking} describedBy={statusId} onClick={() => void check()}>
              Vérifier les mises à jour
            </Button>
          )
        }
      />
    </Panel>
  );
}

export function MaintenancePanel() {
  const task = activeTask.value;
  return (
    <Panel padding="lg" title="Maintenance">
      <SettingRow
        title="Réparer l'installation"
        description="Revérifie chaque fichier du pack, retélécharge ceux qui sont abîmés et répare les configs vides. Utile si le jeu plante au démarrage."
        control={({ descriptionId }) => (
          <Button
            loading={task === 'repair'}
            disabled={isBusy.value && task !== 'repair'}
            describedBy={descriptionId}
            onClick={() => void repairInstall()}
          >
            Réparer
          </Button>
        )}
      />
    </Panel>
  );
}
