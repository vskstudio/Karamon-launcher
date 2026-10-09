import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../../shared/AtomicWrite.ts';
import { isValidOfflineName } from '../../../shared/OfflineName.ts';
import { offlineUuid } from './OfflineAccount.ts';

/** `active` value for the Microsoft account, whose tokens live in the TokenStore. */
export const MICROSOFT_ACTIVE = 'microsoft';

export interface OfflineEntry {
  id: string;
  name: string;
}

export interface AccountsState {
  /** MICROSOFT_ACTIVE, the id of an offline account, or null when signed out. */
  active: string | null;
  offline: OfflineEntry[];
}

/**
 * Which account plays, and the offline accounts the launcher remembers. Offline accounts hold no secret: the Karamon
 * password is asked by the game. Without the file (launcher older than offline accounts), the Microsoft account plays.
 */
export class AccountStore {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  load(): AccountsState {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { active: MICROSOFT_ACTIVE, offline: [] };
    }
    const data = raw as Partial<AccountsState> | null;
    const offline = (Array.isArray(data?.offline) ? data.offline : [])
      .filter((a): a is OfflineEntry => typeof a?.name === 'string' && isValidOfflineName(a.name))
      .map((a) => ({ id: offlineUuid(a.name), name: a.name }));
    const active = typeof data?.active === 'string' ? data.active : null;
    return { active, offline };
  }

  setActive(active: string | null): void {
    this.save({ ...this.load(), active });
  }

  /** Remembers the account (once per name) and makes it the one that plays. */
  addOffline(name: string): OfflineEntry {
    const entry = { id: offlineUuid(name), name };
    const state = this.load();
    const offline = [...state.offline.filter((a) => a.id !== entry.id), entry];
    this.save({ active: entry.id, offline });
    return entry;
  }

  removeOffline(id: string): void {
    const state = this.load();
    this.save({
      active: state.active === id ? null : state.active,
      offline: state.offline.filter((a) => a.id !== id),
    });
  }

  private save(state: AccountsState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(state, null, 2));
  }
}
