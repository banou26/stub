import { css } from '@emotion/react'
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useDismiss, useFloating, useInteractions, useRole
} from '@floating-ui/react'
import { PoweredByFkn } from '@fkn/lib/react'
import { ChevronDown, ListVideo, Search, Settings, X } from 'lucide-react'
import { defineMessages, useIntl } from 'react-intl'
import { Link, useLocation, useRoute, useSearch } from 'wouter'
import { useEffect, useRef, useState } from 'preact/hooks'

import { getRouterRoutePath, getRoutePath, Route } from '../router/path'
import { parseSearchFilters, searchPath } from '../router/search/params'
import { askForTop } from '../router/scroll-reset'
import AccountWidget, { menuStyle } from './account-widget'
import PartyWidget from './party-widget'
import { layer } from '../layers'
import { site, siteLinks } from '../site'
import { loadDevice } from '../plugin-list'
import { writePluginUris } from '../utils/plugin-links'

const PLACEHOLDERS = defineMessages({
  anime: { id: 'Search anime…', defaultMessage: 'Search anime…' },
  movie: { id: 'Search movies…', defaultMessage: 'Search movies…' },
  series: { id: 'Search shows…', defaultMessage: 'Search shows…' },
  stub: { id: 'Search anime, shows, movies…', defaultMessage: 'Search anime, shows, movies…' },
})

// each site by what it keeps, as home's category tabs name it (category-tabs.tsx)
const SITE_NAMES = defineMessages({
  movie: { id: 'Movies#category', defaultMessage: 'Movies', description: 'category' },
  series: { id: 'Series#category', defaultMessage: 'Series', description: 'category' },
  anime: { id: 'Anime#category', defaultMessage: 'Anime', description: 'category' },
  stub: { id: 'All#category', defaultMessage: 'All', description: 'category' },
})

// the brand, never translated
const WORDMARK = 'stub'

const LONG_PRESS = 500

// below this the site links wait in the wordmark's menu: in Russian and the pseudo-language they left the search
// under 300 px at 1024, with its placeholder cut (measured 2026-10-31 in Montserrat, DejaVu Sans and Noto Sans)
const LINKS_FROM = 1200

