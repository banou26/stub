import type { ComponentChildren } from 'preact'

/** A player's chrome: time runs left to right in every language, so a player keeps that direction on a right to left page. */
export const LeftToRight = ({ children }: { children: ComponentChildren }) => <div dir="ltr" style={{ display: 'contents' }}>{children}</div>

export default LeftToRight
