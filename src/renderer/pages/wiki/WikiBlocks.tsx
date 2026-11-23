import type { WikiBlock, WikiCalloutTone } from '../../../ipc/contract';
import { cx } from '../../ui';
import { WikiInlines } from './WikiInline';
import { headingDomId, isWikiImage } from './wikiLinks';

const calloutTitles: Record<WikiCalloutTone, string> = {
  note: 'À savoir',
  tip: 'Astuce',
  warning: 'Attention',
  important: 'Important',
};

type TableBlock = Extract<WikiBlock, { kind: 'table' }>;
type CalloutBlock = Extract<WikiBlock, { kind: 'callout' }>;

function WikiTable({ block }: { block: TableBlock }) {
  return (
    <div class="wiki-table" role="region" aria-label="Tableau" tabIndex={0}>
      <table>
        {block.head.length > 0 ? (
          <thead>
            <tr>
              {block.head.map((cell, index) => (
                <th key={index} scope="col">
                  <WikiInlines items={cell} />
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  <WikiInlines items={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WikiCallout({ block }: { block: CalloutBlock }) {
  const title = block.title || calloutTitles[block.tone];
  return (
    <aside class={cx('wiki-callout', `wiki-callout--${block.tone}`)} aria-label={title}>
      <p class="wiki-callout__title">{title}</p>
      <WikiBlocks blocks={block.blocks} />
    </aside>
  );
}

function WikiBlockItem({ block }: { block: WikiBlock }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 2 ? (
        <h2 id={headingDomId(block.id)} class="wiki-heading wiki-heading--2">
          {block.text}
        </h2>
      ) : (
        <h3 id={headingDomId(block.id)} class="wiki-heading wiki-heading--3">
          {block.text}
        </h3>
      );
    case 'paragraph':
      return (
        <p class="wiki-paragraph">
          <WikiInlines items={block.content} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <WikiInlines items={item} />
        </li>
      ));
      return block.ordered ? <ol class="wiki-list">{items}</ol> : <ul class="wiki-list">{items}</ul>;
    }
    case 'callout':
      return <WikiCallout block={block} />;
    case 'table':
      return <WikiTable block={block} />;
    case 'image':
      return isWikiImage(block.src) ? (
        <figure class="wiki-figure">
          <img src={block.src} alt={block.alt} loading="lazy" decoding="async" />
        </figure>
      ) : null;
  }
}

export function WikiBlocks({ blocks }: { blocks: readonly WikiBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => (
        <WikiBlockItem key={index} block={block} />
      ))}
    </>
  );
}
