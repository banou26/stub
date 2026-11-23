const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const UTF16_LE_DECODER = new TextDecoder('utf-16le')
const UTF16_BE_DECODER = new TextDecoder('utf-16be')

const TRADITIONAL_CHINESE_TAGS = new Set(['zh-Hant', 'zh-TW', 'zh-HK', 'zh-MO'])
const CHINESE_PREFIX = 'zh'

function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

function fallbackEncodingFor(language?: string): string {
  if (!language) return 'windows-1252'
  if (TRADITIONAL_CHINESE_TAGS.has(language) || language.toLowerCase().includes('hant')) return 'big5'
  if (language === CHINESE_PREFIX || language.toLowerCase().startsWith('zh-')) return 'gb18030'
  return 'windows-1252'
}

export function decodeSubtitle(bytes: Uint8Array, language?: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return stripBom(new TextDecoder('utf-8').decode(bytes.subarray(3)))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(UTF16_LE_DECODER.decode(bytes.subarray(2)))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripBom(UTF16_BE_DECODER.decode(bytes.subarray(2)))
  }

  try {
    return stripBom(UTF8_DECODER.decode(bytes))
  } catch {
    const fallback = fallbackEncodingFor(language)
    return stripBom(new TextDecoder(fallback).decode(bytes))
  }
}
