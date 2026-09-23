/*
 * THE TRY-IT LAYER — what turns three descriptions into three things you can check.
 *
 * These pages are static files. They can be opened straight from disk and they will render everything, and
 * none of it can be exercised: a browser cannot open a named pipe, the connector's control plane refuses a
 * cross-origin request by design, and argv is not a thing a page has.
 *
 * `volt console` serves these same files from a process that CAN reach all three, and exposes it at
 * `/_api/*`. So every panel below is enabled only when that server is behind the page — detected once, by
 * asking `/_api/meta`. Opened from disk, the panels say so instead of failing.
 */

let META = null

/** Is a console serving us, and with writes enabled? Asked once; the answer decides what every panel shows. */
export async function consoleMeta() {
  if (META !== null) return META
  try {
    const res = await fetch("_api/meta")
    META = res.ok ? await res.json() : { absent: true }
  } catch {
    META = { absent: true }
  }
  return META
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

/** The banner every page carries, so the reader knows whether what they see is live. */
export function runBanner(meta) {
  if (meta.absent)
    return `<div class="note runner off"><b>Read-only view.</b> These pages are open as files, so nothing here
      can be called. Run <code>volt console</code> to serve them from a process that can reach the pipe, the
      connector and the CLI — then every panel below becomes a real request.</div>`
  return meta.allowWrite
    ? `<div class="note runner write"><b>Live, WRITES ENABLED.</b> <code>push</code>, the mutating verbs and
       non-GET control-plane routes will really run against whatever is connected.</div>`
    : `<div class="note runner"><b>Live, read-only.</b> Calls run for real. Anything that could change a
       project is refused — restart with <code>volt console --allow-write</code> to enable those.</div>`
}

/** One collapsible panel: an editable request, a Send button, and the raw answer. */
export function panel(id, label, initial, send) {
  return `<details class="try" id="try-${id}">
    <summary>${esc(label)}</summary>
    <div class="trybody">
      <textarea class="tryin" spellcheck="false" rows="${Math.min(12, initial.split("\n").length + 1)}">${esc(initial)}</textarea>
      <div class="tryrow">
        <button class="trybtn" data-send="${id}">Send</button>
        <span class="trynote" id="note-${id}"></span>
      </div>
      <pre class="tryout" id="out-${id}">—</pre>
    </div>
  </details>`
}

/** Wire every Send button on the page to its sender. */
export function bindPanels(senders) {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest?.("button[data-send]")
    if (!btn) return
    const id = btn.dataset.send
    const out = document.getElementById(`out-${id}`)
    const input = btn.closest(".trybody").querySelector(".tryin")
    const send = senders[id] ?? senders[id.replace(/-.*$/, "")]
    if (send === undefined) return
    btn.disabled = true
    out.textContent = "…"
    const started = performance.now()
    try {
      const answer = await send(input.value, id)
      out.textContent = typeof answer === "string" ? answer : JSON.stringify(answer, null, 2)
    } catch (err) {
      out.textContent = `the console did not answer: ${err.message}`
    } finally {
      btn.disabled = false
      document.getElementById(`note-${id}`).textContent = `${Math.round(performance.now() - started)} ms`
    }
  })
}

/** POST JSON to one of the console's own routes. */
export async function callConsole(route, body, headers = {}) {
  const res = await fetch(`_api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  return res.json()
}