const style = css`
  position: fixed;
  /* the FKN broker's docked bar reserves the page's top strip with a root margin, which cannot
     move a fixed element; the variable is its half of the contract and reads 0 everywhere else */
  top: var(--fkn-inset-top, 0px);
  left: 0;
  right: 0;
  /* the bar itself; what its controls OPEN is layer.headerPopup, since a portalled menu inherits
     nothing from this one */
  z-index: ${layer.header};
  /* three tracks rather than a flex row: the search field stays centred on the VIEWPORT whatever the
     wordmark and the action cluster happen to measure, which auto margins on a flex item cannot promise */
  display: grid;
  grid-template-columns: 1fr minmax(0, 38rem) 1fr;
  align-items: center;
  gap: 2rem;
  /* an explicit height rather than padding, so --stub-header-height IS the bar rather than a number
     kept in sync with one */
  height: var(--stub-header-height);
  padding: 0 3rem;
  background: linear-gradient(180deg, rgba(15, 15, 15, 0.95) 0%, rgba(15, 15, 15, 0.55) 55%, rgba(15, 15, 15, 0) 100%);
  pointer-events: none;

  & > * {
    pointer-events: auto;
  }

  /* Docked rather than floating: /watch reserves this strip with its own top padding, so the bar sits
     ON the page instead of over it and the gradient has nothing left to fade across. It stays fixed,
     because "docked" here is about what is underneath it, not about scrolling away. Opaque and edged,
     since the thing below is the source's own player chrome and the two need a seam.

     The border costs no height: box-sizing is border-box globally, so --stub-header-height still IS
     the bar, which is what the pages reserving it measure. */
  &.docked {
    background: #0f0f0f;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    pointer-events: auto;
  }

  /* the wordmark and site links sit over the home theater's trailer, so they take its title's outline */
  .start {
    justify-self: start;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    text-shadow: rgb(0 0 0 / 80%) -1px -1px 0, rgb(0 0 0 / 80%) -1px 1px 0, rgb(0 0 0 / 80%) 1px -1px 0, rgb(0 0 0 / 80%) 1px 1px 0;

    /* the site links hide here and the arrow before the wordmark shows, which would give the row ITS baseline;
       centred, FKN's mark, as tall a box as the wordmark's, still sits on the wordmark's */
    @media (max-width: ${LINKS_FROM - 1}px) {
      align-items: center;
    }
  }

  .sites {
    display: flex;
    gap: 1.6rem;
    margin-inline-start: 1.4rem;
    font-size: 1.5rem;
    font-weight: 600;

    a {
      color: rgba(255, 255, 255, 0.75);

      &:hover,
      &[aria-current='page'] {
        color: #fff;
      }
    }

    @media (max-width: ${LINKS_FROM - 1}px) {
      display: none;
    }
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .sites-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;

    &:hover {
      color: #fff;
    }

    svg {
      transition: transform 0.15s;
    }

    &[aria-expanded='true'] svg {
      transform: rotate(180deg);
    }

    @media (max-width: ${LINKS_FROM - 1}px) {
      display: flex;
    }
  }

  /* FKN's mark is 1cap of its own font size, so it takes the wordmark's to stand as tall as its letters */
  .logo,
  .powered {
    font-size: 2.4rem;
  }

  .logo {
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #fff;

    &:hover {
      color: #fff;
    }

    /* a long press opens the site menu, so the phone's own link menu and text selection stay off it */
    &.sites-menu {
      -webkit-touch-callout: none;
      user-select: none;
    }
  }

  .actions {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }

  .icon-button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 4rem;
    height: 4rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.15s;

    &:hover {
      color: rgba(255, 255, 255, 0.9);
      border-color: rgba(255, 255, 255, 0.35);
    }
  }

  /* The whole pill is the field. The inset belongs to the INPUT rather than to this box: padding here
     is the form's own, so a click landing in it hits the form and sets no caret, and the field only
     took 19px of the bar's 38 that way. The glyph is drawn over the field instead of beside it, so
     the space it occupies stays part of the target. */
  .search {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    background: rgba(35, 35, 35, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    backdrop-filter: blur(8px);
    transition: border-color 0.2s ease, background 0.2s ease;

    &:focus-within {
      border-color: rgba(255, 255, 255, 0.35);
      background: rgba(35, 35, 35, 0.95);
    }

    & > svg {
      position: absolute;
      left: 1.4rem;
      top: 50%;
      transform: translateY(-50%);
      /* it labels the field, it is not a target of its own: a click on it belongs to the input under it */
      pointer-events: none;
      color: rgba(255, 255, 255, 0.6);
    }

    input {
      width: 100%;
      /* left clears the glyph: 1.4rem to it, its own 2rem, then the 0.8rem the flex gap used to give */
      padding: 0.8rem 1.4rem 0.8rem 4.2rem;
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-family: inherit;
      font-size: 1.5rem;

      &::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
    }
  }

  /* the row's words differ by font and language: with the party button's label gone (party-widget.tsx), this is what
     leaves the search its room where the site links show, in Montserrat and in a fallback alike */
  @media (max-width: 1359px) {
    gap: 1.2rem;

    .sites {
      gap: 1.2rem;
    }

    .actions {
      gap: 0.8rem;
    }
  }

  @media (max-width: 768px) {
    /* the outer tracks collapse to their content and the search takes what is left: centring it on
       the viewport costs more width than the viewport has */
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 1rem;
    padding: 0 1.5rem;

    .logo,
    .powered {
      font-size: 2rem;
    }

    .actions {
      gap: 0.8rem;
    }

    .icon-button {
      width: 3.4rem;
      height: 3.4rem;
    }

    .search {
      & > svg {
        left: 1rem;
      }

      input {
        padding: 0.6rem 1rem 0.6rem 3.8rem;
        font-size: 1.4rem;
      }
    }
  }

  .search-toggle,
  .search-close {
    display: none;
  }

  /* the row's one optional button: below this it leaves the search field under 200 px from 480 px, and below 480 it
     pushes the search button into the wordmark (24 px over at 360, measured 2026-10-30) */
  @media (max-width: 599px) {
    .list-link {
      display: none;
    }
  }

  /* below this the row has no room for a field beside the wordmark and the actions, so the field
     waits behind a button and opens over the whole row */
  @media (max-width: 479px) {
    gap: 0.4rem;
    padding: 0 0.8rem;

    .logo,
    .powered {
      font-size: 1.7rem;
    }

    .sites-toggle {
      width: 2.4rem;
    }

    .actions {
      gap: 0.4rem;
    }

    /* borderless like the site arrow: a 360 px row has no room for a fourth circle */
    .search-toggle {
      display: flex;
      justify-self: end;
      width: 2.8rem;
      height: 2.8rem;
      border: none;
    }

    /* the row's own buttons are taller than the field, so they would show around it */
    &.searching > .start,
    &.searching > .search-toggle,
    &.searching > .actions {
      visibility: hidden;
    }

    .search {
      display: none;

      &.open {
        display: flex;
        position: absolute;
        left: 1rem;
        right: 1rem;
        top: 50%;
        transform: translateY(-50%);
        width: auto;
        background: #232323;
      }
    }

    /* the close button beside it is its right inset */
    .search input {
      padding-right: 0;
    }

    .search-close {
      display: flex;
      flex-shrink: 0;
      align-items: center;
      padding: 0 1rem;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.6);
    }
  }

  /* below this the search button would cover FKN's mark */
  @media (max-width: 379px) {
    .powered {
      display: none;
    }
  }
`

