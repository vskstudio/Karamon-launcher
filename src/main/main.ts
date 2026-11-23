import path from 'path';
import { app } from 'electron/main';
import { KaramonApp } from './KaramonApp.ts';
import { SingleInstance } from './SingleInstance.ts';
import { Screenshots } from './features/screenshots/Screenshots.ts';
import { TokenStore } from './features/auth/TokenStore.ts';

const distDir = __dirname;
const assetsDir = path.join(distDir, '..', 'assets');

const instanceLock = SingleInstance.claim(app);
if (instanceLock) {
  TokenStore.preferLinuxSecretService();
  Screenshots.registerPrivileged();
  new KaramonApp(distDir, assetsDir).start(instanceLock);
}
