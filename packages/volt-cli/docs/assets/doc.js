/*
 * Volt bridge docs — the shared page shell and the renderers for the GENERATED tables.
 *
 * `window.VOLT` is written by `test/Volt.Engine.Tests/docs/DocDataTests.cs` into `assets/data.js` and loaded
 * as a <script src>, not fetched — so every page opens straight from file:// with no server. Nothing in here
 * hard-codes a wire field, an item kind or a driver member; if it is a fact, it came from the bundle.
 */

/**
 * The pages, GROUPED THE WAY A CHANGE TRAVELS — you type a verb, the connector decides which bridge serves
 * it, the verb sends ops over the wire, the driver puts them into the IDE. Reading top to bottom follows one
 * edit from a keystroke to the PLC, which is the only ordering that answers "where does my thing go next".
 *
 * The formats come after the chain because they are what TRAVELS along it, not a step in it; operating comes
 * last because it is what you read when the chain misbehaved.
 */
const GROUPS = [
  ["Start here", [["index.html", "Overview"]]],
  [
    "The chain",
    [
      ["cli.html", "1 · The CLI"],
      ["connector.html", "2 · The connector"],
      ["wire.html", "3 · The wire"],
      ["driver.html", "4 · The driver"],
    ],
  ],
  [
    "What travels",
    [
      ["items.html", "Items & kinds"],
      ["network-text.html", "Network text"],
    ],
  ],
  ["Operating", [["logs.html", "Logs & diagnosis"]]],
]


import { consoleMeta, runBanner, panel, bindPanels, callConsole } from "./console.js"

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

/**
 * Sidebar: every page, plus a table of contents for the current one.
 *
 * The TOC includes the GENERATED entries — every op, every schema, every driver facet — not just the
 * headings. Those are `section.entry` rather than an `h2`, so a nav built from headings alone silently drops
 * the twenty-odd rows that are the whole reason to open the wire page, and `push` becomes something you
 * scroll for instead of click. Document order comes free from one querySelectorAll over all three selectors.
 */
