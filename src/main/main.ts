import path from 'path';
import { KaramonApp } from './KaramonApp';
import { Screenshots } from './features/screenshots/Screenshots';
import { TokenStore } from './features/auth/TokenStore';
import { SystemCertificates } from './shared/SystemCertificates';

const distDir = __dirname;
const assetsDir = path.join(distDir, '..', 'assets');

SystemCertificates.trust();
TokenStore.preferLinuxSecretService();
Screenshots.registerPrivileged();
new KaramonApp(distDir, assetsDir).start();
