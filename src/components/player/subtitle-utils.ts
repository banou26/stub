import type { ExternalSubtitleTrack } from '@banou/media-player'
import type { ExternalSubtitleFormat } from '@banou/media-player/engine'

export type SubtitlePosition = {
  x: number
  y: number
}

const SUBTITLE_EXTENSIONS: Readonly<Record<string, ExternalSubtitleFormat>> = {
  srt: 'srt',
  vtt: 'vtt',
  ass: 'ass',
  ssa: 'ass',
}

const SUBTITLE_MIME_TYPES = new Set([
  'text/vtt',
  'application/x-subrip',
  'application/subrip',
  'text/srt',
  'text/x-ssa',
  'text/x-ass',
  'text/ass',
])

const LANGUAGE_SUFFIX_ALIASES: Readonly<Record<string, string>> = {
  ara: 'ar',
  ces: 'cs',
  cze: 'cs',
  deu: 'de',
  ger: 'de',
  ell: 'el',
  gre: 'el',
  eng: 'en',
  spa: 'es',
  fra: 'fr',
  fre: 'fr',
  heb: 'he',
  hin: 'hi',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  msa: 'ms',
  may: 'ms',
  nld: 'nl',
  dut: 'nl',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rum: 'ro',
  rus: 'ru',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi',
  zho: 'zh',
  chi: 'zh',
  chs: 'zh-Hans',
  cht: 'zh-Hant',
  sc: 'zh-Hans',
  tc: 'zh-Hant',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  'pt-br': 'pt-BR',
  'es-419': 'es-419',
}

const TWO_LETTER_LANGUAGES = new Set([
  'ar', 'cs', 'de', 'el', 'en', 'es', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
])

let droppedCounter = 0

export const clampSubtitleOffset = (seconds: number): number => {
  if (!Number.isFinite(seconds)) return 0
  const clamped = Math.max(-300, Math.min(300, Math.round(seconds * 100) / 100))
  return Object.is(clamped, -0) ? 0 : clamped
}

export const clampSubtitleFontScale = (scale: number): number => {
  if (!Number.isFinite(scale)) return 1
  return Math.max(0.5, Math.min(2, Math.round(scale * 20) / 20))
}

export const clampSubtitleBackgroundOpacity = (opacity: number): number => {
  if (!Number.isFinite(opacity)) return 0.75
  const clamped = Math.max(0, Math.min(1, Math.round(opacity * 20) / 20))
  return Object.is(clamped, -0) ? 0 : clamped
}

export const clampSubtitlePosition = ({ x, y }: SubtitlePosition): SubtitlePosition => ({
  x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5,
  y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 1,
})

export const detectSubtitleFormat = (filename: string): ExternalSubtitleFormat | null => {
  const match = /\.([^.]+)$/.exec(filename.trim().toLowerCase())
  return match ? (SUBTITLE_EXTENSIONS[match[1]!] ?? null) : null
}

export const isSubtitleFile = (file: Pick<File, 'name' | 'type'>): boolean => {
  if (detectSubtitleFormat(file.name) !== null) return true
  const mime = file.type.trim().toLowerCase()
  return mime !== '' && SUBTITLE_MIME_TYPES.has(mime)
}

export const subtitleLabelFromFilename = (filename: string): { label: string, language: string } => {
  const trimmed = filename.trim()
  const stem = trimmed.replace(/\.(?:srt|vtt|ass|ssa)$/i, '').trim() || trimmed || 'Subtitles'
  const suffixMatch = /(?:^|[._\-[\](\s])(zh[-_](?:hans|hant|cn|tw|hk|sg)|pt[-_]br|es[-_]419|[a-z]{2,3})(?:\]|\))?$/i.exec(stem)
  let language = 'und'
  if (suffixMatch) {
    const token = suffixMatch[1]!.toLowerCase().replace('_', '-')
    if (token in LANGUAGE_SUFFIX_ALIASES) language = LANGUAGE_SUFFIX_ALIASES[token]!
    else if (TWO_LETTER_LANGUAGES.has(token)) language = token
  }
  return { label: stem, language }
}

export const readDroppedSubtitleFiles = async (
  files: Iterable<File>,
  idPrefix = 'drop',
): Promise<ExternalSubtitleTrack[]> => {
  const matched = Array.from(files).filter(isSubtitleFile)
  return Promise.all(matched.map(async (file) => {
    const format = detectSubtitleFormat(file.name) ?? 'srt'
    const { label, language } = subtitleLabelFromFilename(file.name)
    const content = await file.text()
    const seq = ++droppedCounter
    return {
      id: `${idPrefix}:${seq}:${file.name}`,
      language,
      label,
      format,
      content,
    }
  }))
}
