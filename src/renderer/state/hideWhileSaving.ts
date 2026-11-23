export type SaveOutcome = { ok: true } | { ok: false; error: string };

export async function hideWhileSaving<T>(notice: { value: T }, hidden: T, save: () => Promise<unknown>): Promise<SaveOutcome> {
  const shown = notice.value;
  notice.value = hidden;
  try {
    await save();
    return { ok: true };
  } catch (error) {
    notice.value = shown;
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
