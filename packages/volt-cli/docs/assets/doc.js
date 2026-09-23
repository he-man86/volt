/*
 * Volt bridge docs — the shared page shell and the renderers for the GENERATED tables.
 *
 * `window.VOLT` is written by `test/Volt.Engine.Tests/docs/DocDataTests.cs` into `assets/data.js` and loaded
 * as a <script src>, not fetched — so every page opens straight from file:// with no server. Nothing in here
 * hard-codes a wire field, an item kind or a driver member; if it is a fact, it came from the bundle.
 */

const PAGES = [
  ["index.html", "Overview"],
  ["wire.html", "The wire"],
  ["driver.html", "The driver layer"],
  ["items.html", "Items & kinds"],
  ["network-text.html", "Network text"],
  ["logs.html", "Logs & diagnosis"],
]

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

/** `code`-spans and *emphasis* in the summaries that travel inside the generated JSON. */
const md = (s) =>
  esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")

const slug = (s) =>
  s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-")

const refName = (s) => String(s).split("/").pop()

// ── the shell ───────────────────────────────────────────────────────────────

/** The stem of the page being viewed. A static server may serve `driver.html` at `/driver`, so the compare
 *  is on the stem rather than the filename — otherwise the sidebar highlights nothing when it is served. */
function currentPage() {
  const file = location.pathname.split("/").pop()
  return (file === "" ? "index" : file).replace(/\.html$/, "")
}

/** Sidebar: every page, plus the current page's own h2/h3 so a long page is still navigable. */
function buildNav() {
  const here = currentPage()
  const nav = document.querySelector("nav")
  const sections = [...document.querySelectorAll("main h2, main h3")]
    .filter((h) => h.id)
    .map((h) => `<a class="sec ${h.tagName === "H3" ? "sub" : ""}" href="#${h.id}">${esc(h.textContent)}</a>`)
    .join("")

  nav.innerHTML = `
    <a class="brand" href="index.html">Volt bridge</a>
    <div class="tag">One live PLC IDE, over a named pipe.</div>
    <h2>Documents</h2>
    ${PAGES.map(([href, title]) =>
      `<a class="page" href="${href}"${href.replace(/\.html$/, "") === here ? ' aria-current="page"' : ""}>${title}</a>`).join("")}
    ${sections ? `<h2>On this page</h2>${sections}` : ""}
    <h2>Artefacts</h2>
    <a class="page" href="volt-bridge.openrpc.json">volt-bridge.openrpc.json</a>`
}

function buildThemeToggle() {
  const dark = () =>
    document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches

  const btn = document.createElement("button")
  btn.className = "theme"
  btn.textContent = "theme"
  btn.onclick = () => {
    document.documentElement.dataset.theme = dark() ? "light" : "dark"
    // Mermaid picks its palette at init, so the page reloads rather than half-repainting.
    location.reload()
  }
  document.body.prepend(btn)
  return dark
}

async function initMermaid(dark) {
  if (!document.querySelector(".mermaid")) return
  const { default: mermaid } = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
  // `run()`, not `startOnLoad` — the import resolves AFTER the load event, so the auto-hook has nothing left
  // to fire on and every diagram stays on the page as its own source text.
  mermaid.initialize({ startOnLoad: false, theme: dark() ? "dark" : "default", securityLevel: "loose" })
  await mermaid.run({ querySelector: ".mermaid" })
}

// ── generated-table renderers ───────────────────────────────────────────────

/** A JSON-Schema node as a readable type, linking `$ref`s to their schema card. */
function typeOf(schema) {
  if (!schema) return "—"
  if (schema.$ref) {
    const n = refName(schema.$ref)
    return `<a href="#schema-${n}">${n}</a>`
  }
  if (schema.type === "array") return `${typeOf(schema.items)}[]`
  if (schema.type === "object" && schema.additionalProperties)
    return `map&lt;string, ${typeOf(schema.additionalProperties)}&gt;`
  if (schema.enum) return schema.enum.map((e) => `<code>${esc(e)}</code>`).join(" | ")
  return schema.type || "object"
}

/** The field table for a schema (or a `$ref` to one). An ABSENT optional field is not the same as an empty
 *  one on this wire — `toFolder` unset means "leave it where it is" — so optionality is marked, not implied. */
function fieldTable(schema, doc) {
  const s = schema?.$ref ? doc.components.schemas[refName(schema.$ref)] : schema
  if (!s?.properties) return ""
  const req = new Set(s.required || [])
  const rows = Object.entries(s.properties)
    .map(([k, v]) => `<tr><td class="name">${esc(k)}${req.has(k) ? "" : ' <span class="opt">optional</span>'}</td>
        <td>${typeOf(v)}</td></tr>`)
    .join("")
  return `<table><tr><th>field</th><th>type</th></tr>${rows}</table>`
}

