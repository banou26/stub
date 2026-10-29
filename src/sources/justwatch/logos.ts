// JustWatch's 100 px icon of each service its packages map to (PACKAGE_ORIGIN_MAP), sharper than the sites' own
// favicons. Ids read from JustWatch's `packages { shortName icon(profile: S100) }` on 2026-10-26, all 19 still served
// on 2026-10-30; an id JustWatch retires answers 404, so its image fails and the source's own icon shows instead.
const ICONS: Readonly<Record<string, string>> = {
  nf: '207360008/s100/netflix', amazon: '322992749/s100/amazonprime', appletv: '338367329/s100/appletvplus',
  disney: '313118777/s100/disneyplus', hulu: '116305230/s100/hulu', fubo: '316727345/s100/fubotv',
  cr: '324213205/s100/crunchyroll', paramount: '332803145/s100/paramountpluspremium', philo: '327419079/s100/philo',
  roku: '76972041/s100/rokuchannel', amcplus: '277399832/s100/amcplus', hoopla: '80212823/s100/hoopla',
  pluto: '312204955/s100/plutotv', hidive: '254161830/s100/hidive', plex: '301832745/s100/plex',
  hbo: '332884837/s100/max', starz: '301254735/s100/starz', peacock: '194173871/s100/peacocktvpremium',
  tubi: '313528601/s100/tubitv',
}

/** A streaming service's sharp logo by its origin id, or undefined for an origin JustWatch lists no package for. */
export const serviceLogo = (origin: string): string | undefined =>
  ICONS[origin] ? `https://images.justwatch.com/icon/${ICONS[origin]}.webp` : undefined
