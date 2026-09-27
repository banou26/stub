import type { Plugin } from 'vite-plus'

import { build } from 'vite-plus'

/**
 * `import source from './x.ts?page-script'`: the module x.ts, bundled with everything it imports
 * into ONE function expression, as a string for `frame.evaluate`.
 *
 * `frame.evaluate` runs a source string in the attached site's own realm as `(<source>\n)` and calls
 * it with its arg when it is a function (proxy-sandbox `locator-modules.ts`, and the extension's
 * main-world bridge). So the bundle is an IIFE wrapped in a function that returns the module's `run`
 * called with that arg: nothing lands on the page's globals, and nothing is imported at runtime.
 *
 * Built by a nested build of its own, with no config file, so none of the app's plugins, aliases or
 * polyfills reach a script that runs in someone else's page.
 */
export const PAGE_SCRIPT_QUERY = '?page-script'

const GLOBAL = '__stubPageScript'

/** The module at `entry`, as the function expression `frame.evaluate` calls. */
export const buildPageScript = async (entry: string): Promise<string> => {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      lib: { entry, formats: ['iife'], name: GLOBAL },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as { output?: { type: string, code?: string }[] }[]
  const chunk = outputs.flatMap(output => output.output ?? []).find(item => item.type === 'chunk')
  if (!chunk?.code) throw new Error(`page script: building ${entry} produced no chunk`)
  return `function (arg) {\n${chunk.code}\nreturn ${GLOBAL}.run(arg)\n}`
}

export const pageScript = (): Plugin => ({
  name: 'stub-page-script',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!source.endsWith(PAGE_SCRIPT_QUERY)) return null
    const resolved = await this.resolve(source.slice(0, -PAGE_SCRIPT_QUERY.length), importer, { skipSelf: true })
    return resolved ? `${resolved.id}${PAGE_SCRIPT_QUERY}` : null
  },
  async load(id) {
    if (!id.endsWith(PAGE_SCRIPT_QUERY)) return null
    const entry = id.slice(0, -PAGE_SCRIPT_QUERY.length)
    this.addWatchFile(entry)
    return `export default ${JSON.stringify(await buildPageScript(entry))}`
  },
})
