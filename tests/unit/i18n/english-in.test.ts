import { expect, test } from 'vite-plus/test'

import { englishIn } from '../../languages'

test('a message with no word of its own is no English left on a page, one with words still is', () => {
  const english = { '{label}: {names}': '{label}: {names}', Audio: 'Audio' }
  const ja = { '{label}: {names}': '{label}：{names}', Audio: '音声' }
  expect(englishIn(['Session 1: Misunderstandings', 'Audio'], english, ja)).toEqual(['"Audio" (Audio)'])
  expect(englishIn(['Session 1: Misunderstandings', 'Audio'], english)).toEqual(['"Audio" (Audio)'])
})
