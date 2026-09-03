// Presentation only — turn a shared @volt/control FileDiff into a self-contained HTML page for the diff popup
// window. No logic here (the refs + diffing live in @volt/control); this just renders lines with +/- coloring.
import type { FileDiff } from "@volt/control"

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string)

/** A full HTML document for the diff popup — loaded into a child BrowserWindow via a data: URL, so it's inlined
 *  and theme-aware (follows the OS light/dark preference, like the main shell). */
export function diffHtml(d: FileDiff): string {
  const rows = d.identical
    ? `<div class="empty">No differences — the two sides are identical.</div>`
    : d.lines
        .map((l) => {
          const cls = l.tag === "+" ? "add" : l.tag === "-" ? "del" : "ctx"
          return `<div class="ln ${cls}"><span class="g">${l.tag === " " ? "" : l.tag}</span><span class="t">${esc(l.text) || " "}</span></div>`
        })
        .join("")
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(d.name)} — diff</title><style>
    :root { --bg:#16120e; --chrome:#2a2219; --border:#342b20; --text:#f3ead9; --muted:#9a8e7c;
      --add:#74c07a; --del:#e8675c; --add-bg:rgba(116,192,122,.13); --del-bg:rgba(232,103,92,.13); }
    @media (prefers-color-scheme: light) { :root { --bg:#fff9f1; --chrome:#ebe2d4; --border:#e2d8c8;
      --text:#1a1714; --muted:#6e665b; --add:#3e9b52; --del:#cc4b37; --add-bg:rgba(62,155,82,.12); --del-bg:rgba(204,75,55,.12); } }
    * { box-sizing:border-box; margin:0; }
    html,body { height:100%; background:var(--bg); color:var(--text);
      font:13px/1.4 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    header { position:sticky; top:0; padding:11px 16px; background:var(--chrome); border-bottom:1px solid var(--border); }
    header .name { font-weight:640; letter-spacing:-.01em; }
    header .refs { color:var(--muted); font-size:11.5px; margin-top:2px; }
    header .refs b { color:var(--text); font-weight:600; }
    main { padding:6px 0 24px; }
    .ln { display:flex; font:12px/1.55 ui-monospace,"JetBrains Mono","Cascadia Code",monospace; white-space:pre; }
    .ln .g { width:22px; flex:none; text-align:center; color:var(--muted); user-select:none; }
    .ln .t { flex:1; padding-right:16px; }
    .ctx .t { color:var(--muted); }
    .add { background:var(--add-bg); } .add .g, .add .t { color:var(--add); }
    .del { background:var(--del-bg); } .del .g, .del .t { color:var(--del); }
    .empty { padding:40px 16px; text-align:center; color:var(--muted); }
    ::-webkit-scrollbar { width:11px; height:11px; }
    ::-webkit-scrollbar-thumb { background:var(--border); border-radius:999px; border:3px solid transparent; background-clip:padding-box; }
  </style></head><body>
    <header><div class="name">${esc(d.name)}</div><div class="refs"><b>${esc(d.leftLabel)}</b> → <b>${esc(d.rightLabel)}</b></div></header>
    <main>${rows}</main>
  </body></html>`
}
