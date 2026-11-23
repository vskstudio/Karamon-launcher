export type AccountKind = 'microsoft' | 'offline';

export interface MinecraftProfile {
  id: string;
  name: string;
  kind: AccountKind;
}
