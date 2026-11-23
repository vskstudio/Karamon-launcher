import path from 'path';
import { KaramonApp } from './KaramonApp.ts';
import { Screenshots } from './features/screenshots/Screenshots.ts';
import { TokenStore } from './features/auth/TokenStore.ts';

const distDir = __dirname;
const assetsDir = path.join(distDir, '..', 'assets');

TokenStore.preferLinuxSecretService();
Screenshots.registerPrivileged();
new KaramonApp(distDir, assetsDir).start();
