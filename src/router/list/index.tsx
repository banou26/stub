import type { IntlShape } from 'react-intl'
import type { ViewerListsSubscription } from '../../generated/graphql'
import type { DisplayMode } from '../search/display'
import type { Fields } from '../../tracking/compact'
import type { Sort, Tab } from './model'

import { css } from '@emotion/react'
import { Plus, Search as SearchIcon, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { defineMessages, useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { getRoutePath, Route } from '../path'
import { formatLabel } from '../search/params'
import DisplayModeToggle from '../../components/display-mode-toggle'
import FilterSelect, { FilterField } from '../../components/filter-select'
import Paged from '../../components/paged'
import Placeholder from '../../components/placeholder'
import { useSaveEntry } from '../../components/media-tracking-query'
import { VIEWER_LISTS } from '../../components/viewer-lists-query'
import { NAME_LIST } from '../../i18n'
import { viewerPrefs } from '../../tracking/compact-prefs'
import { SORTS, TABS, offersOneMore, oneMore, shownRows, tabCounts } from './model'

type Row = NonNullable<ViewerListsSubscription['viewerLists']>['rows'][number]

const STATUS_LABELS = defineMessages({
  WATCHING: { id: 'Watching#list status', defaultMessage: 'Watching', description: 'list status' },
  REWATCHING: { id: 'Rewatching#list status', defaultMessage: 'Rewatching', description: 'list status' },
  PLANNING: { id: 'Plan to watch#list status', defaultMessage: 'Plan to watch', description: 'list status' },
  COMPLETED: { id: 'Completed#list status', defaultMessage: 'Completed', description: 'list status' },
  PAUSED: { id: 'Paused#list status', defaultMessage: 'Paused', description: 'list status' },
  DROPPED: { id: 'Dropped#list status', defaultMessage: 'Dropped', description: 'list status' },
  ALL: { id: 'All#list status', defaultMessage: 'All', description: 'list status' },
})

const SORT_LABELS = defineMessages({
  updated: { id: 'Last updated', defaultMessage: 'Last updated' },
  title: { id: 'Title', defaultMessage: 'Title' },
  score: { id: 'Score', defaultMessage: 'Score' },
  progress: { id: 'Progress', defaultMessage: 'Progress' },
})

const MODES: readonly DisplayMode[] = ['grid', 'list']

const PAGE_SIZE = 48

const style = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
  min-height: 100vh;

  .heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.6rem;
    margin-bottom: 2rem;
  }

  .heading {
    font-size: 2.4rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-bottom: 1.6rem;
  }

  .tab {
    display: flex;
    gap: 0.6rem;
    padding: 0.5rem 1.3rem;
    border-radius: 2rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.4rem;
    font-family: inherit;
    cursor: pointer;
  }

  .tab:hover { color: rgba(255, 255, 255, 0.9); }
  .tab .count { font-variant-numeric: tabular-nums; opacity: 0.6; }

  .tab[aria-pressed='true'] {
    background: #fff;
    color: #000;
    border-color: #fff;
  }

  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.4rem 1.6rem;
    max-width: 64rem;
    margin-bottom: 2rem;
  }

  .text-field {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 4.2rem;
    padding: 0 1.2rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.4);
  }

  .text-field:focus-within { border-color: rgba(255, 255, 255, 0.5); }

  .text-field input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: #fff;
    font-size: 1.5rem;
    font-family: inherit;
  }

  .unread, .status {
    margin-bottom: 1.2rem;
    color: rgba(255, 255, 255, 0.5);
  }

  .unread { font-size: 1.4rem; }
  .status { font-size: 1.8rem; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 2rem 1.6rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .grid > .pending { aspect-ratio: 5 / 7; border-radius: 0.8rem; }
  .rows > .pending { height: 8rem; border-radius: 0.6rem; }

  .item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    color: rgba(255, 255, 255, 0.85);
  }

  .cover {
    display: block;
    aspect-ratio: 5 / 7;
    border-radius: 0.8rem;
    background: #191919;
    overflow: hidden;
  }

  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .title {
    font-size: 1.5rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .title:hover { color: #fff; }

  .facts {
    display: flex;
    align-items: center;
    gap: 1rem;
    min-height: 2.6rem;
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
  }

  .progress { display: flex; gap: 0.3rem; color: rgba(255, 255, 255, 0.85); }
  .score { display: flex; align-items: center; gap: 0.3rem; }

  .differs {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: #f5b942;
    cursor: help;
  }

  .more {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    margin-left: auto;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
  }

  .more:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.5); }
  .more:disabled { opacity: 0.4; cursor: default; }

  .bar {
    height: 0.3rem;
    border-radius: 0.2rem;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .bar > span {
    display: block;
    height: 100%;
    background: rgba(255, 255, 255, 0.7);
  }

  .missed { font-size: 1.2rem; color: #ff8a80; }

  /* one line per work: cover, title, how far, score, format, the + */
  .rows > .item {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) minmax(0, 28rem);
    align-items: center;
    gap: 0.4rem 1.6rem;
    padding: 0.8rem 1.2rem;
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.03);
  }

  .rows > .item > .cover, .rows > .item > .title { grid-row: span 2; }
  .rows > .item > .cover { border-radius: 0.4rem; }
  .rows > .item > .facts { grid-column: 3; grid-row: 1; }
  .rows > .item > .bar { grid-column: 3; grid-row: 2; }
  .rows > .item > .missed { grid-column: 2 / -1; }

  @media (max-width: 768px) {
    padding: calc(var(--stub-header-height) + 1rem) 1.5rem 3rem;

    .heading { font-size: 2rem; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 1.6rem 1.2rem; }
    .rows > .item { grid-template-columns: 4.5rem minmax(0, 1fr); }
    .rows > .item > .title, .rows > .item > .facts, .rows > .item > .bar { grid-column: 2; grid-row: auto; }
  }
