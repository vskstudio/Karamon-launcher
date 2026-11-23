import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { JavaCandidate, SystemInfo } from '../../../ipc/contract';
import { api } from '../../state/api';
import {
  formatGo,
  MEMORY_STEP_MB,
  memoryMaxMb,
  memoryVerdict,
  MIN_COMFORTABLE_MEMORY_MB,
  MIN_MEMORY_MB,
  potatoMemoryNote,
  RECOMMENDED_MAX_MB,
} from '../../state/memory';
import type { BooleanSettingKey, SettingsDraft } from '../../state/settings';
import { cx, IconButton, Segmented, SettingRow, Slider, Spinner, Switch, Tag, TextField, toast, type SegmentedItem } from '../../ui';
import { Select, type SelectItem } from '../../ui/components/Select';
import { jvmPresets, presetForArgs, type JvmPresetId } from './jvmPresets';

export interface FieldContext {
  draft: SettingsDraft;
  system: SystemInfo | null;
  edit: <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => void;
}

export type SettingField =
  | { kind: 'memory'; key: 'memoryMb' }
  | { kind: 'secondMemory'; key: 'secondInstanceMemoryMb' }
  | { kind: 'jvm'; key: 'jvmArgs' }
  | { kind: 'java'; key: 'javaPath' }
  | { kind: 'folder'; key: 'mcGameDir'; title: string; hint: string; placeholder: string }
  | { kind: 'switch'; key: BooleanSettingKey; title: string; description: ComponentChildren; details?: (context: FieldContext) => ComponentChildren };

export interface SettingSection {
  id: string;
  title: string;
  column: 'main' | 'side';
  aside?: (context: FieldContext) => ComponentChildren;
  fields: readonly SettingField[];
}

function PotatoAside({ system }: FieldContext) {
  if (!system || system.lowEndReasons.length === 0) return null;
  return <Tag tone="warning">Conseillé pour ce PC</Tag>;
}

function PotatoDetails({ system }: FieldContext) {
  return (
    <div class="settings__details">
      {system && system.lowEndReasons.length > 0 ? (
        <p class="settings__reasons">Conseillé parce que ton PC a : {system.lowEndReasons.join(', ')}.</p>
      ) : null}
      <ul class="settings__list">
        <li>Shaders coupés à chaque lancement. Tu peux les rallumer en jeu, ton shader reste sélectionné.</li>
        <li>
          Graphismes au minimum : distance de rendu 6 et simulation 5 (comme le serveur), mode rapide, sans nuages, ombres ni flou des
          menus, particules minimales, feuilles rapides. Un réglage déjà plus bas n’est jamais remonté.
        </li>
        <li>
          Mods visuels lourds désactivés : Voxy (vue lointaine), Particular, Particle Rain et Sound Physics. Ils ne servent qu’à
          l’affichage et au son, le serveur ne les demande pas.
        </li>
        {system ? <li>{potatoMemoryNote(system)}</li> : null}
      </ul>
    </div>
  );
}

export const settingSections: readonly SettingSection[] = [
  {
    id: 'memory',
    column: 'main',
    title: 'Mémoire',
    fields: [
      { kind: 'memory', key: 'memoryMb' },
      { kind: 'secondMemory', key: 'secondInstanceMemoryMb' },
      { kind: 'jvm', key: 'jvmArgs' },
    ],
  },
  {
    id: 'potato',
    column: 'main',
    title: 'Mode PC modeste',
    aside: PotatoAside,
    fields: [
      {
        kind: 'switch',
        key: 'potatoMode',
        title: 'Activer le mode PC modeste',
        description: 'Pour les petites configs. Quand tu le coupes, tes réglages et les mods reviennent comme avant.',
        details: PotatoDetails,
      },
    ],
  },
  {
    id: 'game',
    column: 'main',
    title: 'Jeu',
    fields: [
      {
        kind: 'switch',
        key: 'disableSodium',
        title: 'Désactiver Sodium',
        description:
          "Si le jeu plante ou reste bloqué au démarrage. Coupe aussi Iris (plus de shaders), Voxy (plus de terrain lointain), Sodium Extra et Reese's Sodium Options, donc moins de FPS. Pris en compte au prochain lancement, décoche pour tout remettre.",
      },
      {
        kind: 'switch',
        key: 'closeLauncherOnGameStart',
        title: 'Fermer le launcher au lancement du jeu',
        description: 'Il se rouvre quand tu quittes Minecraft.',
      },
    ],
  },
  {
    id: 'java',
    column: 'side',
    title: 'Java et dossiers',
    fields: [
      { kind: 'java', key: 'javaPath' },
      {
        kind: 'folder',
        key: 'mcGameDir',
        title: 'Dossier du jeu',
        hint: 'Laisse vide pour utiliser le dossier du launcher.',
        placeholder: 'Dossier du launcher (par défaut)',
      },
    ],
  },
  {
    id: 'launcher',
    column: 'side',
    title: 'Launcher',
    fields: [
      {
        kind: 'switch',
        key: 'autoSendReports',
        title: 'Envoyer automatiquement les rapports de problème',
        description:
          "Après un crash ou un échec de lancement, les logs anonymisés partent à l'équipe Karamon sans te le demander. Décoché, le launcher te pose la question à chaque fois.",
      },
      {
        kind: 'switch',
        key: 'devMode',
        title: 'Mode développement',
        description: (
          <>
            Affiche « Serveurs (dev) » sur l’écran titre pour rejoindre un serveur local. Aussi avec <code class="mono">--dev</code>.
          </>
        ),
      },
    ],
  },
];

