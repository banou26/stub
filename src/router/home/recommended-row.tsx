import type { Pick, Summed } from './recommended'

import { css } from '@emotion/react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'

import { Route } from '../path'
import { MediaRecommendations } from '../../components/media-relations'
import { VIEWER_LISTS } from '../../components/viewer-lists-query'
import { franchiseDate } from '../../sources/anilist/franchise'
import { readDisabledSources } from '../../sources/disabled-sources'
import { toAggregatedUri } from '../../utils/uri'
import { browserFetch } from '../../worker/browser-fetch'
import { askRecommended, forgetKept, keep, readKept, seedsOf, shownPicks } from './recommended'

const rowStyle = css`
  padding: 0 10rem;

  /* as large as every other home row's heading (./row-title.tsx), over the title page's size */
  & > .recommendations > h2 {
    font-size: 4rem;
  }

  @media (max-width: 768px) {
    padding: 0 1.5rem;

    & > .recommendations > h2 {
      font-size: 2.4rem;
    }
  }
`

/** A pick as the title page's Recommendations draw one, opening every id AniList gives it. */
const cardOf = (pick: Pick) => {
  const uri = toAggregatedUri([`anilist:${pick.id}`, ...pick.idMal ? [`mal:${pick.idMal}` as const] : []])
  return {
    node: {
      _id: uri,
      uri,
      handles: [],
      type: pick.format,
      status: pick.status,
      startDate: franchiseDate(pick.startDate),
      titles: [pick.title?.english, pick.title?.romaji, pick.title?.native].flatMap(title => title ? [{ title }] : []),
      covers: pick.coverImage?.large ? [{ url: pick.coverImage.large, color: pick.coverImage.color }] : [],
    },
  }
}

/**
 * The row's cards, from the viewer's lists once every one is read: none, nothing asked and nothing kept while they name
 * no seed or AniList is turned off, the one ask of it that `askable` does not see.
 */
const useRecommended = () => {
  const [{ data }] = useSubscription({ query: VIEWER_LISTS })
  const lists = data?.viewerLists
  const works = lists && !lists.lists.some(list => list.state === 'LOADING') ? lists.rows : undefined
  const seeds = useMemo(() => works && !readDisabledSources().includes('anilist') ? seedsOf(works) : [], [works])
  const [picks, setPicks] = useState<Summed>()
  useEffect(() => {
    if (!works) return
    if (!seeds.length) return forgetKept()
    const kept = readKept(seeds, Date.now())
    if (kept) return setPicks(kept)
    let live = true
    askRecommended(seeds, works, browserFetch).then(asked => {
      keep(seeds, asked, Date.now())
      if (live) setPicks(asked)
    }, () => {})
    return () => { live = false }
  }, [works && seeds.join()])
  return useMemo(() => seeds.length && picks && works ? shownPicks(picks, works).map(({ pick }) => cardOf(pick)) : [], [seeds, picks, works])
}

/** Home's row of what AniList's users recommend beside the shows on the viewer's lists. Nothing at all while none. */
const Recommended = () => {
  const intl = useIntl()
  const cards = useRecommended()
  return cards.length
    ? (
      <div css={rowStyle} className="home-row">
        <MediaRecommendations recommendations={cards} route={Route.MEDIA} heading={intl.formatMessage({ id: 'Recommended for you', defaultMessage: 'Recommended for you' })}/>
      </div>
    )
    : null
}

export default Recommended
