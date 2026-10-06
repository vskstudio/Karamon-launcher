import { createElement, type IconNode } from 'lucide';

export type { IconNode };

export function icon(node: IconNode, size = 16): SVGElement {
  return createElement(node, {
    width: size,
    height: size,
    'stroke-width': 1.75,
    'aria-hidden': 'true',
  });
}