function buildNav() {
  const here = currentPage()
  const nav = document.querySelector("nav")
  const sections = [...document.querySelectorAll("main h2[id], main h3[id], main section.entry[id]")]
    .map((el) => {
      if (el.tagName === "SECTION") {
        const label = el.querySelector("header .name")?.textContent ?? el.id
        return `<a class="sec sub mono" href="#${el.id}">${esc(label)}</a>`
      }
      return `<a class="sec ${el.tagName === "H3" ? "sub" : ""}" href="#${el.id}">${esc(el.textContent)}</a>`
    })
    .join("")

  nav.innerHTML = `
    <a class="brand" href="index.html">Volt bridge</a>
    <div class="tag">One live PLC IDE, over a named pipe.</div>
    ${GROUPS.map(
      ([group, pages]) =>
        `<h2>${group}</h2>` +
        pages
          .map(
            ([href, title]) =>
              `<a class="page" href="${href}"${href.replace(/\.html$/, "") === here ? ' aria-current="page"' : ""}>${title}</a>`,
          )
          .join(""),
    ).join("")}
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
      const errs = m["x-errorCodes"] || []
      const outs = m["x-outcomes"] || []
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
          <div class="lbl err">error frames this op can answer with</div>
          <p class="codes">${errs.length
            ? errs.map((e) => `<a class="code" href="#errors">${esc(e)}</a>`).join(" ")
            : '<span class="lede">none — this op cannot fail.</span>'}</p>
          ${outs.length ? `<div class="lbl">and how else it can fail</div>
            <ul class="outcomes">${outs.map((o) => `<li>${md(o)}</li>`).join("")}</ul>` : ""}
          ${panel(
            `op-${m.name}`,
            `Call ${m.name}`,
            JSON.stringify({ op: m.name, body: param ? {} : undefined }, null, 2),
          )}
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

const S = () => window.VOLT_SURFACES ?? { connector: { routes: [] }, cli: { verbs: [] } }

// ── the connector control plane ─────────────────────────────────────────────

/** A sendable body for a documented route, from the shape the description spells. */
function exampleBody(route) {
  if (!route.body) return undefined
  return route.path.endsWith("/sync") ? { interests: [{ vendor: "codesys", projectName: "" }] } : {}
}

function renderConnectorRoutes(el) {
  const c = S().connector
  el.innerHTML = c.routes
    .map((r, i) => {
      const id = `conn-${i}`
      // PREFILL WHAT THE ROUTE DOCUMENTS. The example body was read, then discarded in favour of `{}` — so
      // `/session/{id}/sync`, described as THE PRIMARY CALL, offered an empty object and a literal `{id}` in
      // the path, and Send taught the reader nothing. The one piece of data that makes the panel work was
      // sitting in an unused variable.
      const example = exampleBody(r)
      // `{id}` is a SESSION id on the session routes and a WORKER id on the restart route — the same three
      // characters naming two different things, so the placeholder says which one to paste.
      const path = r.path.replace("{id}", r.path.startsWith("/workers") ? "PASTE-A-WORKER-ID" : "PASTE-A-SESSION-ID")
      return `<section class="entry" id="route-${r.method}-${r.path.replace(/[/{}]/g, "_")}">
        <header><span class="name">${r.method} ${esc(r.path)}</span>
          ${r.body ? '<span class="pill">takes a body</span>' : '<span class="pill">no body</span>'}
          <span class="pill">returns ${esc(r.result)}</span>
        </header>
        <div class="body">
          <p>${md(r.summary)}</p>
          <div class="lbl err">answers</div>
          <table><tr><th>status</th><th>when</th></tr>
            ${r.responses.map((x) => `<tr><td class="num">${x.code}</td><td>${md(x.when)}</td></tr>`).join("")}
          </table>
          ${panel(id, `Send ${r.method} ${r.path}`, JSON.stringify({ path, method: r.method, ...(example === undefined ? {} : { body: example }) }, null, 2))}
        </div>
      </section>`
    })
    .join("")
}

function renderConnectorSchemas(el) {
  const schemas = S().connector.schemas ?? {}
  el.innerHTML = Object.entries(schemas)
    .map(
      ([name, sc]) => `<section class="entry" id="cs-${name}">
        <header><span class="name">${name}</span></header>
        <div class="body">
          ${sc.description ? `<p>${md(sc.description)}</p>` : ""}
          <table><tr><th>field</th><th>type</th><th>note</th></tr>
            ${sc.fields.map((f) => `<tr><td class="name">${esc(f.name)}</td><td class="mono">${esc(f.type)}</td><td>${md(f.note)}</td></tr>`).join("")}
          </table>
        </div>
      </section>`,
    )
    .join("")
}

function renderConnectorErrors(el) {
  const c = S().connector
  el.innerHTML = `<p class="lede">${md(c.note ?? "")}</p><table>
    <tr><th>status</th><th>when</th></tr>
    ${(c.errors ?? []).map((e) => `<tr><td class="num">${e.code}</td><td>${md(e.when)}</td></tr>`).join("")}
  </table>`
}

// ── the CLI ─────────────────────────────────────────────────────────────────

function renderCliVerbs(el) {
  const cli = S().cli
  el.innerHTML =
    `<p class="lede">Global flags: ${(cli.globalFlags ?? []).map((f) => `<code>${esc(f)}</code>`).join(" · ")}
     &nbsp;·&nbsp; <code>${esc(cli.pipeEnv)}</code> names a pipe directly.</p>` +
    cli.verbs
      .map((v, i) => {
        const id = `cli-${i}`
        const line = `volt ${v.name}${v.args ? " " + v.args : ""}`
        return `<section class="entry" id="verb-${v.name}">
        <header><span class="name">volt ${v.name}</span>
          ${v.args ? `<span class="pill">${esc(v.args)}</span>` : ""}
          ${v.mutates ? '<span class="pill warnpill">writes</span>' : '<span class="pill">read-only</span>'}
        </header>
        <div class="body">
          <p>${md(v.summary)}</p>
          ${v.flags.length ? `<div class="lbl">flags</div><p class="codes">${v.flags.map((f) => `<code>${esc(f)}</code>`).join(" ")}</p>` : ""}
          ${panel(id, `Run ${line}`, line)}
        </div>
      </section>`
      })
      .join("")
}

function renderCliExit(el) {
  el.innerHTML = `<table><tr><th>code</th><th>means</th></tr>
    ${S().cli.exitCodes.map((e) => `<tr><td class="num">${e.code}</td><td>${md(e.means)}</td></tr>`).join("")}
  </table>`
}

const RENDERERS = {
  "connector-routes": renderConnectorRoutes,
  "connector-schemas": renderConnectorSchemas,
  "connector-errors": renderConnectorErrors,
  "cli-verbs": renderCliVerbs,
  "cli-exit": renderCliExit,
  ops: renderOps,
  schemas: renderSchemas,
  kinds: renderKinds,
  extensions: renderExtensions,
  driver: renderDriver,
  errors: (el) => renderList(el, window.VOLT.errors),
  statuses: (el) => renderList(el, window.VOLT.statuses),
  severities: (el) => renderList(el, window.VOLT.severities),
  "op-names": (el) => renderList(el, window.VOLT.ops),
  vendors: (el) => renderList(el, window.VOLT.vendors),
}

/**
 * Highlight the section being read. With thirty-odd rows on the wire page, a TOC that does not say where you
 * are is a list of links rather than a map.
 *
 * A direct scan rather than an IntersectionObserver: the observer only knows about elements that CROSS its
 * band, so one fast scroll jumps the whole band and leaves the highlight on whatever was last seen. Asking
 * "which target is the last one above the fold" answers correctly from any scroll position, including a
 * mid-page load from a #fragment.
 */
function trackPosition() {
  const links = new Map(
    [...document.querySelectorAll("nav a.sec")].map((a) => [a.getAttribute("href").slice(1), a]),
  )
  const targets = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean)
  if (!targets.length) return

  let last = null
  let queued = false

  const update = () => {
    queued = false
    // The last target whose top has passed a quarter of the way down the viewport. Falls back to the first,
    // so the very top of the page highlights something rather than nothing.
    const fold = innerHeight * 0.25
    let here = targets[0]
    for (const t of targets) {
      if (t.getBoundingClientRect().top > fold) break
      here = t
    }
    if (here === last) return
    last = here
    for (const [id, a] of links) a.classList.toggle("here", id === here.id)
    links.get(here.id)?.scrollIntoView({ block: "nearest" })
  }

  addEventListener("scroll", () => {
    if (queued) return
    queued = true
    requestAnimationFrame(update)
  }, { passive: true })
  update()
}

/**
 * Turn the panels on when a console is behind the page, and say so plainly when there is not one. The banner
 * goes right under the lede, because "can I trust this?" is the first question and the answer changes what
 * every panel below means.
 */
async function wireTryIt() {
  if (document.querySelector(".try") === null) return
  const meta = await consoleMeta()
  const lede = document.querySelector("main .lede")
  lede?.insertAdjacentHTML("afterend", runBanner(meta))
  if (meta.absent) {
    for (const b of document.querySelectorAll(".trybtn")) b.disabled = true
    return
  }
  // Live: hand the buttons over to the handlers now that they exist.
  for (const b of document.querySelectorAll(".trybtn")) b.disabled = false
  bindPanels({
    // The wire: one op, and EVERY frame it answered with.
    op: async (text) => callConsole("bridge", JSON.parse(text)),
    // The control plane: the method rides in a header, because the body is the caller's.
    conn: async (text) => {
      const req = JSON.parse(text)
      const res = await fetch(`_api/connector/${String(req.path ?? "").replace(/^\//, "")}`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Volt-Method": req.method ?? "GET" },
        body: req.body === undefined ? "" : JSON.stringify(req.body),
      })
      return res.json()
    },
    // The CLI: a command line, split the way a shell would. The leading `volt` is dropped only when it IS
    // the leading token — blindly slicing meant `status --json`, typed without the prefix, sent `["--json"]`
    // and came back "expected { args }" for a line that reads perfectly.
    cli: async (text) => {
      const argv = splitArgs(text)
      return callConsole("cli", { args: argv[0] === "volt" ? argv.slice(1) : argv })
    },
  })
}

/**
 * Split a command line into argv, honouring double quotes ANYWHERE in a token.
 *
 * The first cut matched `/"[^"]*"|\S+/`, which only sees a quote that starts a token — so
 * `--project-name="My Project"` split into `--project-name="My` and `Project"`, on the one verb whose
 * documented flag is a name with spaces. This walks the line instead, so a quote may open mid-token and the
 * quotes themselves are stripped wherever they were.
 */
function splitArgs(line) {
  const out = []
  let cur = ""
  let quoted = false
  let started = false
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted
      started = true
    } else if (!quoted && /\s/.test(ch)) {
      if (started) out.push(cur)
      cur = ""
      started = false
    } else {
      cur += ch
      started = true
    }
  }
  if (started) out.push(cur)
  return out
}

document.addEventListener("DOMContentLoaded", async () => {
  // Render the generated blocks BEFORE the nav, so headings they add are in the "on this page" list.
  for (const [name, render] of Object.entries(RENDERERS)) {
    const el = document.querySelector(`[data-render="${name}"]`)
    if (el) render(el)
  }
  buildNav()
  trackPosition()
  const dark = buildThemeToggle()
  await initMermaid(dark)
  await wireTryIt()
})
