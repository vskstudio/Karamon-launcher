import { useEffect, useState } from 'preact/hooks';
import type { JavaCandidate } from '../../../ipc/contract';
import { reportResultMessage } from '../../features/reports/ReportMessages';
import { api } from '../../state/api';
import { config, system } from '../../state/config';
import { log } from '../../state/console';
import { navigate } from '../../state/navigation';
import { Button, Page, PageHeader, Panel, Stat, toast } from '../../ui';
import { formatGo, MIN_COMFORTABLE_MEMORY_MB, startupMemoryMb } from '../../state/memory';
import { BackupsPanel } from './BackupsPanel';
import { CrashesPanel } from './CrashesPanel';
import './tools.css';

type JavaState = { status: 'loading' } | { status: 'ready'; candidates: JavaCandidate[] } | { status: 'error' };

function JavaCard() {
  const [java, setJava] = useState<JavaState>({ status: 'loading' });

  useEffect(() => {
    api
      .listJava()
      .then((candidates) => setJava({ status: 'ready', candidates }))
      .catch(() => setJava({ status: 'error' }));
  }, []);

  const chosenPath = config.value?.javaPath ?? '';
  const candidates = java.status === 'ready' ? java.candidates : [];
  const chosen = chosenPath ? candidates.find((candidate) => candidate.path === chosenPath) : candidates[0];

  let value = '…';
  let hint = '';
  if (java.status === 'error') {
    value = 'Inconnu';
    hint = 'La recherche de Java a échoué.';
  } else if (java.status === 'ready' && chosenPath && !chosen) {
    value = 'Chemin personnalisé';
    hint = chosenPath;
  } else if (java.status === 'ready' && chosen) {
    value = `Java ${chosen.version}`;
    hint = chosenPath ? `${chosen.vendor}, choisi dans les réglages` : `${chosen.vendor}, détecté automatiquement`;
  } else if (java.status === 'ready') {
    value = 'Aucun Java détecté';
    hint = 'Installé automatiquement au lancement.';
  }

  return (
    <Panel padding="lg" class="tools__card">
      <Stat label="Java" value={value} hint={hint || undefined} tone={java.status === 'ready' && !chosen && !chosenPath ? 'warning' : 'default'} />
      <div class="tools__card-actions">
        <Button size="sm" onClick={() => navigate('settings', 'java')}>
          Changer
        </Button>
      </div>
    </Panel>
  );
}

function MemoryCard() {
  const current = config.value;
  const info = system.value;
  if (!current) {
    return (
      <Panel padding="lg" class="tools__card">
        <Stat label="Mémoire" value="…" />
      </Panel>
    );
  }
  const effective = startupMemoryMb(current, info);
  const capped = effective < current.memoryMb;
  const low = effective < MIN_COMFORTABLE_MEMORY_MB;
  const total = info ? ` sur ${formatGo(info.totalMemMb, 0)}` : '';
  const hint = low
    ? capped
      ? 'Limitée par le mode PC modeste, le pack risque de manquer de mémoire.'
      : 'Trop peu, le pack risque de manquer de mémoire.'
    : capped
      ? 'Limitée par le mode PC modeste.'
      : 'Confortable pour le pack.';

  return (
    <Panel padding="lg" class="tools__card">
      <Stat label="Mémoire" value={`${formatGo(effective)}${total}`} hint={hint} tone={low ? 'warning' : 'success'} />
      <div class="tools__card-actions">
        <Button size="sm" variant={low ? 'primary' : 'secondary'} onClick={() => navigate('settings', 'memory')}>
          Ajuster
        </Button>
      </div>
    </Panel>
  );
}

function DiagnosticCard() {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    try {
      const message = reportResultMessage(await api.sendManualReport());
      if (message) {
        setResult(message.text);
        toast(message.text, message.tone === 'ok' ? 'success' : 'info');
        log(message.text, message.tone === 'ok' ? 'success' : 'info');
      }
    } catch {
      setResult(null);
    } finally {
      setSending(false);
    }
  };

  return (
    <Panel padding="lg" class="tools__card">
      <Stat label="Diagnostic" value="Un souci ?" hint="Envoie tes logs à l'équipe Karamon, anonymisés, pour qu'on t'aide." />
      {result ? (
        <p class="tools__report-result" role="status">
          {result}
        </p>
      ) : null}
      <div class="tools__card-actions">
        <Button size="sm" loading={sending} onClick={() => void send()}>
          Envoyer mes logs
        </Button>
      </div>
    </Panel>
  );
}

export function ToolsPage() {
  return (
    <Page label="Outils" class="tools">
      <PageHeader
        eyebrow="Installation"
        title="Outils"
        description="Java, sauvegardes, crashs. Tout ce qu'il faut pour régler un souci sans ouvrir de ticket."
      />
      <div class="tools__cards">
        <JavaCard />
        <MemoryCard />
        <DiagnosticCard />
      </div>
      <div class="tools__columns">
        <CrashesPanel />
        <BackupsPanel />
      </div>
    </Page>
  );
}
