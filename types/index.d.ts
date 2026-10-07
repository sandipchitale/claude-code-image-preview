export type PreviewFile = { path: string }

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      draft: string
      files: Record<string, PreviewFile>
      origins: Record<string, string>
      cleared: Record<string, boolean>
    }
  }
}
