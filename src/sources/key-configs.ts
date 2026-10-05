// Kept separate from the extractors - which pull in the frizbee and sacha wasm modules - so the settings page can read it on the main thread without pulling the worker/WASM bundle

/** The localStorage key holding the viewer's keys, a JSON object of key by source origin. */
export const API_KEYS_KEY = 'stub.apikeys'

export interface KeyConfig {
  origin: string
  name: string
  label: string
  getUrl: string
  help?: string
}

export const keyConfigs: KeyConfig[] = [
  {
    origin: 'omdb',
    name: 'OMDb',
    label: 'OMDb API key',
    getUrl: 'https://www.omdbapi.com/apikey.aspx',
    help: 'Free tier: 1,000 requests/day; choose the "FREE" account type on the form.',
  },
  {
    origin: 'trakt',
    name: 'Trakt',
    label: 'Trakt Client ID',
    getUrl: 'https://trakt.tv/oauth/applications',
    help: 'Create an app at trakt.tv/oauth/applications, then copy its Client ID. Free; no OAuth needed for public metadata.',
  },
  {
    origin: 'simkl',
    name: 'Simkl',
    label: 'Simkl Client ID',
    getUrl: 'https://simkl.com/settings/developer/new/',
    help: 'Create an app under Settings → Developer and paste its Client ID. Free for non-commercial use.',
  },
  {
    origin: 'tvdb',
    name: 'TheTVDB',
    label: 'TheTVDB API key',
    getUrl: 'https://www.thetvdb.com/dashboard/account/apikey',
    help: 'Paid/subscriber v4 key. User-supported keys also need a PIN; enter it as apikey:pin (e.g. ab12cd34:5678).',
  },
  {
    origin: 'watchmode',
    name: 'Watchmode',
    label: 'Watchmode API key',
    getUrl: 'https://api.watchmode.com/requestApiKey/',
    help: 'Free tier: ~1,000 requests/month. Request a key on the form and paste it here.',
  },
]
