/**
 * Development mode of the game: the launcher passes {@link DevMode.JVM_FLAG} and the
 * Karamon mod shows the vanilla server browser on its title screen, so a local or LAN
 * server can be joined. On from the settings, or forced with `--dev` / `KARAMON_DEV=1`.
 */
export class DevMode {
  static readonly JVM_FLAG = '-Dkaramon.dev=true';

  static forced(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
    return argv.includes('--dev') || env.KARAMON_DEV === '1';
  }

  static enabled(configured: boolean): boolean {
    return configured || DevMode.forced();
  }
}
