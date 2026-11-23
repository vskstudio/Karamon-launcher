export type WikiInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: WikiInline[] }
  | { kind: 'em'; children: WikiInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; wikiSlug: string | null; children: WikiInline[] }
  | { kind: 'image'; src: string; alt: string };

export type WikiCalloutTone = 'note' | 'tip' | 'warning' | 'important';

export type WikiBlock =
  | { kind: 'heading'; level: 2 | 3; id: string; text: string }
  | { kind: 'paragraph'; content: WikiInline[] }
  | { kind: 'list'; ordered: boolean; items: WikiInline[][] }
  | { kind: 'callout'; tone: WikiCalloutTone; title: string; blocks: WikiBlock[] }
  | { kind: 'table'; head: WikiInline[][]; rows: WikiInline[][][] }
  | { kind: 'image'; src: string; alt: string };

export interface WikiPageRef {
  slug: string;
  title: string;
  icon: string;
}

export interface WikiGroup {
  name: string;
  pages: WikiPageRef[];
}

export interface WikiPage {
  slug: string;
  title: string;
  group: string;
  lede: string;
  icon: string;
  cover: string | null;
  blocks: WikiBlock[];
}
