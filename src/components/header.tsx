import { css } from '@emotion/react'
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useDismiss, useFloating, useInteractions, useRole
} from '@floating-ui/react'
import { Search, Settings } from 'lucide-react'
import { Link, useLocation, useRoute, useSearch } from 'wouter'
import { useEffect, useRef, useState } from 'preact/hooks'

import { getRouterRoutePath, getRoutePath, Route } from '../router/path'
import { parseSearchFilters, searchPath } from '../router/search/params'
import { askForTop } from '../router/scroll-reset'
import AccountWidget, { menuStyle } from './account-widget'
import PartyWidget from './party-widget'
import { layer } from '../layers'
import { site, siteLinks } from '../site'
import { loadEnabled } from '../plugin-list'
import { writePluginUris } from '../utils/plugin-links'

const PLACEHOLDERS = {
  anime: 'Search anime…',
  movie: 'Search movies…',
  series: 'Search shows…',
  stub: 'Search anime, shows, movies…',
}

const LONG_PRESS = 500

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
  grid-template-columns: 1fr minmax(0, 32rem) 1fr;
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

  .start {
    justify-self: start;
    display: flex;
    align-items: baseline;
    gap: 2.4rem;
  }

  .sites {
    display: flex;
    gap: 1.6rem;
    font-size: 1.5rem;
    font-weight: 600;

    @media (max-width: 1023px) {
      display: none;
    }
  }

  .logo {
    font-size: 2.4rem;
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

    svg {
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

  @media (max-width: 768px) {
    /* the outer tracks collapse to their content and the search takes what is left: centring it on
       the viewport costs more width than the viewport has */
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 1rem;
    padding: 0 1.5rem;

    .logo {
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
      svg {
        left: 1rem;
      }

      input {
        padding: 0.6rem 1rem 0.6rem 3.8rem;
        font-size: 1.4rem;
      }
    }
  }
`

const currentSiteStyle = css`
  [aria-current='page'] {
    color: #fff;
  }
`

// each site keeps its own list of sources, so a link offers the viewer's to the next one
const SiteLinks = ({ className }: { className?: string }) => (
  <>
    {siteLinks.map(link => (
      <a
        key={link.site}
        className={className}
        href={writePluginUris(link.href, loadEnabled(), link.href)}
        aria-current={link.site === site ? 'page' : undefined}
      >
        {link.label}
      </a>
    ))}
  </>
)

/** The wordmark goes home on a tap; on a host with site links, a long press or a right click opens them as a menu. */
const Wordmark = () => {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
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
  const release = () => clearTimeout(timer.current)
  const press = siteLinks.length > 0
    ? getReferenceProps({
      className: 'logo sites-menu',
      onPointerDown: (event: PointerEvent) => {
        if (event.button !== 0) return
        timer.current = setTimeout(() => setOpen(true), LONG_PRESS)
      },
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault()
        setOpen(true)
      },
    })
    : { className: 'logo' }

  return (
    <>
      {/* "home, from the top": the rule in router/scroll-reset.ts keeps the home page still under its
          modal and on itself, and the wordmark is the one link that means the top of it anyway */}
      <Link
        ref={refs.setReference}
        to={getRoutePath(Route.HOME)}
        {...press}
        onClick={(event: MouseEvent) => {
          if (open) event.preventDefault()
          else askForTop()
        }}
      >
        stub
      </Link>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
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
    </>
  )
}

export const Header = () => {
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

  return (
    <header css={style} className={onWatch ? 'docked' : undefined}>
      <div className="start">
        <Wordmark/>
        {siteLinks.length > 0 && (
          <nav className="sites" css={currentSiteStyle}>
            <SiteLinks/>
          </nav>
        )}
      </div>
      <form
        className="search"
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
          placeholder={PLACEHOLDERS[site]}
          aria-label="Search"
          onInput={event => {
            const value = event.currentTarget.value
            setQuery(value)
            runSearch(value)
          }}
        />
      </form>
      <div className="actions">
        <PartyWidget/>
        <Link to={getRoutePath(Route.SETTINGS)} className="icon-button" aria-label="Settings" title="Settings">
          <Settings size={20}/>
        </Link>
        <AccountWidget/>
      </div>
    </header>
  )
}

export default Header
