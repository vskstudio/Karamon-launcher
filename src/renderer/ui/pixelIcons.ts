import announce from '../assets/icons/announce.png';
import battlepass from '../assets/icons/battlepass.png';
import bubble from '../assets/icons/bubble.png';
import calendar from '../assets/icons/calendar.png';
import chest from '../assets/icons/chest.png';
import compass from '../assets/icons/compass.png';
import crown from '../assets/icons/crown.png';
import emblem from '../assets/icons/emblem.png';
import gear from '../assets/icons/gear.png';
import gift from '../assets/icons/gift.png';
import globe from '../assets/icons/globe.png';
import guild from '../assets/icons/guild.png';
import heart from '../assets/icons/heart.png';
import hourglass from '../assets/icons/hourglass.png';
import islandHome from '../assets/icons/island_home.png';
import key from '../assets/icons/key.png';
import koin from '../assets/icons/koin.png';
import lightning from '../assets/icons/lightning.png';
import magnifier from '../assets/icons/magnifier.png';
import medal from '../assets/icons/medal.png';
import passPremium from '../assets/icons/pass_premium.png';
import players from '../assets/icons/players.png';
import pokeball from '../assets/icons/pokeball.png';
import profile from '../assets/icons/profile.png';
import quests from '../assets/icons/quests.png';
import ranked from '../assets/icons/ranked.png';
import shield from '../assets/icons/shield.png';
import shop from '../assets/icons/shop.png';
import spellbook from '../assets/icons/spellbook.png';
import star from '../assets/icons/star.png';
import swords from '../assets/icons/swords.png';
import trophy from '../assets/icons/trophy.png';
import koinKit from '../assets/kit/koin.png';
import cobbledollar from '../assets/kit/cobbledollar.png';
import starKit from '../assets/kit/star.png';
import lockKit from '../assets/kit/lock.png';
import checkKit from '../assets/kit/check.png';

export const pixelIcons = {
  announce,
  battlepass,
  bubble,
  calendar,
  chest,
  compass,
  crown,
  emblem,
  gear,
  gift,
  globe,
  guild,
  heart,
  hourglass,
  islandHome,
  key,
  koin,
  lightning,
  magnifier,
  medal,
  passPremium,
  players,
  pokeball,
  profile,
  quests,
  ranked,
  shield,
  shop,
  spellbook,
  star,
  swords,
  trophy,
  lumis: koinKit,
  cobbledollar,
  sparkle: starKit,
  lock: lockKit,
  tick: checkKit,
} as const;

export type PixelIconName = keyof typeof pixelIcons;
