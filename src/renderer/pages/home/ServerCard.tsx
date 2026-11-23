import { useState } from 'preact/hooks';
import { config } from '../../state/config';
import { peakPlayers, playerHistory, serverPing, serverState } from '../../state/server';
import { Panel, Sparkline, Tag } from '../../ui';
import { KARAMON, serverAddress } from '../../../shared/Karamon';

export function ServerCard() {
  const [copied, setCopied] = useState(false);
  const ping = serverPing.value;
  const state = serverState.value;
  const server = config.value?.server;
  const address = serverAddress(server ?? KARAMON.server);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
  };

  return (
    <Panel
      variant="glass"
      title="Serveur"
      actions={
        <Tag tone={state === 'online' ? 'success' : state === 'offline' ? 'danger' : 'neutral'} dot>
          {state === 'online' ? 'En ligne' : state === 'offline' ? 'Hors ligne' : 'Vérification'}
        </Tag>
      }
    >
      <div class="server-card__count">
        <span class="server-card__players num">{ping?.online ? ping.players : '…'}</span>
        <span class="server-card__unit">joueurs</span>
        <span class="server-card__peak mono">pic : {peakPlayers.value}</span>
      </div>
      {playerHistory.value.length >= 2 ? (
        <Sparkline values={playerHistory.value} label="Joueurs connectés pendant cette session" height={40} />
      ) : null}
      <button type="button" class="server-card__address" onClick={() => void copyAddress()}>
        <span class="mono">{address}</span>
        <span class="server-card__copy">{copied ? 'Copiée' : 'Copier l’IP'}</span>
      </button>
    </Panel>
  );
}
