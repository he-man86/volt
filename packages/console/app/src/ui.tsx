// Inlined from opencode's @opencode-ai/ui — only the bits console/app actually used
// (createSimpleContext + Favicon). The rest of that package (v2/, icons, agent-GUI
// components) was unused here, so it's not vendored. See openspec/changes/commercial-cloud-backend/DIVERGENCE.md.
import { createContext, createMemo, Show, useContext, type ParentProps, type Accessor } from "solid-js"
import { Meta, Link } from "@solidjs/meta"

export function createSimpleContext<T, Props extends Record<string, any>>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      const isReady = createMemo(() => {
        // @ts-expect-error
        const ready = init.ready as Accessor<boolean> | boolean | undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })
      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}

export const Favicon = () => {
  // Volt brand icon (the orange lightning mark). SVG favicon covers modern browsers; the apple-touch-icon PNG is
  // for Safari/iOS (it ignores SVG there). Rasters generated from volt-mark.svg by scripts/gen-favicon.ts.
  return (
    <>
      <Link rel="icon" href="/volt-mark.svg" type="image/svg+xml" />
      <Link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <Meta name="apple-mobile-web-app-title" content="Volt" />
    </>
  )
}
