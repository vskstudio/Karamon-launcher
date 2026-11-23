export class DevMode {
  static readonly KARAMON_MOD_SERVER_BROWSER_JVM_FLAG = '-Dkaramon.dev=true';

  static forced(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
    return argv.includes('--dev') || env.KARAMON_DEV === '1';
  }

  static enabled(configured: boolean): boolean {
    return configured || DevMode.forced();
  }
}