const currentSiteStyle = css`
  [aria-current='page'] {
    color: #fff;
  }
`

// a link offers the next site only this device's own sources: an FKN account's list reaches it through
// the account, and offering those too would raise the invite dialog there before the list arrives
const SiteLinks = ({ className }: { className?: string }) => {
  const intl = useIntl()
  return (
    <>
      {siteLinks.map(link => (
        <a
          key={link.site}
          className={className}
          href={writePluginUris(link.href, loadDevice(), link.href)}
          aria-current={link.site === site ? 'page' : undefined}
        >
          {intl.formatMessage(SITE_NAMES[link.site])}
        </a>
      ))}
    </>
  )
}

/**
 * The wordmark goes home on a tap. On a host with site links, the arrow before it opens them as a menu, and so do a
 * long press or a right click on the wordmark itself.
 */
const Wordmark = () => {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const press = useRef<{ at: number, timer: ReturnType<typeof setTimeout>, opened?: true }>(undefined)
  // Escape hands focus back to whichever of the arrow and the wordmark opened the menu
  const opener = useRef<HTMLElement | null>(null)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: 'menu' })
  ])
  const openFrom = (element: HTMLElement) => {
    opener.current = element
    setOpen(true)
  }
  const release = () => {
    clearTimeout(press.current?.timer)
    press.current = undefined
  }
  const hasMenu = siteLinks.length > 0

  const wordmark = (
    // "home, from the top": the rule in router/scroll-reset.ts keeps the home page still under its
    // modal and on itself, and the wordmark is the one link that means the top of it anyway
    <Link
      to={getRoutePath(Route.HOME)}
      className={hasMenu ? 'logo sites-menu' : 'logo'}
      {...(hasMenu
        ? {
          onPointerDown: (event: PointerEvent) => {
            if (event.button !== 0) return
            release()
            const target = event.currentTarget as HTMLElement
            const timer = setTimeout(() => {
              press.current!.opened = true
              openFrom(target)
            }, LONG_PRESS)
            press.current = { at: event.timeStamp, timer }
          },
          // a busy page can handle a long press's release before its timer, and on touch Chrome can handle a short
          // tap's release after it; the events' own stamps still say how long the press was held, where the time
          // they were handled would not
          onPointerUp: (event: PointerEvent) => {
            if (!press.current) return
            const long = event.timeStamp - press.current.at >= LONG_PRESS
            if (long && !press.current.opened) openFrom(event.currentTarget as HTMLElement)
            if (!long && press.current.opened) setOpen(false)
            release()
          },
          onPointerLeave: release,
          onPointerCancel: release,
          onContextMenu: (event: MouseEvent) => {
            event.preventDefault()
            openFrom(event.currentTarget as HTMLElement)
          },
        }
        : {})}
      onClick={(event: MouseEvent) => {
        if (open) event.preventDefault()
        else askForTop()
      }}
    >
      {WORDMARK}
    </Link>
  )
  if (!hasMenu) return wordmark

  return (
    <span ref={refs.setReference} className="wordmark">
      <button
        type="button"
        className="sites-toggle"
        aria-label={intl.formatMessage({ id: 'Sites', defaultMessage: 'Sites' })}
        {...getReferenceProps({
          onClick: (event: MouseEvent) => {
            if (open) setOpen(false)
            else openFrom(event.currentTarget as HTMLElement)
          },
        })}
      >
        <ChevronDown size={16}/>
      </button>
      {wordmark}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} returnFocus={opener}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              css={[menuStyle, currentSiteStyle]}
              {...getFloatingProps({ onClick: () => setOpen(false) })}
            >
              <SiteLinks className="item"/>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </span>
  )
}

