export type JvmPresetId = 'recommended' | 'aikar' | 'lowmem' | 'zgc';

export interface JvmPreset {
  id: JvmPresetId;
  label: string;
  description: string;
  args: string;
}

export const jvmPresets: readonly JvmPreset[] = [
  {
    id: 'recommended',
    label: 'Recommandé',
    description: 'G1GC, convient à presque tout le monde.',
    args: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+ParallelRefProcEnabled -XX:+UnlockExperimentalVMOptions',
  },
  {
    id: 'aikar',
    label: 'Aikar',
    description: "Aikar's Flags, pour les modpacks lourds.",
    args: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
  },
  {
    id: 'lowmem',
    label: 'Faible mémoire',
    description: 'Pour les PC avec moins de 8 Go de RAM.',
    args: '-XX:+UseSerialGC -XX:TieredStopAtLevel=1',
  },
  {
    id: 'zgc',
    label: 'ZGC',
    description: 'Java 21 et plus, latence ultra-basse.',
    args: '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions',
  },
];

export function presetForArgs(args: string): JvmPreset | null {
  const trimmed = args.trim();
  return jvmPresets.find((preset) => preset.args === trimmed) ?? null;
}
