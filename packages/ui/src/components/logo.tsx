// Volt branding (fork seam — see CLAUDE.md "Fork surface"). Volt is a lightning-bolt
// mark + "Volt" wordmark (Inter). Theme-adaptive via the same --icon-* CSS vars opencode
// uses, so it follows light/dark. The exact brand SVG can replace BOLT later; the asset
// lives at packages/volt-app/assets/volt-brand.png.
import { type ComponentProps } from "solid-js"

// Lightning bolt, viewBox 0 0 24 24.
const BOLT =
  "M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-bolt" d={BOLT} fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={BOLT} fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 116 36"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(4 6) scale(1)">
        <path d={BOLT} fill="var(--icon-strong-base)" />
      </g>
      <text
        x="36"
        y="27"
        font-family="Inter, ui-sans-serif, system-ui, sans-serif"
        font-weight="600"
        font-size="28"
        fill="var(--icon-strong-base)"
      >
        Volt
      </text>
    </svg>
  )
}
