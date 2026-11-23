const WEBSITE_URL = 'https://karamon.fr';
const SERVER_PORT = 25565;
const JAVA_MAJOR = 21;

export const KARAMON = {
  launcherName: 'KaramonLauncher',
  profileName: 'Karamon',
  websiteUrl: WEBSITE_URL,
  websiteHost: 'karamon.fr',
  publicServerHost: 'karamon.fr',
  server: { host: 'play.karamon.fr', port: SERVER_PORT },
  defaultServerPort: SERVER_PORT,
  statusFallbackHost: 'play.karamon.fr',
  panelUrl: `${WEBSITE_URL}/panel`,
  shopApiUrl: `${WEBSITE_URL}/api/shop`,
  shopUrl: `${WEBSITE_URL}/boutique`,
  termsUrl: `${WEBSITE_URL}/cgv`,
  wikiUrl: `${WEBSITE_URL}/wiki`,
  reportsUrl: `${WEBSITE_URL}/panel/api/launcher/reports`,
  launcherDiscordUrl: 'https://discord.gg/karavr',
  gameMenuDiscordUrl: 'https://discord.gg/karamon',
  githubRepo: 'vskstudio/Karamon-launcher',
  javaMajor: JAVA_MAJOR,
  clientDisabledJarReason: `Java ${JAVA_MAJOR}`,
  defaultMemoryMb: 12288,
} as const;

export type KaramonIdentity = typeof KARAMON;

export function serverAddress(server: { host: string; port: number }): string {
  return server.port === KARAMON.defaultServerPort ? server.host : `${server.host}:${server.port}`;
}

export const SKIN_MAX_BYTES_ACCEPTED_BY_KARAMON_MOD = 32 * 1024;
