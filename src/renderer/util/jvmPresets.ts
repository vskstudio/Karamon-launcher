
export interface JvmPreset {
  id: string;
  label: string;
  args: string;
}

export const JVM_PRESETS: JvmPreset[] = [
  {
    id: 'custom',
    label: 'Personnalisé',
    args: '',
  },
  {
    id: 'recommended',
    label: 'Recommandé (G1GC)',
    args: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -XX:+ParallelRefProcEnabled -XX:+UnlockExperimentalVMOptions',
  },
  {
    id: 'aikar',
    label: "Aikar's Flags (modpacks lourds)",
    args: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
  },
  {
    id: 'lowmem',
    label: 'Faible mémoire (<8 Go)',
    args: '-XX:+UseSerialGC -XX:TieredStopAtLevel=1',
  },
  {
    id: 'zgc',
    label: 'ZGC (Java 21+, latence ultra-basse)',
    args: '-XX:+UseZGC -XX:+ZGenerational -XX:+UnlockExperimentalVMOptions',
  },
];

