import { JsonFile, jsonObject } from '../../shared/DurableFile.ts';
import { isValidOfflineName } from '../../../shared/OfflineName.ts';
import { offlineUuid } from './OfflineAccount.ts';

export const MICROSOFT_ACTIVE = 'microsoft';

export interface OfflineEntry {
  id: string;
  name: string;
}

export interface AccountsState {
  active: string | null;
  offline: OfflineEntry[];
}

export class AccountStore {
  private readonly file: JsonFile<AccountsState>;

  constructor(file: string) {
    this.file = new JsonFile(file, AccountStore.decode, { whenUnreadable: 'set-aside' });
  }

  load(): AccountsState {
    const state = this.file.read();
    return state.kind === 'read' ? state.value : { active: MICROSOFT_ACTIVE, offline: [] };
  }

  setActive(active: string | null): void {
    this.file.write({ ...this.load(), active });
  }

  addOffline(name: string): OfflineEntry {
    const entry = { id: offlineUuid(name), name };
    const state = this.load();
    const offline = [...state.offline.filter((a) => a.id !== entry.id), entry];
    this.file.write({ active: entry.id, offline });
    return entry;
  }

  removeOffline(id: string): void {
    const state = this.load();
    this.file.write({
      active: state.active === id ? null : state.active,
      offline: state.offline.filter((a) => a.id !== id),
    });
  }

  private static decode(raw: unknown): AccountsState {
    const data = jsonObject(raw);
    const offline = (Array.isArray(data.offline) ? (data.offline as Partial<OfflineEntry>[]) : [])
      .filter((a): a is OfflineEntry => typeof a?.name === 'string' && isValidOfflineName(a.name))
      .map((a) => ({ id: offlineUuid(a.name), name: a.name }));
    const active = typeof data.active === 'string' ? data.active : null;
    return { active, offline };
  }
}
