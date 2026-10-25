import { shell } from '@fkn/lib'

import { party } from '../party'
import { isSiteHost } from '../site'
import { watchBuild } from './build-check'
import { createUpdateGate } from './gate'

const updates = createUpdateGate({ party })

// registering a handler replaces the lib's default, which reloads the page at once
shell.onUpdateTaken(updates.due)

// a sandbox tenant serves the package version fkn.app chose, so only stub's own hosts look for a deploy
if (import.meta.env.PROD && isSiteHost(location.hostname)) watchBuild(updates.due)
