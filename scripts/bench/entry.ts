declare global { interface Window { __bench?: (arm: string) => Promise<unknown> } }

window.__bench = (arm: string) => new Promise(resolve => {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = event => { worker.terminate(); resolve(event.data) }
  worker.postMessage({ arm, sizes: { rows: 3000, points: 1000, scans: 18 } })
})
document.getElementById('out')!.textContent = 'ready'
export {}
