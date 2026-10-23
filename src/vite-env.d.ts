
/** Injected by vite from package.json's version; rendered in the footer. */
declare const __STUB_VERSION__: string
declare const __STUB_COMMIT__: string
/** stub's embed.html, resolved by vite against the chunk that names it. See scripts/embed-page.ts. */
declare const __STUB_EMBED_PAGE__: string

/** A module bundled into one function expression for `frame.evaluate`. See scripts/page-script.ts. */
declare module '*?page-script' {
  const source: string
  export default source
}

/** A saved page, as vite's `?raw` hands it over. */
declare module '*.html?raw' {
  const source: string
  export default source
}

/** vite's glob import, the one form used: a lazy importer of each matching file's default export, by its path. */
interface ImportMeta {
  glob: <T>(pattern: string, options: { import: 'default' }) => Record<string, () => Promise<T>>
}