function MemoryField({ draft, system, edit }: FieldContext) {
  const max = memoryMaxMb(system?.totalMemMb);
  const verdict = memoryVerdict(draft.memoryMb, system, draft.potatoMode);
  return (
    <div class="settings__block">
      <div class="settings__block-head">
        <span class="settings__block-title">Mémoire allouée</span>
        <Tag tone={verdict.tone}>{verdict.label}</Tag>
      </div>
      <div class="settings__memory">
        <span class="settings__memory-value num">{formatGo(draft.memoryMb)}</span>
        {system ? <span class="settings__memory-total num">sur {formatGo(system.totalMemMb, 0)} de RAM</span> : null}
      </div>
      <div class="settings__slider">
        <Slider
          value={draft.memoryMb}
          min={MIN_MEMORY_MB}
          max={max}
          step={MEMORY_STEP_MB}
          label="Mémoire allouée"
          format={(value) => formatGo(value)}
          marks={[MIN_COMFORTABLE_MEMORY_MB, RECOMMENDED_MAX_MB]}
          onChange={(value) => edit('memoryMb', value)}
        />
      </div>
      <div class="settings__scale num" aria-hidden="true">
        <span>{formatGo(MIN_MEMORY_MB)}</span>
        <span>
          {MIN_COMFORTABLE_MEMORY_MB / 1024} à {formatGo(RECOMMENDED_MAX_MB)} recommandés
        </span>
        <span>{formatGo(max, 0)}</span>
      </div>
      {verdict.hint ? (
        <p class={cx('settings__hint', verdict.tone !== 'success' && 'settings__hint--warning')}>
          {verdict.hint}
        </p>
      ) : null}
    </div>
  );
}

function SecondMemoryField({ draft, system, edit }: FieldContext) {
  const max = memoryMaxMb(system?.totalMemMb);
  const both = draft.memoryMb + draft.secondInstanceMemoryMb;
  const tooMuch = !!system && both > system.totalMemMb;
  return (
    <div class="settings__block">
      <div class="settings__block-head">
        <span class="settings__block-title">Deuxième jeu lancé</span>
        <span class="settings__block-value num">{formatGo(draft.secondInstanceMemoryMb)}</span>
      </div>
      <div class="settings__slider">
        <Slider
          value={draft.secondInstanceMemoryMb}
          min={MIN_MEMORY_MB}
          max={max}
          step={MEMORY_STEP_MB}
          label="Mémoire du deuxième jeu"
          format={(value) => formatGo(value)}
          onChange={(value) => edit('secondInstanceMemoryMb', value)}
        />
      </div>
      <p class={cx('settings__hint', tooMuch && 'settings__hint--warning')}>
        {formatGo(draft.secondInstanceMemoryMb)} pour un jeu lancé pendant qu’un autre tourne (autre compte).{' '}
        {tooMuch
          ? `Avec le premier : ${formatGo(both)}, plus que la RAM de ton PC.`
          : `Les deux ensemble : ${formatGo(both)}.`}
      </p>
    </div>
  );
}

type PresetChoice = JvmPresetId | 'custom';

function JvmField({ draft, edit }: FieldContext) {
  const argsRef = useRef<HTMLInputElement>(null);
  const preset = presetForArgs(draft.jvmArgs);
  const items: readonly SegmentedItem<PresetChoice>[] = [
    ...jvmPresets.map((item) => ({ value: item.id, label: item.label })),
    { value: 'custom', label: 'Personnalisé' },
  ];

  const choose = (choice: PresetChoice) => {
    const chosen = jvmPresets.find((item) => item.id === choice);
    if (chosen) edit('jvmArgs', chosen.args);
    else argsRef.current?.focus();
  };

  return (
    <div class="settings__block">
      <div class="settings__block-head">
        <span class="settings__block-title">Préréglage JVM</span>
      </div>
      <p class="settings__hint">
        {preset ? preset.description : 'Arguments écrits à la main.'} Garde le préréglage recommandé sauf si tu sais ce que tu changes.
      </p>
      <div class="settings__presets">
        <Segmented items={items} value={preset ? preset.id : 'custom'} onChange={choose} label="Préréglage JVM" size="sm" />
      </div>
      <TextField
        label="Arguments JVM avancés"
        value={draft.jvmArgs}
        onInput={(value) => edit('jvmArgs', value)}
        placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50"
        mono
        inputRef={argsRef}
      />
    </div>
  );
}

