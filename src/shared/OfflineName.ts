/** Names the server accepts for an account without a Minecraft licence. */
export const OFFLINE_NAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export const OFFLINE_NAME_MIN = 3;
export const OFFLINE_NAME_MAX = 16;

export function isValidOfflineName(name: string): boolean {
  return OFFLINE_NAME_PATTERN.test(name);
}

/** What is wrong with the name, in words a player understands, or null when it is valid. */
export function offlineNameProblem(name: string): string | null {
  if (name.length === 0) return 'Choisis un pseudo.';
  if (/[^A-Za-z0-9_]/.test(name)) {
    return /\s/.test(name)
      ? 'Pas d’espace : lettres, chiffres et _ seulement.'
      : 'Lettres sans accent, chiffres et _ seulement.';
  }
  if (name.length < OFFLINE_NAME_MIN) return `Au moins ${OFFLINE_NAME_MIN} caractères.`;
  if (name.length > OFFLINE_NAME_MAX) return `${OFFLINE_NAME_MAX} caractères au plus.`;
  return null;
}

/** The name belongs to a Mojang account: the server refuses it (« Pseudo déjà pris »). */
export const OFFLINE_NAME_TAKEN = 'Ce pseudo appartient à un compte Minecraft officiel : choisis-en un autre.';