`

/** Each tracker's own value of each field the row's trackers differ on, a line per tracker. */
const differences = (intl: IntlShape, row: Row) =>
  row.answers.map(({ tracker, entry }) => intl.formatMessage({ id: '{name}: {values}', defaultMessage: '{name}: {values}' }, {
    name: tracker.name,
    values: intl.formatList(row.disagreements.flatMap(field =>
      field === 'STATUS' ? (entry?.status ? [intl.formatMessage(STATUS_LABELS[entry.status])] : [])
      : field === 'PROGRESS' ? [intl.formatMessage({ id: 'Episode {number}', defaultMessage: 'Episode {number}' }, { number: entry?.progress ?? 0 })]
      : entry?.score != null ? [intl.formatMessage({ id: '{score, number} / {max, number}', defaultMessage: '{score, number} / {max, number}' }, { score: entry.score / 10, max: 10 })]
      : []), NAME_LIST),
  })).join('\n')

/** The trackers that take the same fields, together, so one save goes for each set of fields. */
const byFields = (patches: Record<string, Fields>) => {
  const groups = new Map<string, { fields: Fields, trackers: string[] }>()
  for (const [tracker, fields] of Object.entries(patches)) {
    const key = JSON.stringify(fields)
    groups.set(key, { fields, trackers: [...groups.get(key)?.trackers ?? [], tracker] })
  }
  return [...groups.values()]
}

const Item = ({ row }: { row: Row }) => {
  const intl = useIntl()
  const save = useSaveEntry({ uri: row.uri, title: row.summary.title, cover: row.summary.cover, episodeCount: row.episodeCount })
  const own = row.summary.progress ?? 0
  // the + shows from the click, until the lists hold it or a tracker did not take it
  const [pending, setPending] = useState<number>()
  const [missed, setMissed] = useState<{ name: string, outcome: string }[]>([])
  useEffect(() => { if (pending !== undefined && own >= pending) setPending(undefined) }, [own, pending])

  const progress = pending ?? own
  const total = row.episodeCount
  const to = getRoutePath(Route.MEDIA, { uri: row.uri })
  const title = row.summary.title ?? row.uri
  const score = row.summary.score
  const patches = oneMore(row, viewerPrefs.read().targets, progress)

  const more = async () => {
    setPending(progress + 1)
    setMissed([])
    const outcomes = (await Promise.all(byFields(patches).map(({ fields, trackers }) => save(trackers, fields)))).flat()
    const failed = outcomes.filter(({ outcome }) => outcome !== 'SAVED' && outcome !== 'QUEUED')
    if (!failed.length) return
    setPending(undefined)
    setMissed(failed.map(({ tracker, outcome }) => ({ name: row.answers.find(answer => answer.tracker.id === tracker)?.tracker.name ?? tracker, outcome })))
  }

  return (
    <div className="item">
      <Link to={to} className="cover" tabIndex={-1}>
        {row.summary.cover ? <img src={row.summary.cover} alt="" loading="lazy"/> : undefined}
      </Link>
      <Link to={to} className="title">{title}</Link>
      <div className="facts">
        <span className="progress">
          <span>{progress}</span>
          {total != null ? <span>{intl.formatMessage({ id: '/ {total}', defaultMessage: '/ {total}' }, { total })}</span> : undefined}
        </span>
        {score != null ? <span className="score"><Star size={12} aria-hidden="true"/>{intl.formatNumber(score / 10, { maximumFractionDigits: 1 })}</span> : undefined}
        {row.type ? <span>{formatLabel(row.type)}</span> : undefined}
        {row.disagreements.length ? <span className="differs" role="img" title={differences(intl, row)} aria-label={differences(intl, row)}/> : undefined}
        {
          offersOneMore(row, progress)
            ? (
              <button
                type="button"
                className="more"
                aria-label={intl.formatMessage({ id: 'One episode more', defaultMessage: 'One episode more' })}
                disabled={pending !== undefined || !Object.keys(patches).length}
                onClick={more}
              >
                <Plus size={14} aria-hidden="true"/>
              </button>
            )
            : undefined
        }
      </div>
      {total ? <div className="bar"><span style={{ width: `${Math.min(100, (progress / total) * 100)}%` }}/></div> : undefined}
      {missed.map(({ name, outcome }) => (
        <div key={name} className="missed">
          {intl.formatMessage({ id: '{name} did not save: {outcome, select, REFUSED {refused} other {failed}}', defaultMessage: '{name} did not save: {outcome, select, REFUSED {refused} other {failed}}' }, { name, outcome })}
        </div>
      ))}
    </div>
  )
}

const List = () => {
  const intl = useIntl()
  const [{ data }] = useSubscription({ query: VIEWER_LISTS })
  const [tab, setTab] = useState<Tab>('WATCHING')
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState<Sort>('updated')
  const [mode, setMode] = useState<DisplayMode>('grid')

  const rows = data?.viewerLists?.rows ?? []
  const lists = data?.viewerLists?.lists ?? []
  const counts = useMemo(() => tabCounts(rows), [rows])
  const shown = useMemo(() => shownRows(rows, { tab, term, sort, locale: intl.locale }), [rows, tab, term, sort, intl.locale])
  const reading = !data || lists.some(list => list.state === 'LOADING')
  const layout = mode === 'list' ? 'rows' : 'grid'
  const label = intl.formatMessage({ id: 'My list', defaultMessage: 'My list' })

  return (
    <div css={style}>
      <div className="heading-row">
        <div className="heading">{label}</div>
        <DisplayModeToggle mode={mode} modes={MODES} onChange={setMode}/>
      </div>
      <div className="tabs">
        {TABS.map(value => (
          <button key={value} type="button" className="tab" aria-pressed={tab === value} onClick={() => setTab(value)}>
            <span>{intl.formatMessage(STATUS_LABELS[value])}</span>
            <span className="count">{counts[value]}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        <FilterField label={intl.formatMessage({ id: 'Search', defaultMessage: 'Search' })}>
          <div className="text-field">
            <SearchIcon size={17}/>
            <input
              type="text"
              value={term}
              placeholder={intl.formatMessage({ id: 'Any title', defaultMessage: 'Any title' })}
              aria-label={intl.formatMessage({ id: 'Search by title', defaultMessage: 'Search by title' })}
              onInput={event => setTerm(event.currentTarget.value)}
            />
          </div>
        </FilterField>
        <FilterSelect
          label={intl.formatMessage({ id: 'Sort by', defaultMessage: 'Sort by' })}
          options={SORTS.map(value => ({ value, label: intl.formatMessage(SORT_LABELS[value]) }))}
          selected={[sort]}
          onChange={([picked]) => setSort((picked as Sort | undefined) ?? 'updated')}
        />
      </div>
      {lists.filter(list => list.state === 'ERROR' || list.state === 'PAUSED').map(list => (
        <div key={list._id} className="unread">
          {intl.formatMessage({ id: 'Could not read the list on {name}', defaultMessage: 'Could not read the list on {name}' }, { name: list.tracker.name })}
        </div>
      ))}
      {
        shown.length
          ? (
            <Paged key={`${tab} ${sort} ${term}`} items={shown} size={PAGE_SIZE} label={label}>
              {page => <div className={layout}>{page.map(row => <Item key={row._id} row={row}/>)}</div>}
            </Paged>
          )
          : reading
            ? <div className={layout}>{Array.from({ length: 12 }, (_, index) => <Placeholder key={index} className="pending"/>)}</div>
            : <div className="status">{intl.formatMessage({ id: 'No results found.', defaultMessage: 'No results found.' })}</div>
      }
    </div>
  )
}

export default List
