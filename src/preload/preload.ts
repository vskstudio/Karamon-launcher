import { contextBridge, ipcRenderer } from 'electron';
import { routes } from '../ipc/contract';
import { bridgeRoutes } from './LauncherBridge';

contextBridge.exposeInMainWorld('launcher', bridgeRoutes(routes, ipcRenderer));