function renderOps(el) {
  const doc = window.VOLT.openrpc
  el.innerHTML = doc.methods
    .map((m) => {
      const param = m.params?.[0]?.schema
      const result = m.result?.schema
      return `<section class="entry" id="op-${m.name}">
        <header><span class="name">${m.name}</span>
          ${param ? `<span class="pill">takes ${refName(param.$ref || "object")}</span>`
                  : `<span class="pill">no body</span>`}
          ${result?.$ref ? `<span class="pill">returns ${refName(result.$ref)}</span>` : ""}
        </header>
        <div class="body">
          <p>${md(m.summary)}</p>
          <div class="cols">
            <div><div class="lbl req">request body</div>
              ${param ? fieldTable(param, doc) : '<p class="lede">none</p>'}</div>
            <div><div class="lbl res">result</div>
              ${fieldTable(result, doc) || `<pre>${esc(JSON.stringify(result, null, 2))}</pre>`}</div>
          </div>
        </div>
      </section>`
    })
    .join("")
}

function renderSchemas(el) {
  const doc = window.VOLT.openrpc
  el.innerHTML = Object.keys(doc.components.schemas)
    .sort()
    .map((n) => {
      const s = doc.components.schemas[n]
      return `<section class="entry" id="schema-${n}">
        <header><span class="name">${n}</span></header>
        <div class="body">
          ${s.description ? `<p>${md(s.description)}</p>` : ""}
          ${fieldTable(s, doc) || '<p class="lede">no fields</p>'}
          <details><summary>raw JSON Schema</summary><pre>${esc(JSON.stringify(s, null, 2))}</pre></details>
        </div>
      </section>`
    })
    .join("")
}

const flag = (on) => (on ? '<span class="yes">✓</span>' : '<span class="no">·</span>')

function renderKinds(el) {
  const rows = window.VOLT.kinds
    .map(
      (k) => `<tr>
        <td class="num">${k.code}</td>
        <td class="name">${k.constant}</td>
        <td class="name">${k.kind ? esc(k.kind) : '<span class="no">not emitted</span>'}</td>
        <td class="name">${k.ext ? "." + k.ext : '<span class="no">·</span>'}</td>
        <td>${flag(k.source)}</td>
        <td>${flag(k.addressable)}</td>
        <td>${flag(k.member)}</td>
        <td>${flag(k.container)}</td>
      </tr>`,
    )
    .join("")
  el.innerHTML = `<table>
    <tr><th>code</th><th>constant</th><th>wire kind</th><th>file</th>
        <th>ST source</th><th>addressable</th><th>member</th><th>container</th></tr>
    ${rows}</table>`
}

function renderExtensions(el) {
  el.innerHTML = `<table>
    <tr><th>extension</th><th>ST source</th><th>a push may write it</th></tr>
    ${window.VOLT.extensions
      .map((e) => `<tr><td class="name">.${e.ext}</td><td>${flag(e.source)}</td><td>${flag(e.writable)}</td></tr>`)
      .join("")}</table>`
}

function renderDriver(el) {
  el.innerHTML = window.VOLT.driver
    .map(
      (f) => `<section class="entry" id="facet-${f.name}">
        <header><span class="name">${f.name}</span><span class="pill">${esc(f.role)}</span></header>
        <div class="body"><table>
          <tr><th>member</th><th>signature</th></tr>
          ${f.members
            .map((m) => `<tr><td class="name" id="m-${m.name}">${m.name}</td>
                             <td class="mono">${esc(m.signature)}</td></tr>`)
            .join("")}
        </table></div>
      </section>`,
    )
    .join("")
}

function renderList(el, values) {
  el.innerHTML = values.map((v) => `<code>${esc(v)}</code>`).join(" · ")
}

// ── boot ────────────────────────────────────────────────────────────────────

const RENDERERS = {
  ops: renderOps,
  schemas: renderSchemas,
  kinds: renderKinds,
  extensions: renderExtensions,
  driver: renderDriver,
  errors: (el) => renderList(el, window.VOLT.errors),
  "op-names": (el) => renderList(el, window.VOLT.ops),
  vendors: (el) => renderList(el, window.VOLT.vendors),
}

document.addEventListener("DOMContentLoaded", async () => {
  // Render the generated blocks BEFORE the nav, so headings they add are in the "on this page" list.
  for (const [name, render] of Object.entries(RENDERERS)) {
    const el = document.querySelector(`[data-render="${name}"]`)
    if (el) render(el)
  }
  buildNav()
  const dark = buildThemeToggle()
  await initMermaid(dark)
})
