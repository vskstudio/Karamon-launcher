import type { WikiInline } from '../../../ipc/contract';
import { Glyph } from '../../ui';
import { followWikiLink, isWikiImage } from './wikiLinks';

interface WikiLinkProps {
  item: Extract<WikiInline, { kind: 'link' }>;
}

function WikiLink({ item }: WikiLinkProps) {
  const external = item.wikiSlug === null;
  const follow = (event: MouseEvent) => {
    event.preventDefault();
    followWikiLink(item.href, item.wikiSlug);
  };
  return (
    <a
      class={external ? 'wiki-link wiki-link--external' : 'wiki-link'}
      href={item.href}
      onClick={follow}
      onAuxClick={(event) => event.preventDefault()}
    >
      <WikiInlines items={item.children} />
      {external ? <Glyph name="external" size={11} class="wiki-link__external" /> : null}
    </a>
  );
}

function WikiInlineItem({ item }: { item: WikiInline }) {
  switch (item.kind) {
    case 'text':
      return <>{item.text}</>;
    case 'strong':
      return (
        <strong>
          <WikiInlines items={item.children} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <WikiInlines items={item.children} />
        </em>
      );
    case 'code':
      return <code class="wiki-code">{item.text}</code>;
    case 'link':
      return <WikiLink item={item} />;
    case 'image':
      return isWikiImage(item.src) ? <img class="wiki-inline-image pixelated" src={item.src} alt={item.alt} loading="lazy" decoding="async" /> : null;
  }
}

export function WikiInlines({ items }: { items: readonly WikiInline[] }) {
  return (
    <>
      {items.map((item, index) => (
        <WikiInlineItem key={index} item={item} />
      ))}
    </>
  );
}
