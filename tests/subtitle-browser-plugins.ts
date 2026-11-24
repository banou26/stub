import * as fake from './fake-plugins'

fake.SPEC_PLUGINS['npm:@spec/subtitles-only'] = {
  state: 'connected',
  sources: [{
    origin: 'spec-subs',
    name: 'Spec Subtitles',
    isApiOnly: true,
    subtitlesOnly: true,
    hasSubtitles: true,
  }],
}

export * from './fake-plugins'
