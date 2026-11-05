// Journal: the screens. Items live in IndexedDB (db.js), rules in model.js.
// Safety: user text reaches the page only through textContent / .value, never innerHTML.
import * as M from "./model.js";
import * as db from "./db.js";
import { prepareImage, ACCEPT } from "./images.js";
import { zip, unzip } from "./zip.js";
import { WORDS, MONTHS, WEEKDAYS } from "./words.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if ((k === "value" && n.tagName === "TEXTAREA") || (k in n && typeof v !== "string")) n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : String(k));
  return n;
}
const S = { items: new Map(), settings: { lang: "en", theme: "" }, view: "today", sub: "", calMonth: M.localStamp().slice(0, 7), shown: 40, draft: null, bookMode: "read", bookPage: 0, selected: null };
const t = (k, ...a) => { const v = WORDS[S.settings.lang]?.[k] ?? WORDS.en[k]; return typeof v === "function" ? v(...a) : v ?? k; };
const today = () => M.localStamp().slice(0, 10);
const byType = (type) => [...S.items.values()].filter((i) => i.type === type);
const SMALL = new Set(["de", "do", "da", "dos", "das", "e", "of", "the"]);
const titleCase = (s) => s.split(" ").map((w, i) => (i && SMALL.has(w) ? w : w.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-"))).join(" ");
const fmtDay = (day) => { const [y, m, d] = day.split("-").map(Number); return titleCase(new Date(y, m - 1, d).toLocaleDateString(S.settings.lang === "pt" ? "pt-PT" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })); };

/* ---------- photos ---------- */
const urls = new Map();
async function fileURL(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await db.getFile(id); if (!blob) return null;
  const u = URL.createObjectURL(blob); urls.set(id, u); return u;
}
function img(id, alt = "") { const el = h("img", { alt, loading: "lazy", decoding: "async" }); if (id) fileURL(id).then((u) => { if (u) el.src = u; }); return el; }
function pickFiles({ multiple = false } = {}) {
  const input = $("#file-pick"); input.accept = ACCEPT; input.multiple = multiple; input.value = "";
  return new Promise((res) => { input.onchange = () => res([...input.files]); input.click(); });
}
async function savePhotos(files) {
  const ids = [];
  for (const f of files) {
    try { const blob = await prepareImage(f); const id = M.uid(); await db.putFile(id, blob); ids.push(id); }
    catch (e) { toast(e?.message === "too-big" ? t("errBig") : t("errImage")); }
  }
  return ids;
}
async function gcFiles() {
  const used = M.filesUsed(S.items.values()); for (const id of S.draft?.photos || []) used.add(id);
  const orphans = (await db.fileIds()).filter((id) => !used.has(id));
  if (orphans.length) await db.deleteFiles(orphans);
}

/* ---------- saving ---------- */
let saveTimers = new Map();
function save(item, { now = false } = {}) {
  item.updated = Date.now(); S.items.set(item.id, item);
  clearTimeout(saveTimers.get(item.id));
  const run = () => db.putItem(item).catch(() => toast(S.settings.lang === "pt" ? "Não foi possível guardar neste dispositivo." : "Could not save on this device."));
  if (now) return run();
  saveTimers.set(item.id, setTimeout(run, 350));
}
async function remove(item) {
  S.items.delete(item.id); await db.deleteItem(item.id);
  toast(t("deleted"), { label: t("undo"), run: async () => { S.items.set(item.id, item); await db.putItem(item); render(); } });
}
const saveSettings = () => db.setKV("settings", S.settings).catch(() => {});

/* ---------- toast & confirm ---------- */
let toastTimer;
function toast(msg, action) {
  const box = $("#toast"), btn = box.querySelector("button");
  box.querySelector("span").textContent = msg; btn.hidden = !action;
  if (action) { btn.textContent = action.label; btn.onclick = () => { box.hidden = true; action.run(); }; }
  box.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.hidden = true; }, action ? 7000 : 3000);
}
function confirmBox(text, { typed = null, yes = t("confirm") } = {}) {
  const d = $("#confirm"), field = d.querySelector("[data-type]"), input = field.querySelector("input");
  $("#confirm-text").textContent = text; $("#confirm-yes").textContent = yes; field.hidden = !typed; input.value = "";
  if (typed) $("#confirm-type-label").textContent = t("wipeType");
  return new Promise((resolve) => { d.addEventListener("close", () => resolve(d.returnValue === "yes" && (!typed || input.value.trim().toUpperCase() === typed)), { once: true }); d.returnValue = ""; d.showModal(); (typed ? input : $("#confirm-yes")).focus(); });
}
function autosize(ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; }

