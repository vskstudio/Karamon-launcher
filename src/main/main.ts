import path from 'path';
import tls from 'tls';
import { KaramonApp } from './KaramonApp';
import { Screenshots } from './features/screenshots/Screenshots';
import { TokenStore } from './features/auth/TokenStore';

const distDir = __dirname;
const assetsDir = path.join(distDir, '..', 'assets');

// Antivirus HTTPS scanning and company proxies re-sign traffic with a root they install in the Windows store, which Node ignores by default.
try {
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
} catch (e) {
  console.warn('Certificats système non chargés:', e);
}

TokenStore.preferLinuxSecretService();
Screenshots.registerPrivileged();
new KaramonApp(distDir, assetsDir).start();
