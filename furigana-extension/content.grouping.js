export const BLOCK_ELEMENTS = new Set([
  'P', 'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE',
  'DIV', 'ARTICLE', 'SECTION', 'MAIN', 'ASIDE',
  'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'NAV',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

export function findBlockAncestor(element) {
  let node = element.parentElement;
  while (node && node.tagName !== 'BODY') {
    if (BLOCK_ELEMENTS.has(node.tagName)) return node;
    node = node.parentElement;
  }
  return element.parentElement;
}

export function groupCandidates(candidates, extractWordFn) {
  if (!candidates.length) return [];

  const blockMap = new Map();
  for (const { span, word } of candidates) {
    const block = findBlockAncestor(span);
    if (!blockMap.has(block)) blockMap.set(block, new Set());
    blockMap.get(block).add(word);
  }

  const result = [];
  for (const [block, surfaceSet] of blockMap) {
    const allSpans = Array.from(block.querySelectorAll('span'));
    const text = allSpans.map(extractWordFn).join('');
    result.push({ text, surfaces: [...surfaceSet] });
  }
  return result;
}
