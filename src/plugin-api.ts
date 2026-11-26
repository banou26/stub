import type { Resolvers } from './generated/schema/types.generated'
import type { StubPlugin as SdkStubPlugin, StubSource as SdkStubSource } from './plugin-sdk'

export * from './plugin-sdk'

export type StubSource = SdkStubSource<Resolvers>
export type StubPlugin = SdkStubPlugin<Resolvers>
export type StubPluginAPI = StubPlugin
