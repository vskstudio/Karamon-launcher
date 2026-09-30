import path from 'path';
import { KaramonApp } from './KaramonApp';
import { Screenshots } from './features/screenshots/Screenshots';
import { TokenStore } from './features/auth/TokenStore';

const distDir = __dirname;
const assetsDir = path.join(distDir, '..', 'assets');

TokenStore.preferLinuxSecretService();
Screenshots.registerPrivileged();
new KaramonApp(distDir, assetsDir).start();
