import { expect, test } from 'vitest'

import { youtubeVideoId } from '../../src/components/youtube-url'

// The component embeds YouTube directly instead of loading `iframe_api`, so it has to turn whatever
// url a source hands it into a video id itself. Sources give all of these shapes.

test('every url shape a source hands us yields the id', () => {
  const id = 'aqz-KE-bpKQ'
  for (const url of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/watch?v=${id}&t=42s&list=PL123`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/embed/${id}?rel=0`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/v/${id}`,
    `https://www.youtube.com/shorts/${id}`,
  ]) {
    expect(youtubeVideoId(url), url).toBe(id)
  }
})

// proof: drop the host check and the first two stop being null, which is the case that matters: a
// look-alike host must never be embedded as though YouTube served it
test('anything that is not YouTube, or carries no id, is null', () => {
  expect(youtubeVideoId('https://youtube.com.evil.example/watch?v=aqz-KE-bpKQ')).toBeNull()
  expect(youtubeVideoId('https://vimeo.com/12345')).toBeNull()
  expect(youtubeVideoId('https://www.youtube.com/watch')).toBeNull()
  expect(youtubeVideoId('https://www.youtube.com/')).toBeNull()
  expect(youtubeVideoId('https://youtu.be/')).toBeNull()
  expect(youtubeVideoId('not a url')).toBeNull()
  expect(youtubeVideoId('')).toBeNull()
})
