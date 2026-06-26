// Asset module shims so tsgo can typecheck through @opencode-ai/ui components
// (e.g. file-icon.tsx imports `./file-icons/sprite.svg`). Vite handles these at build.
declare module "*.svg" {
  const src: string
  export default src
}
declare module "*.css" {}
