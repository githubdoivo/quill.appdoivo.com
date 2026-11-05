# quill.appdoivo.com

**Quill** (the same name in EN and PT; it was Journal / Diário until 2026-11-05): "my mind + Notion + a journal app + a notes app". Good on a laptop
and on a phone, installable, works offline. **Everything stays on the device**, photos included:
no account, no server, no tracking.

## What it does

| Screen | What is there |
| --- | --- |
| Today | Write how you feel: a mood (five steps), words, tags, date and time, photos. The diary underneath, grouped by day; edit, delete with undo. A mood calendar for the month (one colour, lighter to darker), average mood, days in a row, "On This Day" from earlier years. |
| Pages | Notes that are not about a date, Notion-like: text, headings, to-dos, quotes, tables (add/remove rows and columns), images, dividers. Shortcuts: `#` heading, `[]` to-do, `>` quote, `---` divider; Enter adds a block, Backspace on an empty one removes it; move blocks up and down; pin pages. |
| Boards | Free space: notes and images placed anywhere, dragged, resized, recoloured (paper, sun, sage, sky, rose), brought to front. Keyboard: arrows move, Shift for bigger steps, Alt+arrows resize. |
| Books | Photo albums and burn books: a page per photo or person, with a title and words; read page by page or see all pages. |
| Search | Everything at once (diary, pages, boards, books), accents ignored. |
| Settings | Backup (a zip with every photo), restore, delete everything, language, theme. |

Photos are re-drawn on the device at most 2000 px and saved as JPEG, which also removes the
camera details and **GPS location** hidden in the original (tested with a real GPS-tagged photo).
They are stored as bytes, not Blobs, so Safari private browsing works too.

## Files

| Part | File |
| --- | --- |
| Rules (no DOM, unit-tested) | `js/model.js` |
| Storage (IndexedDB: items, photos) | `js/db.js` |
| Photos | `js/images.js` |
| Backup zip | `js/zip.js` (same dependency-free code as Expenses) |
| Screens | `index.html`, `js/app.js` |
| Words EN/PT | `js/words.js` (Title Case in both languages) |
| Look | `app.css` (tokens at the top; mood and note colours in the Journal section) |
| Offline/install | `sw.js`, `manifest.webmanifest`, `icons/` |
| Privacy | `privacy.html` |

**Redesign:** from ChatGPT mockups (`DESIGN-PROMPTS.md`); swap the tokens, mood/note colours and
background in `app.css` and the icons.

## Security

Strict Content-Security-Policy (only the app's own scripts, no outside hosts), no inline scripts,
no third-party fonts or analytics, user text only through `textContent`/`.value` (an injection
test checks it), restores validated before replacing anything, "Delete Everything" needs the
word typed, persistent storage requested.

## Tests

`npm test`: unit tests for the rules and the backup zip; Playwright on desktop Chrome and iPhone
WebKit: diary, moods and calendar, photo GPS stripping, refusing non-photos, the page editor and
its shortcuts, tables, boards (drag, resize, keys, colours), books, search, backup/wipe/restore
with photos, HTML injection, PT/EN Title Case, accessibility (axe, light and dark), phone layout
and 44px targets, offline, no outside requests, and a monkey test. CI on every push and daily.

## Later

End-to-end encrypted sync between devices; a lock (Face ID in the store app); reminders;
mood trends over the year; exporting a book as a printable PDF; a notebook atom on appdoivo.com.