/* ---------- words, theme, routing ---------- */
function applyWords() {
  document.documentElement.lang = S.settings.lang === "pt" ? "pt-PT" : "en";
  document.title = `${t("brand")} · ${t("tagline")}`;
  for (const n of $$("[data-w]")) n.textContent = t(n.dataset.w);
  for (const n of $$("[data-w-label]")) { n.setAttribute("aria-label", t(n.dataset.wLabel)); n.title = t(n.dataset.wLabel); }
}
function applyTheme() { if (S.settings.theme) document.documentElement.dataset.theme = S.settings.theme; else delete document.documentElement.dataset.theme; try { localStorage.setItem("theme", S.settings.theme); } catch { /* ignore */ } }
const VIEWS = ["today", "pages", "boards", "books", "search", "settings"];
function route() {
  const [v, id] = location.hash.replace(/^#/, "").split("/");
  S.view = VIEWS.includes(v) ? v : "today"; S.sub = id || "";
  for (const b of $$(".nav button")) { if (b.dataset.view === S.view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  render();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
function render() {
  const main = $("#main");
  const view = { today: viewToday, pages: S.sub ? viewPage : viewPages, boards: S.sub ? viewBoard : viewBoards, books: S.sub ? viewBook : viewBooks, search: viewSearch, settings: viewSettings }[S.view];
  main.replaceChildren(view());
  for (const ta of $$("textarea[data-auto]", main)) autosize(ta);
  if (S.focusTitle) { S.focusTitle = false; $(".page-title", main)?.focus(); }
}
const head = (title, ...right) => h("div", { class: "view-head" }, h("h1", { text: title }), ...right);
const backBtn = (hash) => h("button", { type: "button", class: "ghost small", text: `← ${t("back")}`, onclick: () => go(hash) });

const MOOD_ICON = { // small line symbols, one per mood (storm, cloud, cloud and sun, sun, flower)
  1: "M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 16H7M9 18l-1 2M13 18l-1 2M17 18l-1 2",
  2: "M7 17a4 4 0 1 1 1-7.9A5 5 0 0 1 17.5 11 3.5 3.5 0 0 1 17 18H7",
  3: "M9 6.5V5M5.5 9H4M6.4 6.4 5.3 5.3M8 17a3.5 3.5 0 1 1 .8-6.9A4.5 4.5 0 0 1 17 11.5 3 3 0 0 1 16.5 17.5H8M12 9a3 3 0 0 0-5 2",
  4: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  5: "M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4L12 15.7l-4.8 2.6 1-5.4-4-3.7 5.4-.7Z",
};
const moodIcon = (m) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", MOOD_ICON[m]); s.append(p); return s; };
const camIcon = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "cam"); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", "M4 8h3l1.5-2h7L17 8h3v11H4ZM12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6"); s.append(p); return s; };
const tagChips = (tags) => h("ul", { class: "tags" }, ...tags.map((x) => h("li", { text: x })));
/* ---------- today: write, diary, calendar ---------- */
function viewToday() {
  const d = S.draft || (S.draft = { id: null, mood: null, text: "", tags: "", at: M.localStamp(), photos: [] });
  const moodSet = h("fieldset", { class: "moods" }, h("legend", { text: t("howAreYou") }),
    ...M.MOODS.map((m) => h("label", { class: "mood" }, h("input", { type: "radio", name: "mood", value: String(m), checked: d.mood === m, onchange: () => { d.mood = m; } }), h("span", {}, h("i", { class: `m${m}`, "aria-hidden": "true" }, moodIcon(m)), t("moods")[m - 1]))),
    h("label", { class: "mood" }, h("input", { type: "radio", name: "mood", value: "", checked: d.mood === null, onchange: () => { d.mood = null; } }), h("span", { text: t("noMood") })));
  const text = h("textarea", { id: "entry-text", "data-auto": true, rows: "4", maxlength: String(M.LIMITS.text), placeholder: t("write"), "aria-label": t("write"), value: d.text, oninput: (e) => { d.text = e.target.value; autosize(e.target); } });
  const thumbs = h("ul", { class: "thumbs" });
  const preview = tagChips(M.parseTags(d.tags)); preview.classList.add("tag-preview");
  const drawThumbs = () => thumbs.replaceChildren(...d.photos.map((id, i) => h("li", {}, img(id, ""), h("button", { type: "button", "aria-label": `${t("delete")} ${t("photo")} ${i + 1}`, text: "×", onclick: () => { d.photos.splice(i, 1); drawThumbs(); } }))));
  drawThumbs();
  const form = h("form", { class: "card composer", novalidate: true, autocomplete: "off", onsubmit: async (ev) => {
    ev.preventDefault();
    if (!d.text.trim() && d.mood === null && !d.photos.length) { text.focus(); return; }
    const base = d.id ? S.items.get(d.id) : null;
    const entry = M.newEntry({ id: d.id || undefined, at: d.at, mood: d.mood, text: d.text.trim(), tags: M.parseTags(d.tags), photos: d.photos });
    if (base) entry.created = base.created; else entry.created = Date.now();
    await save(entry, { now: true });
    S.draft = null; toast(t("saved")); render(); $("#entry-text")?.focus();
  } }, moodSet, text,
    h("div", { class: "row" },
      h("label", { class: "f f-tags" }, h("span", { text: t("tags") }), h("input", { name: "tags", value: d.tags, placeholder: t("tagsHint"), maxlength: "200", oninput: (e) => { d.tags = e.target.value; preview.replaceChildren(...tagChips(M.parseTags(d.tags)).childNodes); } })),
      h("label", { class: "f f-when" }, h("span", { text: t("when") }), h("input", { type: "datetime-local", name: "at", value: d.at, onchange: (e) => { if (M.isStamp(e.target.value)) d.at = e.target.value; } }))),
    preview,
    h("div", { class: "actions-row" },
      h("button", { type: "button", class: "ghost small", onclick: async () => { const ids = await savePhotos(await pickFiles({ multiple: true })); d.photos.push(...ids.slice(0, M.LIMITS.photos - d.photos.length)); drawThumbs(); } }, camIcon(), h("span", { text: t("addPhotos") })),
      h("span", { class: "spacer" }),
      d.id ? h("button", { type: "button", class: "ghost small", text: t("cancel"), onclick: () => { S.draft = null; render(); } }) : null,
      h("button", { type: "submit", class: "primary", text: t("save") })),
    thumbs);

  const entries = M.sortEntries(byType("entry"));
  const list = h("section", { class: "card", "aria-labelledby": "diary-title" }, h("h2", { class: "card-title", id: "diary-title", text: t("entriesTitle") }));
  if (!entries.length) list.append(h("p", { class: "muted", text: t("noEntries") }));
  let lastDay = "";
  for (const e of entries.slice(0, S.shown)) {
    const day = M.dayOf(e.at);
    if (day !== lastDay) { list.append(h("h3", { class: "day-label", text: fmtDay(day) })); lastDay = day; }
    list.append(entryCard(e));
  }
  if (entries.length > S.shown) list.append(h("button", { type: "button", class: "ghost", text: S.settings.lang === "pt" ? "Mostrar Mais" : "Show More", onclick: () => { S.shown += 40; render(); } }));

  return h("div", {}, head(fmtDay(today())), h("div", { class: "grid2" }, h("div", {}, form, list), h("aside", {}, calendarCard(entries), memoriesCard(entries))));
}
function entryCard(e) {
  return h("article", { class: `entry ${e.mood ? "" : "no-mood"}`, style: null, "data-mood": e.mood ? String(e.mood) : null },
    h("div", { class: "entry-head" }, h("strong", { text: e.at.slice(11) }), e.mood ? h("span", { class: "mood-tag" }, h("i", { class: `m${e.mood}`, "aria-hidden": "true" }, moodIcon(e.mood)), t("moods")[e.mood - 1]) : null),
    e.text ? h("p", { text: e.text }) : null,
    e.photos.length ? h("div", { class: "photos" }, ...e.photos.map((id) => img(id, ""))) : null,
    e.tags.length ? tagChips(e.tags) : null,
    h("div", { class: "entry-actions" },
      h("button", { type: "button", class: "ghost small", text: t("edit"), onclick: () => { S.draft = { id: e.id, mood: e.mood, text: e.text, tags: e.tags.join(", "), at: e.at, photos: [...e.photos] }; render(); window.scrollTo({ top: 0 }); $("#entry-text")?.focus(); } }),
      h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => { await remove(e); render(); } })));
}
function calendarCard(entries) {
  const m = S.calMonth, [y, mo] = m.split("-").map(Number), byDay = M.moodByDay(entries, m), counts = new Map();
  for (const e of entries) if (M.monthOf(e.at) === m) counts.set(M.dayOf(e.at), (counts.get(M.dayOf(e.at)) || 0) + 1);
  const cells = WEEKDAYS[S.settings.lang].map((w) => h("span", { class: "wd", "aria-hidden": "true", text: w }));
  for (let i = 0; i < M.firstWeekday(m); i++) cells.push(h("span", { "aria-hidden": "true" }));
  for (let d = 1; d <= M.daysInMonth(m); d++) {
    const day = `${m}-${String(d).padStart(2, "0")}`, mood = byDay.get(day), n = counts.get(day) || 0;
    const lvl = mood ? Math.round(mood) : 0;
    const label = `${fmtDay(day)}${n ? `: ${t("entries", n)}` : ""}${mood ? `, ${t("moods")[lvl - 1]}` : ""}`;
    cells.push(h("span", { class: `d ${lvl ? "has m" + lvl : ""} ${day === today() ? "today" : ""}`, role: "img", "aria-label": label, title: label, text: String(d) }));
  }
  const st = M.moodStats(entries, { from: `${m}-01`, to: `${m}-31` });
  return h("section", { class: "card", "aria-labelledby": "cal-title" },
    h("h2", { class: "card-title", id: "cal-title", text: t("calendar") }),
    h("div", { class: "cal-head" },
      h("button", { type: "button", class: "icon-btn", "aria-label": t("prevMonth"), text: "‹", onclick: () => { S.calMonth = M.addMonths(m, -1); render(); } }),
      h("h3", { "aria-live": "polite", text: `${MONTHS[S.settings.lang][mo - 1]} ${y}` }),
      h("button", { type: "button", class: "icon-btn", "aria-label": t("nextMonth"), text: "›", onclick: () => { S.calMonth = M.addMonths(m, 1); render(); } })),
    h("div", { class: "cal" }, ...cells),
    h("ul", { class: "cal-legend", "aria-hidden": "true" }, ...M.MOODS.map((k) => h("li", {}, h("i", { class: `m${k}` }, moodIcon(k)), t("moods")[k - 1]))),
    h("p", { class: "stat-line", text: [st.average ? t("average", st.average.toFixed(1).replace(".", S.settings.lang === "pt" ? "," : ".")) : "", t("streak", M.streak(entries, today()))].filter(Boolean).join(" · ") }));
}
function memoriesCard(entries) {
  const past = M.onThisDay(entries, today());
  if (!past.length) return null;
  return h("section", { class: "card", "aria-labelledby": "otd-title" }, h("h2", { class: "card-title", id: "otd-title", text: t("onThisDay") }),
    ...past.slice(0, 3).map((e) => h("div", { class: "memory" }, h("strong", { text: e.at.slice(0, 4) }), e.mood ? ` · ${t("moods")[e.mood - 1]}` : "", e.text ? h("p", { text: e.text.slice(0, 280) }) : null)));
}

/* ---------- pages ---------- */
function viewPages() {
  const pages = byType("page").sort((a, b) => (b.pinned - a.pinned) || b.updated - a.updated);
  const add = h("button", { type: "button", class: "primary", text: t("newPage"), onclick: () => { const p = M.newPage(); save(p, { now: true }); S.focusTitle = true; go(`#pages/${p.id}`); } });
  return h("div", {}, head(t("pagesTitle"), add),
    pages.length ? h("ul", { class: "tiles" }, ...pages.map((p) => { const td = M.todoProgress(p); return h("li", {}, h("a", { class: "tile", href: `#pages/${p.id}` }, p.pinned ? h("span", { class: "kind", text: "📌 " + t("pin") }) : null, h("strong", { text: p.title || t("untitled") }), h("span", { text: [td.total ? `${td.done}/${td.total} ✓` : "", M.pageText({ ...p, title: "" }).trim().slice(0, 160)].filter(Boolean).join(" · ") }))); }))
      : h("p", { class: "muted", text: t("noPages") }));
}
function viewPage() {
  const p = S.items.get(S.sub); if (!p || p.type !== "page") return viewPages();
  const title = h("input", { class: "page-title", value: p.title, placeholder: t("untitled"), "aria-label": t("pageTitle"), maxlength: String(M.LIMITS.title), oninput: (e) => { p.title = e.target.value; save(p); },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); $(".blocks textarea, .blocks input")?.focus(); } } });
  const list = h("ol", { class: "blocks" });
  const draw = (focusId, atEnd = true) => {
    list.replaceChildren(...p.blocks.map((b) => blockEl(p, b, draw)));
    for (const ta of $$("textarea", list)) autosize(ta);
    if (focusId) { const el = list.querySelector(`[data-id="${focusId}"] textarea`) || list.querySelector(`[data-id="${focusId}"] input:not([type=checkbox])`); if (el) { el.focus(); if (atEnd && el.setSelectionRange) try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not a text field */ } } }
  };
  draw();
  const addBar = h("div", { class: "add-block", role: "group", "aria-label": t("addBlock") },
    ...[["text", "blockText"], ["h", "blockH"], ["todo", "blockTodo"], ["quote", "blockQuote"], ["table", "blockTable"], ["image", "blockImage"], ["divider", "blockDivider"]].map(([k, w]) =>
      h("button", { type: "button", class: "ghost small", text: `+ ${t(w)}`, onclick: async () => {
        const b = M.newBlock(k);
        if (k === "image") { const [id] = await savePhotos((await pickFiles()).slice(0, 1)); if (!id) return; b.file = id; }
        p.blocks = M.insertAfter(p.blocks, null, b); save(p); draw(b.id);
      } })));
  return h("div", {},
    h("div", { class: "view-head" }, backBtn("#pages"), h("span", { class: "spacer" }),
      h("button", { type: "button", class: "ghost small", text: p.pinned ? t("unpin") : t("pin"), onclick: () => { p.pinned = !p.pinned; save(p); render(); } }),
      h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => { await remove(p); go("#pages"); } })),
    h("article", { class: "card" }, title, h("p", { class: "hint", text: t("blockHint") }), list, addBar));
}
function blockEl(p, b, draw) {
  const tools = h("div", { class: "block-tools" },
    h("button", { type: "button", class: "icon-btn", "aria-label": t("moveUp"), text: "↑", onclick: () => { p.blocks = M.moveBlock(p.blocks, b.id, -1); save(p); draw(b.id); } }),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("moveDown"), text: "↓", onclick: () => { p.blocks = M.moveBlock(p.blocks, b.id, 1); save(p); draw(b.id); } }),
    h("button", { type: "button", class: "icon-btn", "aria-label": t("removeBlock"), text: "×", onclick: () => { p.blocks = p.blocks.filter((x) => x !== b); if (!p.blocks.length) p.blocks.push(M.newBlock("text")); save(p); draw(); } }));
  const label = { text: t("blockText"), h: t("blockH"), todo: t("blockTodo"), quote: t("blockQuote") }[b.kind];
  let body;
  if (["text", "h", "todo", "quote"].includes(b.kind)) {
    const ta = h("textarea", { rows: "1", value: b.text, maxlength: String(M.LIMITS.block), "aria-label": label, placeholder: b.kind === "text" ? "…" : label,
      oninput: (e) => {
        b.text = e.target.value; autosize(e.target);
        if (b.kind === "text") { const sc = M.shortcut(b.text); if (sc) { Object.assign(b, M.newBlock(sc.kind, { text: sc.text }), { id: b.id }); save(p); draw(b.id); return; } }
        save(p);
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); const nb = M.newBlock(b.kind === "todo" ? "todo" : "text"); p.blocks = M.insertAfter(p.blocks, b.id, nb); save(p); draw(nb.id); }
        else if (e.key === "Backspace" && !b.text && p.blocks.length > 1) { e.preventDefault(); const i = p.blocks.indexOf(b); p.blocks = p.blocks.filter((x) => x !== b); save(p); draw(p.blocks[Math.max(0, i - 1)].id); }
      } });
    body = b.kind === "todo" ? h("div", { class: "todo-row" }, h("input", { type: "checkbox", checked: b.done, "aria-label": `${t("blockTodo")}: ${b.text}`, onchange: (e) => { b.done = e.target.checked; save(p); draw(); } }), ta) : ta;
  } else if (b.kind === "table") {
    const tb = h("tbody", {}, ...b.rows.map((row, ri) => h("tr", {}, ...row.map((cell, ci) => h("td", {}, h("input", { value: cell, maxlength: String(M.LIMITS.cell), "aria-label": `${t("blockTable")} ${ri + 1}, ${ci + 1}`, oninput: (e) => { b.rows[ri][ci] = e.target.value; save(p); } }))))));
    const op = (o) => () => { b.rows = M.tableOp(b.rows, o); save(p); draw(b.id); };
    body = h("div", {}, h("div", { class: "table-wrap" }, h("table", {}, tb)), h("div", { class: "table-ops" },
      h("button", { type: "button", class: "ghost small", text: t("addRow"), onclick: op("addRow") }), h("button", { type: "button", class: "ghost small", text: t("addCol"), onclick: op("addCol") }),
      h("button", { type: "button", class: "ghost small", text: t("delRow"), onclick: op("delRow") }), h("button", { type: "button", class: "ghost small", text: t("delCol"), onclick: op("delCol") })));
  } else if (b.kind === "image") {
    body = h("figure", {}, img(b.file, b.text || ""), h("input", { value: b.text, placeholder: t("caption"), "aria-label": t("caption"), maxlength: "300", oninput: (e) => { b.text = e.target.value; save(p); } }));
  } else body = h("hr");
  return h("li", { class: `block ${b.kind} ${b.done ? "done" : ""}`, "data-id": b.id }, body, tools);
}

