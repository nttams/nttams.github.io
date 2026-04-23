# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Writing Style

Do not use the em dash ("—") to connect sentences or clauses.

## Commands

```bash
mdbook serve   # local dev server with live reload
mdbook build   # build static site to book/ directory
```

Requires mdBook 0.5.2 (`cargo install mdbook --version 0.5.2`). Output goes to `book/` (gitignored). GitHub Actions auto-deploys to GitHub Pages on push to `main`.

## Architecture

This is a personal portfolio/blog built with [mdBook](https://rust-lang.github.io/mdBook/).

- `src/` — all Markdown content
- `src/SUMMARY.md` — defines navigation structure and page order (must be updated when adding/removing pages)
- `book.toml` — single config file; uses custom `theme/` directory for HTML overrides
- `theme/head.hbs` — injects Umami analytics tracking script into every page

To add a new article: create a `.md` file in `src/`, then add an entry to `src/SUMMARY.md`.

## Flowchart Style (HTML-based)

Charts are built with raw HTML `<div>` blocks inside Markdown. Use this pattern:

**Linear steps** — a centered flex column, each node separated by a down-arrow SVG:
```html
<div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui,sans-serif;margin:24px 0;">
  <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node label</div>
  <div style="display:flex;justify-content:center;margin:3px 0;"><svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg></div>
  <div style="background:#f5f5f5;...">Next node</div>
</div>
```

**Branch/fork** — after the decision box, add a short stub SVG then a `border-top` on the flex row container:
```html
<div style="...">Decision Box?</div>
<!-- short stub connecting decision box to the horizontal fork bar -->
<div style="display:flex;justify-content:center;"><svg width="14" height="8" viewBox="0 0 14 8"><line x1="7" y1="0" x2="7" y2="8" stroke="#c0c0c0" stroke-width="1.5"/></svg></div>
<!-- border-top forms the horizontal fork bar; each branch hangs below it -->
<div style="display:flex;gap:48px;align-items:flex-start;border-top:1.5px solid #c0c0c0;padding-top:8px;">
  <div style="display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:11px;color:#888;margin-bottom:3px;">Branch A label</div>
    <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;...">Branch A node</div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;">
    <div style="font-size:11px;color:#888;margin-bottom:3px;">Branch B label</div>
    <div style="display:flex;justify-content:center;margin:2px 0;"><svg width="14" height="16" viewBox="0 0 14 16"><line x1="7" y1="0" x2="7" y2="9" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,16 2,8 12,8" fill="#c0c0c0"/></svg></div>
    <div style="background:#f5f5f5;...">Branch B node</div>
  </div>
</div>
```

**Two-way connection** — use two side-by-side arrows with labels, one pointing down and one pointing up:
```html
<div style="display:flex;gap:24px;align-items:center;margin:4px 0;">
  <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
    <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="0" x2="7" y2="13" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,20 2,12 12,12" fill="#c0c0c0"/></svg>
    <div style="font-size:11px;color:#888;">label for down</div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
    <div style="font-size:11px;color:#888;">label for up</div>
    <svg width="14" height="20" viewBox="0 0 14 20"><line x1="7" y1="7" x2="7" y2="20" stroke="#c0c0c0" stroke-width="1.5"/><polygon points="7,0 2,8 12,8" fill="#c0c0c0"/></svg>
  </div>
</div>
```

**Node colors:**
- Regular node: `background:#f5f5f5;border:1.5px solid #c0c0c0`
- Decision/highlight node: `background:#e8e8e8;border:1.5px solid #aaa`
- Arrow/connector color: `#c0c0c0`

**Sections** (e.g. Offline / Hot Path / Background): wrap each group in a `border:1px solid #d8d8d8;border-radius:8px;padding:16px 20px` container with a small uppercase label header.

**Grouped nodes** (e.g. horizontally scaled workers): wrap in a `border:1.5px solid #c0c0c0;border-radius:8px;padding:12px 20px` container with a small uppercase label header above the node row:
```html
<div style="border:1.5px solid #c0c0c0;border-radius:8px;padding:12px 20px;">
  <div style="font-size:11px;color:#888;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;">Group Label</div>
  <div style="display:flex;gap:12px;align-items:stretch;">
    <div style="background:#f5f5f5;border:1.5px solid #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#2d2d2d;">Node 1</div>
    <div style="background:#f5f5f5;border:1.5px dashed #c0c0c0;border-radius:6px;padding:9px 20px;text-align:center;font-size:13px;color:#aaa;">Node N</div>
  </div>
</div>
```
Use a dashed border + muted text color (`#aaa`) for the last node to indicate it's a placeholder for N instances.
