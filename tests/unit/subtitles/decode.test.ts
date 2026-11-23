import { describe, expect, test } from 'vite-plus/test'

import { decodeSubtitle } from '../../../src/subtitles/decode'

describe('decodeSubtitle', () => {
  test('strips UTF-8 BOM and decodes UTF-8 subtitles cleanly', () => {
    const body = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:03,000\nHello 世界\n')
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body])
    expect(decodeSubtitle(bytes, 'en')).toBe('1\n00:00:01,000 --> 00:00:03,000\nHello 世界\n')
  })

  test('decodes UTF-16LE and UTF-16BE BOM bytes', () => {
    // "Hi" in UTF-16LE with BOM: FF FE 48 00 69 00
    expect(decodeSubtitle(new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]))).toBe('Hi')
    // "Hi" in UTF-16BE with BOM: FE FF 00 48 00 69
    expect(decodeSubtitle(new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]))).toBe('Hi')
  })

  test('falls back to windows-1252, gb18030, and big5 on invalid UTF-8', () => {
    // "Café" in windows-1252: 0x43 0x61 0x66 0xE9
    expect(decodeSubtitle(new Uint8Array([0x43, 0x61, 0x66, 0xe9]), 'fr')).toBe('Café')

    // "中文" in GB18030: D6 D0 CE C4
    expect(decodeSubtitle(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), 'zh-Hans')).toBe('中文')

    // "中文" in Big5: A4 A4 A4 E5
    expect(decodeSubtitle(new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5]), 'zh-Hant')).toBe('中文')
  })
})
