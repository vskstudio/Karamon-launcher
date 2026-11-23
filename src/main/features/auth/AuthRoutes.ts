import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { AuthSession } from './AuthSession';
import { offlineNameStatus } from './OfflineAccount';
import { resetSkin, saveSkin } from './OfflineSkin';
import type { SkinLookup } from './SkinLookup';

export interface AuthRoutesDeps {
  auth: AuthSession;
  skins: SkinLookup;
  instanceDir: () => string;
  log: (message: string) => void;
}

export function registerAuthRoutes(router: RouteRegistry, { auth, skins, instanceDir, log }: AuthRoutesDeps): void {
  router.handle(routes.authLogin, () => auth.login());
  router.handle(routes.authLoginOffline, async (name) => {
    const profile = await auth.loginOffline(name);
    log(`Compte sans licence enregistré : ${profile.name} (${profile.id})`);
    return profile;
  });
  router.handle(routes.authCheckName, (name) => offlineNameStatus(name));
  router.handle(routes.authSwitch, (accountId) => auth.switchTo(accountId));
  router.handle(routes.authLogout, () => auth.logout());
  router.handle(routes.authGetSession, () => auth.state());

  router.handle(routes.skinUrl, (profile) => skins.skinFor(profile, instanceDir()));
  router.handle(routes.skinOfflineSet, ({ name, png, model }) =>
    saveSkin(instanceDir(), name, Buffer.from(png, 'base64'), model),
  );
  router.handle(routes.skinOfflineReset, (name) => resetSkin(instanceDir(), name));
}
