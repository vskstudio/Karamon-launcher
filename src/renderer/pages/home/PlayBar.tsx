import { config } from '../../state/config';
import { lastStatus } from '../../state/console';
import { activeAccount } from '../../state/session';
import { stats } from '../../state/stats';
import { activeTask, gameRunning, play, taskProgress } from '../../state/tasks';
import { cx, Glyph, ProgressBar, Spinner, Stat, StatusDot } from '../../ui';
import { formatDuration, formatRelative } from '../../util/format';

const taskLabels = {
  play: 'Lancement',
  sync: 'Synchronisation',
  repair: 'Réparation',
  login: 'Connexion',
} as const;

function PlayButton() {
  const task = activeTask.value;
  const running = gameRunning.value;
  const signedIn = activeAccount.value !== null;

  if (task) {
    return (
      <button type="button" class="play-button is-busy" disabled aria-busy="true">
        <Spinner size={22} />
        <span class="num">{task === 'play' || task === 'sync' ? `${taskProgress.value} %` : taskLabels[task]}</span>
      </button>
    );
  }

  return (
    <button type="button" class={cx('play-button', running && 'is-running')} onClick={() => void play()}>
      {running ? null : <Glyph name="play" size={24} />}
      <span class="play-button__label">{!signedIn ? 'SE CONNECTER' : running ? 'EN JEU' : 'JOUER'}</span>
      {running ? <span class="play-button__sub">Lancer un autre compte</span> : null}
    </button>
  );
}

function Activity() {
  const task = activeTask.value;
  if (task) {
    return (
      <div class="play-bar__progress">
        <div class="play-bar__status">
          <span>{lastStatus.value || `${taskLabels[task]} en cours…`}</span>
          <span class="mono">{taskProgress.value} %</span>
        </div>
        <ProgressBar value={taskProgress.value} label={`${taskLabels[task]} en cours`} />
      </div>
    );
  }
  if (gameRunning.value) {
    return (
      <div class="play-bar__running">
        <StatusDot tone="success" />
        Minecraft tourne. Le launcher attend dans la zone de notification.
      </div>
    );
  }
  const played = stats.value;
  const memoryMb = config.value?.memoryMb;
  return (
    <div class="play-bar__stats">
      <Stat label="Temps de jeu" value={played ? formatDuration(played.totalPlayMs) : '…'} />
      <Stat label="Dernière session" value={played ? formatRelative(played.lastPlayedAt) : '…'} />
      <Stat label="Mémoire" value={memoryMb ? `${Math.round(memoryMb / 1024)} Go` : '…'} />
    </div>
  );
}

export function PlayBar() {
  return (
    <footer class="play-bar">
      <div class="play-bar__inner">
        <div class="play-bar__activity">
          <Activity />
        </div>
        <PlayButton />
      </div>
    </footer>
  );
}
