// Journal rules with no DOM and no storage, unit-tested in Node.
// Four kinds of item, all kept on the device:
//   entry  diary/agenda: a moment with date, time, mood, words, photos, tags
//   page   notes that are not about a date: blocks of text, headings, to-dos, tables, images
//   board  free space: notes and images placed anywhere (moodboards)
//   book   photo albums and burn books: pages of photo + title + words
export const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const LIMITS = { title: 120, text: 20000, block: 5000, cell: 500, tag: 30, tags: 12, blocks: 500, rows: 100, cols: 12, boardItems: 300, pages: 300, photos: 12 };
const clip = (s, n) => String(s ?? "").slice(0, n);
const pad = (n) => String(n).padStart(2, "0");

/* ---------- time ---------- */
export const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isStamp = (s) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const dayOf = (stamp) => stamp.slice(0, 10);
export const monthOf = (stamp) => stamp.slice(0, 7);
export const addDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
export const addMonths = (m, n) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
export const daysInMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
// Monday-first weekday (0 = Monday) of the 1st of the month
export const firstWeekday = (m) => { const [y, mo] = m.split("-").map(Number); return (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; };

/* ---------- moods ---------- */
export const MOODS = [1, 2, 3, 4, 5];
export const isMood = (m) => m === null || MOODS.includes(m);

/* ---------- tags ---------- */
// "#Praia, verão  #praia" -> ["praia", "verão"]: lowercase, no #, no duplicates
export function parseTags(s) {
  const out = [];
  for (const raw of String(s ?? "").split(/[,;\n]+/)) {
    const t = clip(raw.replace(/#/g, "").replace(/\s+/g, " ").trim().toLowerCase(), LIMITS.tag);
    if (t && !out.some((x) => fold(x) === fold(t))) out.push(t);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

/* ---------- makers (always return clean, bounded items) ---------- */
// A moment outside (2026-11-06): a walk, a breath, a sit in an open space, logged after, off the phone.
export const MOMENT_KINDS = ["walk", "breathe", "meditate", "sit"];
export const MOMENT_PLACES = ["park", "beach", "woods", "garden", "streets", "hills"];
export const cleanMoment = (m) => m && MOMENT_KINDS.includes(m.kind) ? { kind: m.kind, place: MOMENT_PLACES.includes(m.place) ? m.place : "", minutes: Number.isFinite(+m.minutes) && +m.minutes > 0 ? Math.min(600, Math.round(+m.minutes)) : 0, found: clip(m.found || "", 120) } : null;
export const newEntry = (o = {}) => ({ id: o.id || uid(), type: "entry", at: isStamp(o.at) ? o.at : localStamp(), mood: isMood(o.mood ?? null) ? o.mood ?? null : null, text: clip(o.text, LIMITS.text), photos: (o.photos || []).slice(0, LIMITS.photos), tags: parseTags((o.tags || []).join(",")), moment: cleanMoment(o.moment), updated: Date.now() });
export const newPage = (o = {}) => ({ id: o.id || uid(), type: "page", title: clip(o.title, LIMITS.title), pinned: !!o.pinned, blocks: (o.blocks || [newBlock("text")]).slice(0, LIMITS.blocks), updated: Date.now() });
export const newBoard = (o = {}) => ({ id: o.id || uid(), type: "board", title: clip(o.title, LIMITS.title), items: (o.items || []).slice(0, LIMITS.boardItems), updated: Date.now() });
// how a book looks (all optional): cover colour, paper and, for albums, how photos are framed
export const BOOK_COVERS = ["plum", "rose", "sage", "sky", "sand", "ink"], BOOK_PAPERS = ["plain", "lined", "dotted", "kraft"], BOOK_FRAMES = ["polaroid", "tape", "rounded", "none"];
export const newBook = (o = {}) => ({ id: o.id || uid(), type: "book", kind: o.kind === "burn" ? "burn" : "album", title: clip(o.title, LIMITS.title), pages: (o.pages || []).slice(0, LIMITS.pages), cover: BOOK_COVERS.includes(o.cover) ? o.cover : (o.kind === "burn" ? "ink" : "plum"), paper: BOOK_PAPERS.includes(o.paper) ? o.paper : "plain", frame: BOOK_FRAMES.includes(o.frame) ? o.frame : "polaroid", updated: Date.now() });

/* ---------- page blocks ---------- */
export const BLOCK_KINDS = ["text", "h", "todo", "quote", "table", "image", "divider"];
export function newBlock(kind, o = {}) {
  const k = BLOCK_KINDS.includes(kind) ? kind : "text";
  const b = { id: uid(), kind: k };
  if (["text", "h", "todo", "quote"].includes(k)) b.text = clip(o.text, LIMITS.block);
  if (k === "todo") b.done = !!o.done;
  if (k === "table") b.rows = o.rows ? o.rows.slice(0, LIMITS.rows).map((r) => r.slice(0, LIMITS.cols).map((c) => clip(c, LIMITS.cell))) : [["", ""], ["", ""]];
  if (k === "image") { b.file = o.file || null; b.text = clip(o.text, LIMITS.block); }
  return b;
}
export function moveBlock(blocks, id, dir) {
  const i = blocks.findIndex((b) => b.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const out = [...blocks]; [out[i], out[j]] = [out[j], out[i]]; return out;
}
export function insertAfter(blocks, id, block) {
  if (blocks.length >= LIMITS.blocks) return blocks;
  const i = blocks.findIndex((b) => b.id === id);
  const out = [...blocks]; out.splice(i < 0 ? out.length : i + 1, 0, block); return out;
}
// Tables: add/remove rows and columns, never fewer than 1x1, never more than the limits.
export function tableOp(rows, op, at = null) {
  const r = rows.map((x) => [...x]), cols = r[0]?.length || 1;
  if (op === "addRow" && r.length < LIMITS.rows) r.splice(at ?? r.length, 0, Array(cols).fill(""));
  if (op === "addCol" && cols < LIMITS.cols) r.forEach((row) => row.splice(at ?? cols, 0, ""));
  if (op === "delRow" && r.length > 1) r.splice(at ?? r.length - 1, 1);
  if (op === "delCol" && cols > 1) r.forEach((row) => row.splice(at ?? cols - 1, 1));
  return r;
}
// Markdown-ish shortcuts typed at the start of a text block: "# " heading, "[] " to-do, "> " quote, "---" divider
export function shortcut(text) {
  if (/^#{1,3} /.test(text)) return { kind: "h", text: text.replace(/^#{1,3} /, "") };
  if (/^\[\s?\] /.test(text)) return { kind: "todo", text: text.replace(/^\[\s?\] /, "") };
  if (/^> /.test(text)) return { kind: "quote", text: text.slice(2) };
  if (text === "---") return { kind: "divider" };
  return null;
}
export const pageText = (p) => [p.title, ...p.blocks.flatMap((b) => [b.text || "", ...(b.rows || []).flat()])].join(" ");
export const todoProgress = (p) => { const t = p.blocks.filter((b) => b.kind === "todo"); return { done: t.filter((b) => b.done).length, total: t.length }; };

/* ---------- boards ---------- */
export const NOTE_COLORS = ["paper", "sun", "sage", "sky", "rose"];
export function boardItem(kind, o = {}) {
  return { id: uid(), kind: kind === "image" ? "image" : "note", x: clamp(o.x ?? 40, 0, 4000), y: clamp(o.y ?? 40, 0, 4000), w: clamp(o.w ?? 220, 80, 1200), h: clamp(o.h ?? 160, 60, 1200), z: o.z ?? 1, text: clip(o.text, LIMITS.block), color: NOTE_COLORS.includes(o.color) ? o.color : "paper", file: o.file || null };
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
export const topZ = (items) => items.reduce((m, i) => Math.max(m, i.z || 0), 0) + 1;
export const boardSize = (items) => ({ w: Math.max(1200, ...items.map((i) => i.x + i.w + 200)), h: Math.max(800, ...items.map((i) => i.y + i.h + 200)) });

/* ---------- diary: calendar, moods, streaks ---------- */
// Average mood per day in a month: Map("2026-11-05" -> 3.5)
export function moodByDay(entries, month) {
  const sums = new Map();
  for (const e of entries) {
    if (e.mood === null || monthOf(e.at) !== month) continue;
    const d = dayOf(e.at), s = sums.get(d) || [0, 0]; s[0] += e.mood; s[1]++; sums.set(d, s);
  }
  return new Map([...sums].map(([d, [a, n]]) => [d, a / n]));
}
export function moodStats(entries, { from = "", to = "" } = {}) {
  const counts = [0, 0, 0, 0, 0]; let sum = 0, n = 0;
  for (const e of entries) { if (e.mood === null || (from && dayOf(e.at) < from) || (to && dayOf(e.at) > to)) continue; counts[e.mood - 1]++; sum += e.mood; n++; }
  return { counts, average: n ? sum / n : null, n };
}
// Days in a row with at least one entry, ending today (or yesterday, so the streak survives until bedtime)
export function streak(entries, today) {
  const days = new Set(entries.map((e) => dayOf(e.at)));
  let d = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export const sortEntries = (entries) => [...entries].sort((a, b) => b.at.localeCompare(a.at) || b.updated - a.updated);
// "On this day": entries from the same date in earlier years
export const onThisDay = (entries, today) => sortEntries(entries.filter((e) => dayOf(e.at).slice(5) === today.slice(5) && dayOf(e.at) < today));

/* ---------- search across everything ---------- */
export function search(items, q, { type = "" } = {}) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const text = (it) => it.type === "entry" ? `${it.text} ${it.tags.join(" ")} ${it.at} ${it.moment ? it.moment.found : ""}` : it.type === "page" ? pageText(it) : it.type === "board" ? [it.title, ...it.items.map((i) => i.text)].join(" ") : [it.title, ...it.pages.flatMap((p) => [p.title, p.text])].join(" ");
  return items.filter((it) => (!type || it.type === type) && terms.every((t) => fold(text(it)).includes(t)))
    .sort((a, b) => (b.at || "").localeCompare(a.at || "") || b.updated - a.updated);
}
export const allTags = (entries) => { const m = new Map(); for (const e of entries) for (const t of e.tags) m.set(t, (m.get(t) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

/* ---------- files used by items (for backups and clean-up) ---------- */
export function filesUsed(items) {
  const s = new Set();
  for (const it of items) {
    if (it.type === "entry") it.photos.forEach((f) => s.add(f));
    if (it.type === "page") it.blocks.forEach((b) => b.file && s.add(b.file));
    if (it.type === "board") it.items.forEach((i) => i.file && s.add(i.file));
    if (it.type === "book") it.pages.forEach((p) => p.file && s.add(p.file));
  }
  return s;
}

/* ---------- backups ---------- */
export const BACKUP_VERSION = 1;
export function checkBackup(b) {
  if (!b || b.app !== "journal" || b.version !== BACKUP_VERSION || !Array.isArray(b.items)) return "bad-backup";
  for (const it of b.items) {
    if (!it || typeof it.id !== "string" || !["entry", "page", "board", "book"].includes(it.type)) return "bad-backup";
    if (it.type === "entry" && (!isStamp(it.at) || !isMood(it.mood) || !Array.isArray(it.photos) || !Array.isArray(it.tags))) return "bad-backup";
    if (it.type === "page" && !Array.isArray(it.blocks)) return "bad-backup";
    if (it.type === "board" && !Array.isArray(it.items)) return "bad-backup";
    if (it.type === "book" && !Array.isArray(it.pages)) return "bad-backup";
  }
  return null;
}
