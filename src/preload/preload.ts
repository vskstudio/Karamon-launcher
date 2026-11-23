import { contextBridge, ipcRenderer } from 'electron';
import { routes } from '../ipc/contract.ts';
import { bridgeRoutes } from './LauncherBridge.ts';

contextBridge.exposeInMainWorld('launcher', bridgeRoutes(routes, ipcRenderer));
