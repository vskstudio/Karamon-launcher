import type { JavaCandidate, JavaDetector } from './JavaDetector';

export class InstalledJavas {
  private readonly detector: JavaDetector;
  private cached: JavaCandidate[] | null = null;

  constructor(detector: JavaDetector) {
    this.detector = detector;
  }

  async list(): Promise<JavaCandidate[]> {
    if (!this.cached) this.cached = await this.detector.detect();
    return this.cached;
  }

  async versionFor(javaPath: string): Promise<string | undefined> {
    const list = await this.list();
    return (list.find((java) => java.path === javaPath) ?? list.find((java) => java.version.startsWith('21')) ?? list[0])?.version;
  }
}
