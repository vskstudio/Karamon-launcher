import tls from 'tls';

export class SystemCertificates {
  static trust(): void {
    try {
      const bundled = tls.getCACertificates('default');
      const system = tls.getCACertificates('system');
      tls.setDefaultCACertificates([...new Set([...bundled, ...system])]);
    } catch (error) {
      console.warn('[tls] magasin de certificats du système illisible:', error);
    }
  }
}
