import type { LauncherApi } from '../ipc/contract';

declare global {
  interface Window {
    launcher: LauncherApi;
  }
}