/* ---------- boards ---------- */
function viewBoards() {
  const boards = byType("board").sort((a, b) => b.updated - a.updated);
  const add = h("button", { type: "button", class: "primary", text: t("newBoard"), onclick: () => { const b = M.newBoard({ title: "" }); save(b, { now: true }); go(`#boards/${b.id}`); } });
  return h("div", {}, head(t("boardsTitle"), add),
    boards.length ? h("ul", { class: "tiles" }, ...boards.map((b) => { const first = b.items.find((i) => i.kind === "image"); return h("li", {}, h("a", { class: "tile", href: `#boards/${b.id}` }, first ? img(first.file, "") : null, h("strong", { text: b.title || t("untitled") }), h("span", { text: b.items.filter((i) => i.kind === "note").map((i) => i.text).join(" · ").slice(0, 140) }))); }))
      : h("p", { class: "muted", text: t("noBoards") }));
}
function viewBoard() {
  const bd = S.items.get(S.sub); if (!bd || bd.type !== "board") return viewBoards();
  const board = h("div", { class: "board" }), scroll = h("div", { class: "board-scroll" }, board);
  const sizeBoard = () => { const s = M.boardSize(bd.items); board.style.width = `${s.w}px`; board.style.height = `${s.h}px`; };
  const place = (el, it) => { el.style.left = `${it.x}px`; el.style.top = `${it.y}px`; el.style.width = `${it.w}px`; el.style.height = `${it.h}px`; el.style.zIndex = String(it.z); };
  const select = (it) => { S.selected = it?.id || null; for (const el of $$(".bi", board)) el.classList.toggle("selected", el.dataset.id === S.selected); tools(); };
  const itemEl = (it) => {
    const el = h("div", { class: `bi ${it.kind === "note" ? it.color : ""}`, "data-id": it.id, tabindex: "0", role: "group", "aria-label": it.kind === "note" ? `${t("noteText")}: ${it.text.slice(0, 40)}` : t("blockImage") });
    const grip = h("div", { class: "grip" }); // drag handle; holds the note's colour dots, so not hidden from screen readers
    el.append(grip);
    if (it.kind === "note") grip.append(h("span", { class: "swatches", role: "radiogroup", "aria-label": t("color") }, ...M.NOTE_COLORS.map((c) => h("button", { type: "button", class: `sw ${c}`, role: "radio", "aria-checked": String(it.color === c), "aria-label": t("colors")[c], title: t("colors")[c], onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); it.color = c; save(bd); drawAll(); } }))));
    if (it.kind === "note") el.append(h("textarea", { value: it.text, "aria-label": t("noteText"), maxlength: String(M.LIMITS.block), oninput: (e) => { it.text = e.target.value; save(bd); } }));
    else el.append(img(it.file, ""));
    const handle = h("div", { class: "resize", "aria-hidden": "true" }); el.append(handle);
    place(el, it);
    const drag = (mode) => (e) => {
      if (e.button > 0) return; e.preventDefault(); select(it); it.z = M.topZ(bd.items); place(el, it);
      const sx = e.clientX, sy = e.clientY, o = { ...it };
      const move = (ev) => {
        if (mode === "move") { it.x = M.clamp(o.x + ev.clientX - sx, 0, 4000); it.y = M.clamp(o.y + ev.clientY - sy, 0, 4000); }
        else { it.w = M.clamp(o.w + ev.clientX - sx, 80, 1200); it.h = M.clamp(o.h + ev.clientY - sy, 60, 1200); }
        place(el, it);
      };
      const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); sizeBoard(); save(bd); };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    };
    grip.addEventListener("pointerdown", drag("move"));
    if (it.kind === "image") el.addEventListener("pointerdown", (e) => { if (e.target !== handle) drag("move")(e); });
    handle.addEventListener("pointerdown", drag("resize"));
    el.addEventListener("focus", () => select(it));
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      const step = e.shiftKey ? 50 : 10, k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!k) return; e.preventDefault();
      if (e.altKey) { it.w = M.clamp(it.w + k[0], 80, 1200); it.h = M.clamp(it.h + k[1], 60, 1200); } else { it.x = M.clamp(it.x + k[0], 0, 4000); it.y = M.clamp(it.y + k[1], 0, 4000); }
      place(el, it); sizeBoard(); save(bd);
    });
    return el;
  };
  const drawAll = () => { board.replaceChildren(...bd.items.map(itemEl)); sizeBoard(); select(bd.items.find((i) => i.id === S.selected)); };
  // New items go in a loose grid across the visible part of the board, not on top of each other.
  const spot = () => {
    const cols = Math.max(1, Math.floor((scroll.clientWidth - 40) / 250)), n = bd.items.length;
    return { x: Math.round(scroll.scrollLeft + 24 + (n % cols) * 250 + (n % 3) * 6), y: Math.round(scroll.scrollTop + 24 + Math.floor(n / cols) % 4 * 190 + (n % 2) * 8), z: M.topZ(bd.items) };
  };
  const selTools = h("span", { class: "board-tools" });
  function tools() {
    const it = bd.items.find((i) => i.id === S.selected);
    selTools.replaceChildren(...(it ? [
      h("button", { type: "button", class: "ghost small", text: t("bringFront"), onclick: () => { it.z = M.topZ(bd.items); save(bd); drawAll(); } }),
      h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: () => { bd.items = bd.items.filter((x) => x !== it); S.selected = null; save(bd); drawAll(); } }),
    ] : []));
  }
  drawAll();
  return h("div", {},
    h("div", { class: "view-head" }, backBtn("#boards"), h("span", { class: "spacer" }), h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => { await remove(bd); go("#boards"); } })),
    h("input", { class: "page-title", value: bd.title, placeholder: t("untitled"), "aria-label": t("boardTitle"), maxlength: String(M.LIMITS.title), oninput: (e) => { bd.title = e.target.value; save(bd); } }),
    h("div", { class: "board-tools" },
      h("button", { type: "button", class: "primary", text: t("addNote"), onclick: () => { if (bd.items.length >= M.LIMITS.boardItems) return; const it = M.boardItem("note", spot()); bd.items.push(it); S.selected = it.id; save(bd); drawAll(); board.querySelector(`[data-id="${it.id}"] textarea`)?.focus(); } }),
      h("button", { type: "button", class: "ghost", text: t("addImage"), onclick: async () => { const ids = await savePhotos(await pickFiles({ multiple: true })); for (const id of ids) bd.items.push(M.boardItem("image", { ...spot(), file: id, w: 260, h: 200 })); save(bd); drawAll(); } }),
      selTools),
    scroll, h("p", { class: "board-help", text: t("boardHelp") }));
}