export const Header = () => {
  const intl = useIntl()
  const [, navigate] = useLocation()
  const [onLoginCallback] = useRoute(getRouterRoutePath(Route.LOGIN_CALLBACK))
  const [onWatch] = useRoute(getRouterRoutePath(Route.WATCH))
  const [onSearch] = useRoute(getRouterRoutePath(Route.SEARCH))
  // The filters live in the query string, so both halves of the box read it: the value shown, and the
  // filter set a keystroke must carry forward, so typing never wipes the year, season, format and
  // genres a user had set.
  const filters = parseSearchFilters(useSearch())
  const routeQuery = filters.query
  const [query, setQuery] = useState(routeQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  // only a phone's layout reads it: the field is open on the search page and after a tap on its button
  const [searchOpen, setSearchOpen] = useState(onSearch)

  useEffect(() => setSearchOpen(onSearch), [onSearch])

  useEffect(() => {
    if (searchOpen && !onSearch) inputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (document.activeElement !== inputRef.current && routeQuery !== query) setQuery(routeQuery)
  }, [routeQuery])

  // Pushes from any other page, so Back returns there, and replaces on the search page.
  const runSearch = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed && !onSearch) return
    navigate(searchPath({ ...filters, query: trimmed }), { replace: onSearch })
  }

  // /login/callback is an OAuth redirect target that calls close() on mount, not a page anyone reads.
  // A header there would mount the account broker's cross-origin iframe and a subscription that are
  // torn down milliseconds later, so it stays bare. Every route a user actually browses gets the bar.
  if (onLoginCallback) return null
  const searchLabel = intl.formatMessage({ id: 'Search', defaultMessage: 'Search' })
  const settingsLabel = intl.formatMessage({ id: 'Settings', defaultMessage: 'Settings' })
  const listLabel = intl.formatMessage({ id: 'My list', defaultMessage: 'My list' })

  return (
    <header css={style} className={[onWatch && 'docked', searchOpen && 'searching'].filter(Boolean).join(' ') || undefined}>
      <div className="start">
        <Wordmark/>
        <PoweredByFkn
          className="powered"
          label={intl.formatMessage({ id: 'Powered by FKN', defaultMessage: 'Powered by FKN' })}
          linkLabel={intl.formatMessage({ id: 'How it works', defaultMessage: 'How it works' })}
          href="https://docs.fkn.dev/user/"
        />
        {siteLinks.length > 0 && (
          <nav className="sites">
            <SiteLinks/>
          </nav>
        )}
      </div>
      <form
        className={searchOpen ? 'search open' : 'search'}
        onSubmit={event => {
          event.preventDefault()
          runSearch(query)
          inputRef.current?.blur()
        }}
      >
        <Search size={20} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder={intl.formatMessage(PLACEHOLDERS[site])}
          aria-label={searchLabel}
          onInput={event => {
            const value = event.currentTarget.value
            setQuery(value)
            runSearch(value)
          }}
          onKeyDown={event => {
            if (event.key !== 'Escape') return
            setSearchOpen(false)
            inputRef.current?.blur()
          }}
          onBlur={() => {
            if (!query.trim()) setSearchOpen(false)
          }}
        />
        <button
          type="button"
          className="search-close"
          aria-label={intl.formatMessage({ id: 'Close search', defaultMessage: 'Close search' })}
          // keeps the field focused through the press, so its blur does not close the row under the finger
          onPointerDown={event => event.preventDefault()}
          onClick={() => setSearchOpen(false)}
        >
          <X size={18}/>
        </button>
      </form>
      <button
        type="button"
        className="icon-button search-toggle"
        aria-label={searchLabel}
        aria-expanded={searchOpen}
        onClick={() => setSearchOpen(true)}
      >
        <Search size={20}/>
      </button>
      <div className="actions">
        <PartyWidget/>
        {/* the trackers keep anime alone */}
        {site === 'anime' || site === 'stub'
          ? (
            <Link to={getRoutePath(Route.LIST)} className="icon-button list-link" aria-label={listLabel} title={listLabel}>
              <ListVideo size={20}/>
            </Link>
          )
          : undefined}
        <Link to={getRoutePath(Route.SETTINGS)} className="icon-button" aria-label={settingsLabel} title={settingsLabel}>
          <Settings size={20}/>
        </Link>
        <AccountWidget/>
      </div>
    </header>
  )
}

export default Header
