// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { expect, test } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import Legal from '../../../src/router/legal'

const rendered = () => {
  const host = mount(<Router hook={memoryLocation({ path: '/legal' }).hook}><Legal/></Router>)
  const text = (host.textContent ?? '').replace(/\s+/g, ' ')
  const links = Object.fromEntries([...host.querySelectorAll('a')].map(link => [link.textContent?.trim(), link.getAttribute('href')]))
  unmount(host)
  return { text, links }
}

// Mutations: unlink a database's name; unlink the licence. ODbL 4.3 a asks for the notice on what people see,
// with the database's name linked to it and the licence named.
test('the legal page carries the ODbL notice, both databases linked and the licence linked', () => {
  const { text, links } = rendered()
  expect(text).toContain('Contains information from cedya77/anime-offline-database, continuing manami-project/anime-offline-database, made available under the ODbL.')
  expect(links['cedya77/anime-offline-database']).toBe('https://github.com/cedya77/anime-offline-database')
  expect(links['manami-project/anime-offline-database']).toBe('https://github.com/manami-project/anime-offline-database')
  expect(links.ODbL).toBe('https://opendatacommons.org/licenses/odbl/1-0/')
})

// Mutation: put back "All titles, descriptions, artwork, ratings, and playback streams are retrieved on demand".
test('the legal page no longer says every title is retrieved on demand, since the offline data ships in stub\'s files', () => {
  const { text } = rendered()
  expect(text).not.toMatch(/All titles, descriptions, artwork, ratings, and playback streams are retrieved on demand/)
  expect(text).toContain('stub’s files also carry titles, artwork addresses, and descriptions compiled from the anime-offline-database, AniDB, Kitsu, and those services')
})

// Mutations: drop the notice; unlink TVmaze, which its licence asks for; unlink the licence.
test('the legal page credits TVmaze, whose values the offline data can carry, with a link back and its licence', () => {
  const { text, links } = rendered()
  expect(text).toContain('Contains information from TVmaze, made available under CC BY-SA.')
  expect(links.TVmaze).toBe('https://www.tvmaze.com/')
  expect(links['CC BY-SA']).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
})
