/** What vite.preview.config.ts builds into functions-lib/ for functions/_middleware.ts, before Pages compiles that directory. */
declare module '*/functions-lib/preview.js' {
  /** A fresh copy of every module of src/preview, with its own site, graph and asks in flight. */
  export const createPreview: () => typeof import('../preview')
}

/** A compiled module, which the Pages Functions build makes of a `.wasm` import. */
declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}
