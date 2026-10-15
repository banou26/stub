// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { expect, test } from 'vite-plus/test'

import Placeholder, { PlaceholderLines } from '../../../src/components/placeholder'

// what emotion wrote for one element's class, every rule and at-rule naming it
const rulesFor = (element: Element) => {
  const name = [...element.classList].find(token => token.startsWith('css-'))!
  return [...document.querySelectorAll('style')].map(style => style.textContent).join('\n').split('}').filter(rule => rule.includes(name)).join('}\n')
}

test('the highlight sweeps, and stands still for a viewer who asks for reduced motion', () => {
  const host = mount(<Placeholder className="title"/>)
  try {
    const box = host.querySelector('.title')!
    expect(box.getAttribute('aria-hidden')).toBe('true')
    const rules = rulesFor(box)
    expect(rules, 'the control: its rules were read').toMatch(/animation:[^;]*infinite/)
    expect(rules).toMatch(/@media \(prefers-reduced-motion: ?reduce\)\{[^{]+\{[^}]*(^|[{;])animation:none/)
  } finally {
    unmount(host)
  }
})

test('lines of text still loading are as many as asked, and hidden from a reader as one', () => {
  const host = mount(<PlaceholderLines count={4} className="description"/>)
  try {
    const lines = host.querySelector('.description')!
    expect(lines.getAttribute('aria-hidden')).toBe('true')
    expect(lines.children).toHaveLength(4)
  } finally {
    unmount(host)
  }
})
