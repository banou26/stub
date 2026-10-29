// Words the worker hands the page, which the page writes in its language where it shows them (wordsOf, ./index.ts),
// since the worker loads no catalogue. Import free, so the worker and a site's page script write them too.

/**
 * Words for the viewer: one of stub's messages, by its id, with its values; or a string, a site's or an error's own
 * words, shown as they came.
 */
export type Said = string | SaidMessage

/** One of stub's messages, as `forPage.formatMessage` writes it. Its id is its English. */
export type SaidMessage = { readonly message: string, readonly values?: Readonly<Record<string, SaidValue>> }

/**
 * A message's value: a string or a number, shown as given; a message, written first; a moment, shown as a time of day
 * (`03:05 PM`); or a list, each item written, then joined in the language, `and` as a sentence joins (`A, B and C`),
 * `names` as stub joins names (NAME_LIST, `A, B, C` in US English).
 */
export type SaidValue =
  | string
  | number
  | SaidMessage
  | { readonly time: number }
  | { readonly list: readonly SaidValue[], readonly join: 'and' | 'names' }

/**
 * Writes one of stub's messages where no catalogue is loaded, for the page to word: the descriptor and values
 * `intl.formatMessage` takes, less a description, since the page reads the id as the English. Named as react-intl's
 * so the linter and `npm run i18n:check` read each call as they read every `intl.formatMessage`, its values against
 * its placeholders included.
 */
export const forPage = {
  formatMessage: (descriptor: { id: string, defaultMessage: string }, values?: SaidMessage['values']): SaidMessage =>
    values ? { message: descriptor.id, values } : { message: descriptor.id },
}

/**
 * An error the viewer reads as `said`, `message` its English for the console (the id, unless values are written in).
 * The words ride as the error's `cause`, since osra carries an error across a port as its name, message, stack and
 * cause alone. saidOf reads them back.
 */
export const saidError = (said: SaidMessage, message = said.message) => new Error(message, { cause: said })

/** What an error says to the viewer: the words saidError gave it, or else its own message, as it came. */
export const saidOf = (error: unknown): Said => {
  const { cause, message } = (error ?? {}) as { cause?: unknown, message?: unknown }
  // a plain object in any realm, where an Error cause reads [object Error]
  if (Object.prototype.toString.call(cause) === '[object Object]' && typeof (cause as SaidMessage).message === 'string') return cause as SaidMessage
  return typeof message === 'string' ? message : String(error)
}
