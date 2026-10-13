import { X509Certificate } from 'crypto';
import tls from 'tls';

export interface TrustReport {
  added: number;
  rejected: number;
  failure?: unknown;
}

export class SystemCertificates {
  static trust(): TrustReport {
    try {
      const bundled = tls.getCACertificates('default');
      const known = new Set(bundled.map(SystemCertificates.fingerprint));
      const system = tls.getCACertificates('system');
      const added: string[] = [];
      let rejected = 0;
      for (const pem of system) {
        const fingerprint = SystemCertificates.fingerprint(pem);
        if (fingerprint === null) rejected++;
        else if (!known.has(fingerprint)) {
          known.add(fingerprint);
          added.push(pem);
        }
      }
      tls.setDefaultCACertificates([...bundled, ...added]);
      return { added: added.length, rejected };
    } catch (failure) {
      return { added: 0, rejected: 0, failure };
    }
  }

  static describe(report: TrustReport): string {
    const counts = `${report.added} ajouté(s), ${report.rejected} illisible(s) ignoré(s)`;
    return `Certificats racines du système : ${counts}`;
  }

  private static fingerprint(pem: string): string | null {
    try {
      return new X509Certificate(pem).fingerprint256;
    } catch {
      return null;
    }
  }
}