/* ---------- books: photo albums and burn books ---------- */
function viewBooks() {
  const books = byType("book").sort((a, b) => b.updated - a.updated);
  const mk = (kind) => () => { const b = M.newBook({ kind, title: "", pages: [{ id: M.uid(), file: null, title: "", text: "" }] }); save(b, { now: true }); S.bookPage = 0; S.bookMode = "read"; go(`#books/${b.id}`); };
  return h("div", {}, head(t("booksTitle"), h("button", { type: "button", class: "primary", text: t("newAlbum"), onclick: mk("album") }), h("button", { type: "button", class: "ghost", text: t("newBurn"), onclick: mk("burn") })),
    books.length ? h("ul", { class: "tiles" }, ...books.map((b) => { const cover = b.pages.find((p) => p.file); return h("li", {}, h("a", { class: "tile", href: `#books/${b.id}`, onclick: () => { S.bookPage = 0; S.bookMode = "read"; } }, cover ? img(cover.file, "") : null, h("span", { class: "kind", text: b.kind === "burn" ? t("burn") : t("album") }), h("strong", { text: b.title || t("untitled") }), h("span", { text: t("pageOf", b.pages.length, b.pages.length).replace(/^\D+\d+\D+/, "") + " " + (S.settings.lang === "pt" ? "páginas" : "pages") }))); }))
      : h("p", { class: "muted", text: t("noBooks") }));
}
function viewBook() {
  const b = S.items.get(S.sub); if (!b || b.type !== "book") return viewBooks();
  if (!b.pages.length) b.pages.push({ id: M.uid(), file: null, title: "", text: "" });
  S.bookPage = M.clamp(S.bookPage, 0, b.pages.length - 1);
  const pg = b.pages[S.bookPage];
  const photoBtn = h("button", { type: "button", class: "ghost small", text: t("addPhotos"), onclick: async () => { const [id] = await savePhotos((await pickFiles()).slice(0, 1)); if (id) { pg.file = id; save(b); render(); } } });
  const pageEl = h("article", { class: "book-page", "aria-label": t("pageOf", S.bookPage + 1, b.pages.length) },
    h("div", { class: "ph" }, pg.file ? img(pg.file, pg.title || "") : photoBtn),
    pg.file ? photoBtn : null,
    h("input", { class: "pt", value: pg.title, placeholder: t("pageName"), "aria-label": t("pageName"), maxlength: String(M.LIMITS.title), oninput: (e) => { pg.title = e.target.value.slice(0, M.LIMITS.title); save(b); } }),
    h("textarea", { "data-auto": true, rows: "4", value: pg.text, placeholder: t("pageWords"), "aria-label": t("pageWords"), maxlength: String(M.LIMITS.text), oninput: (e) => { pg.text = e.target.value; autosize(e.target); save(b); } }),
    h("div", { class: "entry-actions" }, h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: () => { b.pages.splice(S.bookPage, 1); S.bookPage = Math.max(0, S.bookPage - 1); save(b); render(); } })));
  const nav = h("div", { class: "book-nav" },
    h("button", { type: "button", class: "ghost", text: `‹ ${t("prevPage")}`, disabled: S.bookPage === 0, onclick: () => { S.bookPage--; render(); } }),
    h("span", { class: "count", "aria-live": "polite", text: t("pageOf", S.bookPage + 1, b.pages.length) }),
    h("button", { type: "button", class: "ghost", text: `${t("nextPage")} ›`, disabled: S.bookPage >= b.pages.length - 1, onclick: () => { S.bookPage++; render(); } }),
    h("button", { type: "button", class: "primary", text: t("addPage"), onclick: () => { if (b.pages.length >= M.LIMITS.pages) return; b.pages.splice(S.bookPage + 1, 0, { id: M.uid(), file: null, title: "", text: "" }); S.bookPage++; save(b); render(); } }));
  const grid = h("ul", { class: "book-grid" }, ...b.pages.map((p, i) => h("li", {}, h("button", { type: "button", onclick: () => { S.bookPage = i; S.bookMode = "read"; render(); } }, p.file ? img(p.file, "") : h("span", { class: "blank" }), h("span", { text: p.title || t("pageOf", i + 1, b.pages.length) })))));
  return h("div", { class: b.kind === "burn" ? "burn" : "" },
    h("div", { class: "view-head" }, backBtn("#books"), h("span", { class: "spacer" }),
      h("div", { class: "seg", role: "radiogroup", "aria-label": t("bookTitle") },
        h("button", { type: "button", role: "radio", "aria-checked": String(S.bookMode === "read"), text: t("read"), onclick: () => { S.bookMode = "read"; render(); } }),
        h("button", { type: "button", role: "radio", "aria-checked": String(S.bookMode === "grid"), text: t("grid"), onclick: () => { S.bookMode = "grid"; render(); } })),
      h("button", { type: "button", class: "ghost small", text: t("delete"), onclick: async () => { await remove(b); go("#books"); } })),
    h("input", { class: "page-title", value: b.title, placeholder: b.kind === "burn" ? t("burn") : t("album"), "aria-label": t("bookTitle"), maxlength: String(M.LIMITS.title), oninput: (e) => { b.title = e.target.value; save(b); } }),
    S.bookMode === "grid" ? grid : h("div", { class: "book-view" }, pageEl, nav));
}

