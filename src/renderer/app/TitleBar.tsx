import { useRef, useState } from 'preact/hooks';
import logo from '../assets/brand/logo.png';
import { api } from '../state/api';
import { system } from '../state/config';
import { navigate } from '../state/navigation';
import { accounts, activeAccount, logout, openAccounts, switchAccount } from '../state/session';
import { avatarFallbackOf, skinUrlOf } from '../state/skins';
import { Glyph, IconButton, Menu, MenuItem, MenuSeparator, PixelIcon, SkinFace } from '../ui';

const ACCOUNT_MENU_ID = 'account-menu';

function AccountChip() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const active = activeAccount.value;

  if (!active) {
    return (
      <button type="button" class="titlebar__account" onClick={openAccounts}>
        <SkinFace skinUrl={null} size={24} />
        <span>Se connecter</span>
      </button>
    );
  }

  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        class="titlebar__account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={ACCOUNT_MENU_ID}
        onClick={() => setOpen(!open)}
      >
        <SkinFace skinUrl={skinUrlOf(active)} fallbackUrl={avatarFallbackOf(active)} size={24} />
        <span>{active.name}</span>
        <Glyph name="chevronDown" size={14} />
      </button>
      <Menu open={open} onClose={close} anchorRef={anchorRef} label="Comptes" id={ACCOUNT_MENU_ID}>
        {accounts.value.map((profile) => (
          <MenuItem
            key={profile.id}
            checked={profile.id === active.id}
            leading={<SkinFace skinUrl={skinUrlOf(profile)} fallbackUrl={avatarFallbackOf(profile)} size={30} />}
            onSelect={() => {
              close();
              if (profile.id !== active.id) void switchAccount(profile);
            }}
          >
            <strong>{profile.name}</strong>
            <span class="titlebar__account-kind">{profile.kind === 'microsoft' ? 'Compte Microsoft' : 'Compte sans licence'}</span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          glyph="user"
          onSelect={() => {
            close();
            navigate('account');
          }}
        >
          Mon compte
        </MenuItem>
        <MenuItem
          glyph="plus"
          onSelect={() => {
            close();
            openAccounts();
          }}
        >
          Ajouter un compte
        </MenuItem>
        <MenuItem
          glyph="logout"
          tone="danger"
          onSelect={() => {
            close();
            void logout();
          }}
        >
          Se déconnecter
        </MenuItem>
      </Menu>
    </>
  );
}

export function TitleBar() {
  const version = system.value?.appVersion;
  return (
    <header class="titlebar">
      <div class="titlebar__brand">
        <img src={logo} alt="" width={22} height={22} />
        <span class="titlebar__name">KARAMON</span>
        {version ? <span class="titlebar__version">Launcher {version}</span> : null}
      </div>
      <div class="titlebar__actions">
        <button type="button" class="titlebar__lumis" onClick={() => navigate('shop')}>
          <PixelIcon name="lumis" size={16} />
          <span>Lumis</span>
          <span class="titlebar__lumis-plus" aria-hidden="true">
            <Glyph name="plus" size={12} strokeWidth={3} />
          </span>
        </button>
        <AccountChip />
        <span class="titlebar__divider" aria-hidden="true" />
        <div class="titlebar__window">
          <IconButton glyph="minimize" label="Réduire" onClick={() => api.minimize()} class="titlebar__window-button" />
          <IconButton glyph="maximize" label="Agrandir" onClick={() => api.maximize()} class="titlebar__window-button" />
          <IconButton glyph="close" label="Fermer" tone="danger" onClick={() => api.close()} class="titlebar__window-button" />
        </div>
      </div>
    </header>
  );
}
