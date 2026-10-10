import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'
import mermaid from 'astro-mermaid'

import { sidebar } from './src/sidebar.mjs'

export default defineConfig({
  integrations: [
    // BEFORE starlight, so a ```mermaid fence is transformed into the diagram component before
    // starlight renders the page around it. Registered the other way round the fence survives as a
    // plain code block and every diagram on the site silently becomes a wall of text.
    mermaid({
      theme: 'neutral',
      autoTheme: true,
      mermaidConfig: {
        // The diagrams here are wide: the flow crosses ~36 sources, a worker, three id spaces and a
        // read pipeline. `htmlLabels` is what lets a node carry a second line in a smaller face, which
        // is how a decision node states its CONDITION under its question without doubling in width.
        flowchart: { htmlLabels: true, curve: 'basis', nodeSpacing: 42, rankSpacing: 54 },
        sequence: { showSequenceNumbers: true, wrap: true, width: 168 },
        themeVariables: { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
      },
    }),
    starlight({
      title: 'stub',
      description:
        'How data moves through stub: which sources are asked, what each one is allowed to claim, how the store merges the answers, and every decision taken on the way.',
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/banou26/stub' }],
      sidebar,
      customCss: ['./src/styles/custom.css'],
      pagination: true,
      lastUpdated: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    }),
  ],
})
