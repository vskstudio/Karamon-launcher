import type { AppConfigUpdate } from '../../ipc/contract';

/**
 * Only the settings the player changed on the page. Sending the whole form
 * would overwrite values changed elsewhere since the page was loaded (e.g. the
 * « Toujours envoyer » box of a report dialog).
 */
export function changedSettings(saved: AppConfigUpdate, current: AppConfigUpdate): AppConfigUpdate {
  const update: Record<string, unknown> = {};
  for (const key of Object.keys(current) as (keyof AppConfigUpdate)[]) {
    if (current[key] !== saved[key]) update[key] = current[key];
  }
  return update as AppConfigUpdate;
}
