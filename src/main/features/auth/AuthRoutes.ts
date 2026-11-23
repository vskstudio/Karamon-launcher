import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { GameInstance } from '../../shared/GameInstance.ts';
import type { AuthSession } from './AuthSession.ts';
import { resetSkin, saveSkin } from './OfflineSkin.ts';
import type { SkinLookup } from './SkinLookup.ts';

export interface AuthRoutesDeps {
  auth: AuthSession;
  skins: SkinLookup;
  instance: () => GameInstance;
  instanceToWrite: () => GameInstance;
  log: (message: string) => void;
}

export function registerAuthRoutes(router: RouteRegistry, { auth, skins, instance, instanceToWrite, log }: AuthRoutesDeps): void {
  router.handle(routes.authLogin, () => auth.login());
  router.handle(routes.authLoginOffline, async (name) => {
    const profile = await auth.loginOffline(name);
    log(`Compte sans licence enregistré : ${profile.name} (${profile.id})`);
    return profile;
  });
  router.handle(routes.authCheckName, (name) => auth.checkName(name));
  router.handle(routes.authSwitch, (accountId) => auth.switchTo(accountId));
  router.handle(routes.authLogout, () => auth.logout());
  router.handle(routes.authGetSession, () => auth.state());

  router.handle(routes.skinUrl, (profile) => skins.skinFor(profile, instance()));
  router.handle(routes.skinOfflineSet, ({ name, png, model }) =>
    saveSkin(instanceToWrite(), name, Buffer.from(png, 'base64'), model),
  );
  router.handle(routes.skinOfflineReset, (name) => resetSkin(instanceToWrite(), name));
}