/* ---------- search ---------- */
function viewSearch() {
  const results = h("ul", { class: "results" }), found = h("p", { class: "found", "aria-live": "polite" });
  const q = h("input", { type: "search", "aria-label": t("searchTitle"), placeholder: t("searchHint") }), kind = h("select", { "aria-label": t("allKinds") },
    h("option", { value: "", text: t("allKinds") }), h("option", { value: "entry", text: t("kindEntry") }), h("option", { value: "page", text: t("kindPage") }), h("option", { value: "board", text: t("kindBoard") }), h("option", { value: "book", text: t("kindBook") }));
  const run = () => {
    const r = M.search([...S.items.values()], q.value, { type: kind.value });
    found.textContent = q.value.trim() ? t("found", r.length) : "";
    results.replaceChildren(...r.slice(0, 100).map((it) => {
      const href = it.type === "entry" ? "#today" : `#${it.type}s/${it.id}`;
      const title = it.type === "entry" ? fmtDay(M.dayOf(it.at)) + " · " + it.at.slice(11) : it.title || t("untitled");
      const snip = it.type === "entry" ? it.text : it.type === "page" ? M.pageText({ ...it, title: "" }) : it.type === "board" ? it.items.map((i) => i.text).join(" · ") : it.pages.map((p) => `${p.title} ${p.text}`).join(" · ");
      return h("li", {}, h("a", { class: "tile", href, onclick: () => { if (it.type === "entry") S.calMonth = M.monthOf(it.at); } }, h("span", { class: "kind", text: { entry: t("kindEntry"), page: t("kindPage"), board: t("kindBoard"), book: t("kindBook") }[it.type] }), h("strong", { text: title }), h("span", { text: snip.trim().slice(0, 200) })));
    }));
  };
  q.addEventListener("input", run); kind.addEventListener("change", run);
  setTimeout(() => q.focus());
  return h("div", {}, head(t("searchTitle")), h("div", { class: "card filters" }, h("label", { class: "f f-q" }, h("span", { text: t("searchHint") }), q), h("label", { class: "f" }, h("span", { text: t("allKinds") }), kind)), found, results);
}

