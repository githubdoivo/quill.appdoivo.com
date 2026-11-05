import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../../js/model.js";
import { zip, unzip } from "../../js/zip.js";

test("time stamps: local minutes, days and months move across year ends", () => {
  assert.ok(M.isStamp("2026-11-05T03:20") && !M.isStamp("2026-11-05T24:00") && !M.isStamp("2026-13-01T10:00"));
  assert.equal(M.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(M.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(M.addMonths("2026-01", -1), "2025-12");
  assert.equal(M.daysInMonth("2028-02"), 29);
  assert.equal(M.firstWeekday("2026-11"), 6, "1 Nov 2026 is a Sunday");
  assert.equal(M.localStamp(new Date(2026, 0, 2, 3, 4)), "2026-01-02T03:04");
});

test("tags: no #, lowercase, no duplicates even with accents, capped", () => {
  assert.deepEqual(M.parseTags("#Praia, verão  #praia #Verao"), ["praia", "verão"]);
  assert.equal(M.parseTags(Array.from({ length: 30 }, (_, i) => "t" + i).join(" ")).length, M.LIMITS.tags);
  assert.deepEqual(M.parseTags(""), []);
});

test("makers clean what comes in: bad moods, long text, wrong kinds", () => {
  const e = M.newEntry({ at: "nonsense", mood: 9, text: "x".repeat(30000) });
  assert.ok(M.isStamp(e.at)); assert.equal(e.mood, null); assert.equal(e.text.length, M.LIMITS.text);
  assert.equal(M.newEntry({ mood: 4 }).mood, 4);
  assert.equal(M.newBook({ kind: "weird" }).kind, "album");
  assert.equal(M.newBook({ kind: "burn" }).kind, "burn");
  assert.equal(M.newBlock("script").kind, "text");
  assert.deepEqual(M.newBlock("table").rows, [["", ""], ["", ""]]);
  assert.equal(M.newPage().blocks.length, 1);
});

test("blocks: move, insert, and typed shortcuts turn into headings, to-dos, quotes, dividers", () => {
  const a = M.newBlock("text"), b = M.newBlock("h"), c = M.newBlock("todo");
  let list = [a, b, c];
  assert.deepEqual(M.moveBlock(list, c.id, -1).map((x) => x.id), [a.id, c.id, b.id]);
  assert.equal(M.moveBlock(list, a.id, -1), list, "the first cannot go up");
  const d = M.newBlock("quote");
  assert.deepEqual(M.insertAfter(list, a.id, d).map((x) => x.id), [a.id, d.id, b.id, c.id]);
  assert.deepEqual(M.shortcut("# Ideas"), { kind: "h", text: "Ideas" });
  assert.deepEqual(M.shortcut("[] buy film"), { kind: "todo", text: "buy film" });
  assert.deepEqual(M.shortcut("> quote"), { kind: "quote", text: "quote" });
  assert.deepEqual(M.shortcut("---"), { kind: "divider" });
  assert.equal(M.shortcut("plain text"), null);
});

test("tables grow and shrink but never below 1x1 or above the limits", () => {
  let r = [["a", "b"], ["c", "d"]];
  r = M.tableOp(r, "addRow"); assert.equal(r.length, 3); assert.deepEqual(r[2], ["", ""]);
  r = M.tableOp(r, "addCol", 1); assert.deepEqual(r[0], ["a", "", "b"]);
  r = M.tableOp(M.tableOp(M.tableOp(r, "delRow"), "delRow"), "delRow"); assert.equal(r.length, 1);
  r = M.tableOp(M.tableOp(M.tableOp(r, "delCol"), "delCol"), "delCol"); assert.deepEqual(r, [["a"]]);
  let big = [Array(M.LIMITS.cols).fill("")]; assert.equal(M.tableOp(big, "addCol")[0].length, M.LIMITS.cols);
});

test("board items stay on the board and come in clean", () => {
  const i = M.boardItem("note", { x: -50, y: 99999, w: 5, color: "neon", text: "hi" });
  assert.equal(i.x, 0); assert.equal(i.y, 4000); assert.equal(i.w, 80); assert.equal(i.color, "paper");
  assert.equal(M.boardItem("script").kind, "note");
  assert.equal(M.topZ([{ z: 3 }, { z: 7 }]), 8);
  assert.deepEqual(M.boardSize([{ x: 1500, y: 100, w: 200, h: 100 }]), { w: 1900, h: 800 });
});

test("diary: mood per day, mood counts and average, streaks, on this day", () => {
  const E = (at, mood) => M.newEntry({ at, mood });
  const list = [E("2026-11-01T09:00", 4), E("2026-11-01T21:00", 2), E("2026-11-03T10:00", 5), E("2026-11-04T10:00", null), E("2026-11-05T08:00", 3), E("2025-11-05T08:00", 1), E("2026-10-31T10:00", 1)];
  const byDay = M.moodByDay(list, "2026-11");
  assert.equal(byDay.get("2026-11-01"), 3); assert.equal(byDay.get("2026-11-03"), 5); assert.equal(byDay.has("2026-11-04"), false);
  const st = M.moodStats(list, { from: "2026-11-01" });
  assert.deepEqual(st.counts, [0, 1, 1, 1, 1]); assert.equal(st.average, 3.5); assert.equal(st.n, 4);
  assert.equal(M.streak(list, "2026-11-05"), 3, "3, 4 and 5 November");
  assert.equal(M.streak(list, "2026-11-06"), 3, "still alive the next day until bedtime");
  assert.equal(M.streak(list, "2026-11-08"), 0);
  assert.deepEqual(M.onThisDay(list, "2026-11-05").map((e) => e.at), ["2025-11-05T08:00"]);
});

test("search looks everywhere, ignores accents, and can be limited to one kind", () => {
  const page = M.newPage({ title: "Receitas", blocks: [M.newBlock("table", { rows: [["Pão de ló", "ovos"]] })] });
  const entry = M.newEntry({ text: "Dia de praia", tags: ["verão"] });
  const board = M.newBoard({ title: "Casa", items: [M.boardItem("note", { text: "Cozinha azul" })] });
  const book = M.newBook({ title: "Lisboa", pages: [{ id: "p", title: "Alfama", text: "Elétrico" }] });
  const all = [page, entry, board, book];
  assert.deepEqual(M.search(all, "pao de lo").map((x) => x.id), [page.id]);
  assert.deepEqual(M.search(all, "VERAO").map((x) => x.id), [entry.id]);
  assert.deepEqual(M.search(all, "cozinha").map((x) => x.id), [board.id]);
  assert.deepEqual(M.search(all, "eletrico").map((x) => x.id), [book.id]);
  assert.deepEqual(M.search(all, "praia", { type: "page" }), []);
  assert.deepEqual(M.search(all, "  "), []);
});

test("to-do progress and the files each item uses", () => {
  const p = M.newPage({ blocks: [M.newBlock("todo", { done: true }), M.newBlock("todo"), M.newBlock("image", { file: "f1" })] });
  assert.deepEqual(M.todoProgress(p), { done: 1, total: 2 });
  const used = M.filesUsed([p, M.newEntry({ photos: ["f2"] }), M.newBoard({ items: [M.boardItem("image", { file: "f3" })] }), M.newBook({ pages: [{ id: "x", file: "f4" }] })]);
  assert.deepEqual([...used].sort(), ["f1", "f2", "f3", "f4"]);
});

test("backups are checked before they replace anything", () => {
  const good = { app: "journal", version: 1, items: [M.newEntry({ mood: 3 }), M.newPage(), M.newBoard(), M.newBook()] };
  assert.equal(M.checkBackup(good), null);
  assert.equal(M.checkBackup({ ...good, app: "expenses" }), "bad-backup");
  assert.equal(M.checkBackup({ ...good, items: [{ id: "x", type: "entry", at: "bad", mood: 3, photos: [], tags: [] }] }), "bad-backup");
  assert.equal(M.checkBackup({ ...good, items: [{ id: "x", type: "virus" }] }), "bad-backup");
});

test("backup zips hold the data and photos byte for byte", async () => {
  const photo = new Uint8Array([1, 2, 3, 255, 0, 9]);
  const z = new Uint8Array(await (await zip([["data.json", '{"a":1}'], ["files/abc", photo]])).arrayBuffer());
  const f = await unzip(z);
  assert.equal(new TextDecoder().decode(f.get("data.json")), '{"a":1}');
  assert.deepEqual([...f.get("files/abc")], [...photo]);
});
