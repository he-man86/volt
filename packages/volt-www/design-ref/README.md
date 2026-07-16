# design-ref — cursor.com design reference

Reference only. **Nothing here is imported by the build** (`vite build` must succeed with this folder deleted).
It's the visual source of truth for volt-www's Cursor-inspired look.

- `DESIGN.md` — skillui's extracted tokens/spacing/motion (trimmed: font-face noise dropped).
- `screenshots/homepage.png` — the real cursor.com homepage; the composition target.

Generated with [`skillui`](https://skillui.vercel.app/):

```
skillui --url https://cursor.com --mode ultra
```

Re-run to refresh (needs Playwright for the `--mode ultra` scroll-journey frames; static fallback gives tokens +
one homepage screenshot).

**Not committed on purpose:** Cursor's proprietary fonts (CursorGothic, Berkeley Mono) and logo. We match the
aesthetic with licensable equivalents — Inter, JetBrains Mono, EB Garamond — self-hosted via `@fontsource`.
