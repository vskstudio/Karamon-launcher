import { findJavaCandidates, javaInstallRoots, newestJavaFirst, probeJava, type JavaInstall } from './JavaRuntime.ts';

export class JavaDetector {
  private readonly roots: string[];
  private known: Promise<JavaInstall[]> | null = null;

  constructor(roots: string[] = javaInstallRoots()) {
    this.roots = roots;
  }

  async detect(): Promise<JavaInstall[]> {
    const found: JavaInstall[] = [];
    for (const candidate of findJavaCandidates(this.roots)) {
      const install = await probeJava(candidate);
      if (install) found.push(install);
    }
    return found.sort(newestJavaFirst);
  }

  list(): Promise<JavaInstall[]> {
    if (!this.known) {
      this.known = this.detect();
    }
    return this.known;
  }

  invalidate(): void {
    this.known = null;
  }

  async versionInUse(configuredPath: string | undefined, requiredMajor: number): Promise<string | undefined> {
    const configured = configuredPath ? await probeJava(configuredPath) : null;
    if (configured) return configured.version;
    const installs = await this.list();
    return (installs.find((install) => install.major === requiredMajor) ?? installs[0])?.version;
  }
}
