import type { BrowserStores, StoredItem } from './stored-data'

import { useRef, useState } from 'preact/hooks'

import { ConfirmAction } from './confirm'
import { SETTINGS_SECTIONS } from './sections'
import { STORED, clearStored, holdsAnything, isClearedHere } from './stored-data'

export type DataProps = {
  stores: BrowserStores
  /** An item's own clear, run instead of removing its keys, for an item that is more than its keys. */
  clearers?: Partial<Record<string, () => Promise<unknown> | void>>
  /** Called with the item's id once its Clear ran. */
  onCleared?: (id: string) => void
}

const sectionTitle = (id: string) => SETTINGS_SECTIONS.find(section => section.id === id)?.title

// 'Added sources' reads as 'Clear added sources', and 'API keys' keeps its capitals
const inSentence = (title: string) => /^[A-Z][a-z]/.test(title) ? title[0]!.toLowerCase() + title.slice(1) : title

const Item = ({ item, stores, clearers, onCleared, onClear }: { item: StoredItem, onClear: () => void } & DataProps) => {
  const holds = holdsAnything(item, stores)
  const heading = useRef<HTMLHeadingElement>(null)
  const clear = async () => {
    const own = clearers?.[item.id]
    if (own) await own()
    else clearStored(item, stores)
    onCleared?.(item.id)
    onClear()
  }

  return (
    <div className="row" data-stored={item.id}>
      <div className="head">
        <h3 ref={heading} tabIndex={-1}>{item.title}</h3>
        {item.keys && !holds ? <span className="state">Nothing kept</span> : undefined}
      </div>
      <p>{item.what}</p>
      <dl className="facts">
        <dt>Where</dt>
        <dd>{item.where}</dd>
        <dt>How long</dt>
        <dd>{item.lasts}</dd>
      </dl>
      {isClearedHere(item)
        ? holds
          ? (
            <div className="actions">
              <ConfirmAction
                label="Clear"
                name={`Clear ${inSentence(item.title)}`}
                confirmLabel="Yes, clear"
                busyLabel="Clearing..."
                question={item.confirm ?? `Clear ${inSentence(item.title)}?`}
                onConfirm={clear}
                home={heading}
              />
            </div>
          )
          : undefined
        : (
          <p className="cleared-by">
            {item.clearedBy?.text}
            {item.clearedBy?.section
              ? <> <a className="link" href={`#${item.clearedBy.section}`}>Go to {sectionTitle(item.clearedBy.section)}</a></>
              : undefined}
          </p>
        )}
    </div>
  )
}

/** What stub keeps per viewer, where and for how long, with one Clear per item it can clear, asked first. */
export const DataSection = ({ stores, clearers, onCleared }: DataProps) => {
  // what an item holds is read on every render, so a clear only has to ask for one
  const [, setRevision] = useState(0)
  const onClear = () => setRevision(revision => revision + 1)

  return (
    <div className="rows">
      {STORED.map(item => <Item key={item.id} item={item} stores={stores} clearers={clearers} onCleared={onCleared} onClear={onClear}/>)}
    </div>
  )
}