/* ---------- settings: backup, restore, delete everything, preferences ---------- */
function viewSettings() {
  const usage = h("p", { class: "note" });
  Promise.all([db.fileIds(), navigator.storage?.estimate?.().catch(() => null)]).then(([ids, est]) => { usage.textContent = t("usage", S.items.size, ids.length, est?.usage ? Math.max(1, Math.round(est.usage / 1048576)) : "<1"); });
  const restore = h("input", { type: "file", accept: ".zip,application/zip", onchange: async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await restoreBackup(f); } });
  const lang = h("select", { onchange: (e) => setLang(e.target.value) }, h("option", { value: "en", text: "English" }), h("option", { value: "pt", text: "Português" })); lang.value = S.settings.lang;
  const theme = h("select", { onchange: (e) => { S.settings.theme = e.target.value; applyTheme(); saveSettings(); } }, h("option", { value: "", text: t("themeAuto") }), h("option", { value: "light", text: t("themeLight") }), h("option", { value: "dark", text: t("themeDark") })); theme.value = S.settings.theme;
  return h("div", {}, head(t("settingsTitle")),
    h("section", { class: "card", "aria-labelledby": "data-title" }, h("h2", { class: "card-title", id: "data-title", text: t("data") }), h("p", { class: "note", text: t("dataNote") }), usage,
      h("p", { class: "note warn", id: "storage-warn", hidden: !S.storageWarn, text: t("storageWarn") }),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "ghost", id: "backup", text: t("backup"), onclick: makeBackup }),
        h("label", { class: "btn ghost file-btn" }, h("span", { text: t("restore") }), restore),
        h("button", { type: "button", class: "danger", id: "wipe", text: t("wipe"), onclick: wipeAll }))),
    h("section", { class: "card", "aria-labelledby": "pref-title" }, h("h2", { class: "card-title", id: "pref-title", text: t("preferences") }),
      h("div", { class: "add-row" }, h("label", { class: "f" }, h("span", { text: t("language") }), lang), h("label", { class: "f" }, h("span", { text: t("theme") }), theme)),
      h("p", { class: "links" }, h("a", { href: "/privacy.html", text: t("privacy") }))));
}
async function makeBackup() {
  const items = [...S.items.values()], used = [...M.filesUsed(items)];
  const files = [];
  for (const id of used) { const blob = await db.getFile(id); if (blob) files.push([`files/${id}`, new Uint8Array(await blob.arrayBuffer())]); }
  const data = JSON.stringify({ app: "journal", version: M.BACKUP_VERSION, saved: new Date().toISOString(), items, settings: S.settings });
  const blob = await zip([["data.json", data], ...files]);
  const url = URL.createObjectURL(blob), a = h("a", { href: url, download: `quill-backup-${today()}.zip` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function restoreBackup(file) {
  let data, files;
  try {
    const parts = await unzip(new Uint8Array(await file.arrayBuffer()));
    data = JSON.parse(new TextDecoder().decode(parts.get("data.json")));
    if (M.checkBackup(data)) throw new Error("bad");
    files = [...parts].filter(([n]) => /^files\/[\w-]{1,64}$/.test(n)).map(([n, bytes]) => [n.slice(6), new Blob([bytes], { type: "image/jpeg" })]);
  } catch { toast(t("errBackup")); return; }
  if (S.items.size && !(await confirmBox(t("restoreReplace")))) return;
  await db.replaceAll(data.items, files);
  for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear();
  S.items = new Map(data.items.map((i) => [i.id, i])); toast(t("saved")); go("#today");
}
async function wipeAll() {
  const word = S.settings.lang === "pt" ? "APAGAR" : "DELETE";
  if (!(await confirmBox(t("wipeConfirm"), { typed: word, yes: t("wipe") }))) return;
  await db.wipe(); try { localStorage.clear(); } catch { /* ignore */ }
  location.replace("/");
}
function setLang(l) { S.settings.lang = l === "pt" ? "pt" : "en"; saveSettings(); applyWords(); render(); }

/* ---------- start ---------- */
async function start() {
  let items = [], settings = null;
  try { [items, settings] = await Promise.all([db.loadItems(), db.getKV("settings")]); } catch (e) { console.error(e); }
  const navLang = (navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : "en";
  S.settings = { lang: navLang, theme: "", ...(settings || {}) };
  try { const th = localStorage.getItem("theme"); if (th !== null) S.settings.theme = th; } catch { /* ignore */ }
  S.items = new Map(items.map((i) => [i.id, i]));
  applyTheme(); applyWords();
  for (const b of $$(".nav button")) b.onclick = () => go(`#${b.dataset.view}`);
  $("#lang").onclick = () => setLang(S.settings.lang === "pt" ? "en" : "pt");
  $("#theme").onclick = () => { const dark = (S.settings.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark"; S.settings.theme = dark ? "light" : "dark"; applyTheme(); saveSettings(); };
  addEventListener("hashchange", route);
  route();
  document.documentElement.dataset.ready = "1";
  gcFiles().catch(() => {});
  S.storageWarn = !(await db.persist()) && !matchMedia("(display-mode: standalone)").matches;
  const w = $("#storage-warn"); if (w) w.hidden = !S.storageWarn;
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
start();
