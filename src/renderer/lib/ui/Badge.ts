import { h } from './h';

export type Tone = 'neutral' | 'accent' | 'lumis' | 'green' | 'amber' | 'red';

export function badge(text: string, tone: Tone = 'neutral'): HTMLSpanElement {
  return h('span', { className: tone === 'neutral' ? 'ui-badge' : `ui-badge ui-badge--${tone}`, text });
}

export function dot(tone: Tone = 'neutral'): HTMLSpanElement {
  return h('span', { className: tone === 'neutral' ? 'ui-dot' : `ui-dot ui-dot--${tone}`, attrs: { 'aria-hidden': 'true' } });
}
