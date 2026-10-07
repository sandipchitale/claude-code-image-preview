export type PreviewFile = { path: string; generation: number }

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      draft: string
      files: Record<string, PreviewFile>
      origins: Record<string, string>
      selected: number
    }
  }
}
