export type PastedImage = { n: number; prompt: string; name: string; mediaType: string; png?: string }
export type Item = { text: string; done: boolean }

declare module 'claude-code' {
  interface PluginState {
    'my-todos': { items: Shaped<Item[]>; pics: Shaped<PastedImage[]>; picked: Shaped<number | null>; picCount: Shaped<number> }
  }
}
