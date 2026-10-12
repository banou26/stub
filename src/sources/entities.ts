// HTML's names for U+00A0 to U+00FF, in code point order. MyAnimeList's title pages write every
// accented letter by name (`&eacute;`, `&iuml;`), measured on 57 pages on 2026-10-13.
const LATIN_1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 '
  + 'acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde '
  + 'Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute '
  + 'Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde '
  + 'auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute '
  + 'ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'

const NAMED: Record<string, string> = {
  ...Object.fromEntries(LATIN_1.split(' ').map((name, index) => [name, String.fromCharCode(0xa0 + index)])),
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  bull: '\u2022', hellip: '\u2026',
}

/** `text` with its numeric character references read, and the named ones these sites send. Any other name stays as written. */
export const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&([a-z]+\d*);/gi, (match, name) => NAMED[name] ?? NAMED[name.toLowerCase()] ?? match)
