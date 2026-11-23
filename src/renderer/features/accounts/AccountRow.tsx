import type { ComponentChildren } from 'preact';
import type { MinecraftProfile } from '../../../ipc/contract';
import { accountKindLabel } from '../../state/accounts';
import { avatarFallbackOf, skinUrlOf } from '../../state/skins';
import { Glyph, SkinFace } from '../../ui';
import './accounts.css';

interface AccountRowProps {
  profile: MinecraftProfile;
  active: boolean;
  actions?: ComponentChildren;
}

export function AccountRow({ profile, active, actions }: AccountRowProps) {
  return (
    <li class="account-row">
      <SkinFace skinUrl={skinUrlOf(profile)} fallbackUrl={avatarFallbackOf(profile)} size={34} />
      <span class="account-row__text">
        <span class="account-row__name">
          {profile.name}
          {active ? <Glyph name="check" size={14} strokeWidth={3} class="account-row__check" /> : null}
        </span>
        <span class="account-row__kind">
          {accountKindLabel(profile.kind)}
          {active ? <span class="visually-hidden">, compte actif</span> : null}
        </span>
      </span>
      {actions ? <span class="account-row__actions">{actions}</span> : null}
    </li>
  );
}
