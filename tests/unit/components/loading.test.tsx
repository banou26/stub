// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { expect, test, vi } from 'vite-plus/test'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ LoaderCircle: () => null }))

const { default: Loading } = await import('../../../src/components/loading')

// what emotion wrote for one element's class, every rule and at-rule naming it
const rulesFor = (element: Element) => {
  const name = [...element.classList].find(token => token.startsWith('css-'))!
  return [...document.querySelectorAll('style')].map(style => style.textContent).join('\n').split('}').filter(rule => rule.includes(name)).join('}\n')
}

test('the mark is named for a reader, takes no room beside what it follows, and stands still for reduced motion', () => {
  const host = mount(withIntl(<Loading/>))
  try {
    const mark = host.querySelector('[role="img"]')!
    expect(mark.getAttribute('aria-label')).toBe('Loading')
    const rules = rulesFor(mark)
    expect(rules, 'the control: its rules were read').toMatch(/animation:[^;]*infinite/)
    expect(rules).toMatch(/(^|[{;])padding-inline-start:0\.5em[;}]/)
    expect(rules, 'as much room taken back as it takes').toMatch(/(^|[{;])margin-inline-end:-1\.5em[;}]/)
    expect(rules).toMatch(/@media \(prefers-reduced-motion: ?reduce\)\{[^{]+\{[^}]*(^|[{;])animation:none/)
  } finally {
    unmount(host)
  }
})