type JavaList = { status: 'loading' } | { status: 'ready'; candidates: JavaCandidate[] };
type JavaChoice = 'auto' | 'custom' | `java:${string}`;

function JavaField({ draft, edit }: FieldContext) {
  const [java, setJava] = useState<JavaList>({ status: 'loading' });
  const [customChosen, setCustomChosen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();

  const scan = async (manual: boolean) => {
    setScanning(true);
    try {
      setJava({ status: 'ready', candidates: await api.listJava() });
    } catch {
      setJava({ status: 'ready', candidates: [] });
      if (manual) toast('La recherche de Java a échoué.', 'error');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void scan(false);
  }, []);

  useEffect(() => {
    if (customChosen) pathRef.current?.focus();
  }, [customChosen]);

  const candidates = java.status === 'ready' ? java.candidates : [];
  const path = draft.javaPath.trim();
  const known = path === '' || candidates.some((candidate) => candidate.path === path);
  const custom = customChosen || (java.status === 'ready' && !known);
  const choice: JavaChoice = custom ? 'custom' : path === '' ? 'auto' : `java:${path}`;
  const items: SelectItem<JavaChoice>[] = [
    { value: 'auto', label: 'Automatique (recommandé)' },
    ...candidates.map((candidate) => ({ value: `java:${candidate.path}` as const, label: `Java ${candidate.version}, ${candidate.vendor}` })),
    { value: 'custom', label: 'Autre chemin…' },
  ];

  const pick = (next: JavaChoice) => {
    setCustomChosen(next === 'custom');
    if (next === 'auto') edit('javaPath', '');
    else if (next !== 'custom') edit('javaPath', next.slice('java:'.length));
  };

  return (
    <div class="settings__block">
      <div class="settings__block-head">
        <span class="settings__block-title">Java</span>
      </div>
      <p id={descriptionId} class="settings__hint">
        Java 21 est installé automatiquement s’il manque.
      </p>
      <div class="settings__java">
        <Select items={items} value={choice} onChange={pick} label="Java" describedBy={descriptionId} class="settings__java-select" />
        {scanning ? (
          <span class="settings__java-scan">
            <Spinner size={16} label="Recherche de Java" />
          </span>
        ) : (
          <IconButton glyph="refresh" label="Rescanner Java" onClick={() => void scan(true)} />
        )}
      </div>
      {custom ? (
        <TextField
          label="Chemin de Java"
          value={draft.javaPath}
          onInput={(value) => edit('javaPath', value)}
          placeholder="/chemin/vers/java"
          mono
          inputRef={pathRef}
        />
      ) : null}
    </div>
  );
}

function FolderField({ field, context }: { field: Extract<SettingField, { kind: 'folder' }>; context: FieldContext }) {
  return (
    <div class="settings__block">
      <TextField
        label={field.title}
        value={context.draft[field.key]}
        onInput={(value) => context.edit(field.key, value)}
        placeholder={field.placeholder}
        hint={field.hint}
        mono
      />
    </div>
  );
}

function SwitchField({ field, context }: { field: Extract<SettingField, { kind: 'switch' }>; context: FieldContext }) {
  return (
    <div class="settings__block settings__block--row">
      <SettingRow
        title={field.title}
        description={field.description}
        control={({ descriptionId }) => (
          <Switch
            checked={!!context.draft[field.key]}
            onChange={(checked) => context.edit(field.key, checked)}
            label={field.title}
            describedBy={descriptionId}
          />
        )}
      />
      {field.details ? field.details(context) : null}
    </div>
  );
}

export function SettingFieldView({ field, context }: { field: SettingField; context: FieldContext }) {
  switch (field.kind) {
    case 'memory':
      return <MemoryField {...context} />;
    case 'secondMemory':
      return <SecondMemoryField {...context} />;
    case 'jvm':
      return <JvmField {...context} />;
    case 'java':
      return <JavaField {...context} />;
    case 'folder':
      return <FolderField field={field} context={context} />;
    case 'switch':
      return <SwitchField field={field} context={context} />;
  }
}
