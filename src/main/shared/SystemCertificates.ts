import { X509Certificate } from 'crypto';
import tls from 'tls';

export interface TrustReport {
  added: number;
  rejected: number;
  expired: number;
  failure?: unknown;
}

export class SystemCertificates {
  static trust(): TrustReport {
    try {
      const bundled = tls.getCACertificates('default');
      const known = new Set(bundled.map((pem) => SystemCertificates.read(pem)?.fingerprint256));
      const system = tls.getCACertificates('system');
      const added: string[] = [];
      let rejected = 0;
      let expired = 0;
      for (const pem of system) {
        const cert = SystemCertificates.read(pem);
        if (cert === null) rejected++;
        // Electron's BoringSSL picks a trusted expired cross-sign (old ISRG Root X2) over the valid chain.
        else if (Date.parse(cert.validTo) < Date.now()) expired++;
        else if (!known.has(cert.fingerprint256)) {
          known.add(cert.fingerprint256);
          added.push(pem);
        }
      }
      tls.setDefaultCACertificates([...bundled, ...added]);
      return { added: added.length, rejected, expired };
    } catch (failure) {
      return { added: 0, rejected: 0, expired: 0, failure };
    }
  }

  static describe(report: TrustReport): string {
    const counts = `${report.added} ajouté(s), ${report.rejected} illisible(s) ignoré(s), ${report.expired} expiré(s) ignoré(s)`;
    return `Certificats racines du système : ${counts}`;
  }

  private static read(pem: string): X509Certificate | null {
    try {
      return new X509Certificate(pem);
    } catch {
      return null;
    }
  }
}
