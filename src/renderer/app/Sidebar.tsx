import { api } from '../state/api';
import { routeBadges } from '../state/badges';
import { config } from '../state/config';
import { consoleOpen, toggleConsole } from '../state/console';
import { location, navigate } from '../state/navigation';
import { serverPing, serverState } from '../state/server';
import { links } from '../state/links';
import { Badge, cx, Glyph, PixelIcon, StatusDot } from '../ui';
import { routes, sections } from './routes';

function ServerCard() {
  const ping = serverPing.value;
  const state = serverState.value;
  const host = config.value?.server.host ?? 'play.karamon.fr';
  return (
    <div class="sidebar__server surface">
      <div class="sidebar__server-row">
        <span class="sidebar__server-host">
          <StatusDot tone={state === 'online' ? 'success' : state === 'offline' ? 'danger' : 'neutral'} pulse={state === 'unknown'} />
          {host}
        </span>
      </div>
      <div class="sidebar__server-row sidebar__server-players">
        <PixelIcon name="players" size={16} />
        {ping?.online ? (
          <span>
            <strong class="num">{ping.players}</strong> joueurs en ligne
          </span>
        ) : (
          <span>{state === 'offline' ? 'Serveur hors ligne' : 'Vérification…'}</span>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const current = location.value.page;
  const badges = routeBadges.value;
  return (
    <nav class="sidebar" aria-label="Navigation principale">
      {sections.map((section) => (
        <div key={section.id} class="sidebar__section">
          <div class="sidebar__heading">{section.label}</div>
          {routes
            .filter((route) => route.section === section.id)
            .map((route) => {
              const badge = badges[route.id];
              const active = current === route.id;
              return (
                <button
                  key={route.id}
                  type="button"
                  class={cx('sidebar__item', active && 'is-active')}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(route.id)}
                >
                  <PixelIcon name={route.pixel} size={24} />
                  <span class="sidebar__label">{route.label}</span>
                  {badge ? <Badge tone={/^\d+$/.test(badge) ? 'accent' : 'gold'}>{badge}</Badge> : null}
                </button>
              );
            })}
        </div>
      ))}
      <div class="sidebar__spacer" />
      <ServerCard />
      <div class="sidebar__footer">
        <button type="button" class="sidebar__link" onClick={() => void api.openExternal(links.site)}>
          <PixelIcon name="globe" size={16} />
          Site
        </button>
        <button type="button" class="sidebar__link" onClick={() => void api.openExternal(links.discord)}>
          <PixelIcon name="bubble" size={16} />
          Discord
        </button>
        <button type="button" class="sidebar__link" aria-expanded={consoleOpen.value} onClick={toggleConsole}>
          <Glyph name="terminal" size={16} />
          Console
        </button>
      </div>
    </nav>
  );
}
