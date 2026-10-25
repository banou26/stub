/** The viewer's browser's own fetch, the path ./direct-fetch.ts sends a host on; a module of its own so the browser rig can stand in for it. */
export const browserFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => globalThis.fetch(input, init)
