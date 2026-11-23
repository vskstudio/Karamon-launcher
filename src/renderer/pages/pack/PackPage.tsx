import { useEffect, useId, useState } from 'preact/hooks';
import type { ModsListResult } from '../../../ipc/contract';
import { api } from '../../state/api';
import { loadPackInfo, packInfo } from '../../state/content';
import { activeTask, isBusy, onTaskCompleted, repairInstall, syncPack } from '../../state/tasks';
import { Button, EmptyState, Page, PageHeader, Panel, Spinner, Stat, Tag, TextField, toast } from '../../ui';
import { formatNumber, formatSize } from '../../util/format';
import { modDisplayName, modInitial } from './modNames';
import './pack.css';

type ModsState = { status: 'loading' } | { status: 'ready'; data: ModsListResult } | { status: 'error' };

function useMods(): ModsState {
  const [state, setState] = useState<ModsState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .listMods()
        .then((data) => {
          if (alive) setState({ status: 'ready', data });
        })
        .catch(() => {
          if (alive) setState({ status: 'error' });
        });
    };
    load();
    const stop = onTaskCompleted((kind) => {
      if (kind === 'sync' || kind === 'repair' || kind === 'play') load();
      if (kind === 'sync' || kind === 'repair') void loadPackInfo();
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return state;
}

function PackStats({ mods }: { mods: ModsState }) {
  const info = packInfo.value;
  const list = mods.status === 'ready' ? mods.data.mods : null;
  const disabled = list?.filter((mod) => mod.disabled).length ?? null;
  const total = list?.reduce((sum, mod) => sum + mod.size, 0) ?? null;

  return (
    <div class="pack__stats">
      <Panel padding="lg">
        <Stat
          label="Version du pack"
          value={info?.version ?? '…'}
          hint={info?.upToDate === true ? 'À jour' : info?.upToDate === false ? 'Mise à jour disponible' : undefined}
          tone={info?.upToDate === false ? 'warning' : 'success'}
        />
      </Panel>
      <Panel padding="lg">
        <Stat label="Mods" value={list ? formatNumber(list.length) : '…'} hint={info ? `Minecraft ${info.minecraft}` : undefined} />
      </Panel>
      <Panel padding="lg">
        <Stat label="Désactivés" value={disabled === null ? '…' : formatNumber(disabled)} hint="En mode PC modeste" />
      </Panel>
      <Panel padding="lg">
        <Stat label="Taille" value={total === null ? '…' : formatSize(total)} hint="Mods installés" />
      </Panel>
    </div>
  );
}

function ModList({ mods, query }: { mods: ModsState; query: string }) {
  if (mods.status === 'loading') {
    return (
      <div class="pack__loading">
        <Spinner label="Chargement des mods" />
      </div>
    );
  }
  if (mods.status === 'error') {
    return <EmptyState pixel="chest" title="Liste indisponible">Impossible de lire le dossier des mods.</EmptyState>;
  }

  const sorted = [...mods.data.mods].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (sorted.length === 0) {
    return (
      <EmptyState
        pixel="chest"
        title="Aucun mod installé"
        actions={
          <Button variant="primary" loading={activeTask.value === 'sync'} disabled={isBusy.value} onClick={() => void syncPack()}>
            Synchroniser
          </Button>
        }
      >
        Synchronise le pack pour télécharger les mods du serveur.
      </EmptyState>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? sorted.filter((mod) => mod.name.toLowerCase().includes(needle) || modDisplayName(mod.name).toLowerCase().includes(needle))
    : sorted;
  if (visible.length === 0) {
    return (
      <EmptyState pixel="magnifier" title="Aucun résultat">
        Aucun mod ne contient « {query.trim()} ».
      </EmptyState>
    );
  }

  return (
    <ul class="pack__list">
      {visible.map((mod) => (
        <li key={mod.name} class="pack__mod">
          <span class="pack__initial" aria-hidden="true">
            {modInitial(mod.name)}
          </span>
          <span class="pack__mod-text">
            <span class="pack__mod-name">{modDisplayName(mod.name)}</span>
            <span class="pack__mod-file mono">{mod.name}</span>
          </span>
          {mod.disabled ? <Tag tone="warning">Désactivé en mode PC modeste</Tag> : null}
          <span class="pack__mod-size num">{formatSize(mod.size)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PackPage() {
  const mods = useMods();
  const [query, setQuery] = useState('');
  const repairNoteId = useId();
  const task = activeTask.value;
  const busy = isBusy.value;
  const info = packInfo.value;

  useEffect(() => {
    void loadPackInfo();
  }, []);

  const openFolder = () => {
    api.openInstance().catch(() => toast('Impossible d’ouvrir le dossier.', 'error'));
  };

  const count = mods.status === 'ready' ? mods.data.mods.length : null;

  return (
    <Page label="Modpack" class="pack">
      <PageHeader
        eyebrow="Installation"
        title="Modpack"
        description={
          info?.baseName
            ? `Basé sur ${info.baseName}, avec les mods Karamon et les configs du serveur.`
            : 'Les mods du serveur, synchronisés avec Karamon.'
        }
        actions={
          <>
            <Button glyph="folder" onClick={openFolder}>
              Ouvrir le dossier
            </Button>
            <Button
              loading={task === 'repair'}
              disabled={busy && task !== 'repair'}
              describedBy={repairNoteId}
              onClick={() => void repairInstall()}
            >
              Réparer
            </Button>
            <Button variant="primary" glyph="refresh" loading={task === 'sync'} disabled={busy && task !== 'sync'} onClick={() => void syncPack()}>
              Synchroniser
            </Button>
          </>
        }
      />
      <PackStats mods={mods} />
      <Panel
        padding="lg"
        title={count === null ? 'Mods' : `Mods (${formatNumber(count)})`}
        actions={
          <TextField
            type="search"
            label="Chercher un mod"
            hideLabel
            placeholder="Chercher un mod"
            value={query}
            onInput={setQuery}
            class="pack__search"
          />
        }
      >
        <ModList mods={mods} query={query} />
        <footer class="pack__foot">
          <p id={repairNoteId} class="pack__note">
            Réparer retélécharge les fichiers du pack manquants ou abîmés. Tes mondes ne sont pas touchés.
          </p>
          {mods.status === 'ready' ? (
            <p class="pack__dir mono" title={mods.data.dir}>
              {mods.data.dir}
            </p>
          ) : null}
        </footer>
      </Panel>
    </Page>
  );
}
