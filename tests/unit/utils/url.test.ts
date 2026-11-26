import { describe, expect, test } from 'vite-plus/test'

import { safeHttpUrl } from '../../../src/utils/url'

describe('safeHttpUrl', () => {
  test('accepts http and https URLs and rejects javascript, data, and malformed strings', () => {
    expect(safeHttpUrl('https://example.com/watch?id=1')).toBe('https://example.com/watch?id=1')
    expect(safeHttpUrl(' http://example.com/ep ')).toBe('http://example.com/ep')
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeUndefined()
    expect(safeHttpUrl('not a url')).toBeUndefined()
    expect(safeHttpUrl(undefined)).toBeUndefined()
  })
})
