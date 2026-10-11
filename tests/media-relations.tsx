import type { RelationEdge } from '../src/utils/relation-lanes'

import { render } from 'preact'

import MediaRelations from '../src/components/media-relations'

// The page tests/media-relations.spec.ts drives: the relation row of Made in Abyss: The Golden City
// of the Scorching Sun (anilist:114745) as AniList names it, in a box as wide as the modal's content
// (`?width=1250`).
const width = Number(new URLSearchParams(location.search).get('width'))

const edge = (relation: string, format: string, id: number, title: string, cover: string): RelationEdge => ({
  relation: relation as RelationEdge['relation'],
  format,
  node: {
    _id: `anilist:${id}`,
    uri: `anilist:${id}`,
    origin: 'anilist',
    id: String(id),
    titles: [{ title }],
    covers: [{ url: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/${cover}` }],
  },
})

const relations = [
  edge('PREQUEL', 'MOVIE', 100643, 'Made in Abyss: Dawn of the Deep Soul', 'bx100643-fPH9OgEKKvcI.jpg'),
  edge('SIDE_STORY', 'SPECIAL', 153791, 'Made in Abyss: Retsujitsu no Ougonkyou - Papa to Issho', 'b153791-CDhoG87JUdUV.png'),
  edge('CHARACTER', 'TV', 143086, 'Pop Team Epic Season 2', 'bx143086-Rrh3d7y454ZG.jpg'),
  edge('SEQUEL', 'MOVIE', 160275, 'Made in Abyss: Mezameru Shinpi', 'bx160275-cBOWJpcCGeMq.jpg'),
]

render(
  <div id="box" style={{ width }}>
    <MediaRelations relations={relations}/>
  </div>,
  document.body,
)
