import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

async function open(page, { hash = "" } = {}) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Content Security Policy/.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
  await page.goto(`/${hash}`); await page.waitForSelector("html[data-ready]");
  if (await page.evaluate(() => document.documentElement.lang !== "en")) await page.click("#lang");
  return problems;
}
// A phone-like photo with a real Exif block: camera make/model and a GPS position
// (tests/fixtures/make-gps-photo.py).
async function photoWithGPS() {
  const buffer = await readFile(new URL("../fixtures/gps.jpg", import.meta.url));
  return { name: "holiday.jpg", mimeType: "image/jpeg", buffer };
}
async function chooseFile(page, file, click) { const [fc] = await Promise.all([page.waitForEvent("filechooser"), click()]); await fc.setFiles(file); }
const storedFiles = (page) => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("journal"); r.onsuccess = () => { const q = r.result.transaction("files").objectStore("files").getAll(); q.onsuccess = async () => res(await Promise.all(q.result.map(async (v) => ({ size: v.data.byteLength, type: v.type, text: new TextDecoder("latin1").decode(new Uint8Array(v.data)) })))); }; }));

test("opens with no errors, no outside requests and no security policy violations", async ({ page }) => {
  const outside = []; page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1:4184")) outside.push(r.url()); });
  const problems = await open(page);
  for (const v of ["today", "pages", "boards", "books", "search", "settings"]) { await page.goto(`/#${v}`); await page.waitForTimeout(80); }
  expect(problems).toEqual([]); expect(outside).toEqual([]);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
});

test("diary: write with a mood and tags, see it on the calendar, edit it, delete and undo, still there after reload", async ({ page }) => {
  await open(page);
  await page.locator(".mood", { hasText: "Great" }).click();
  await page.fill("#entry-text", "Swam in the sea.");
  await page.fill('input[name="tags"]', "sea, Summer, #sea");
  await page.click('form.composer button[type="submit"]');
  const entry = page.locator("article.entry").first();
  await expect(entry).toContainText("Swam in the sea."); await expect(entry).toContainText("Great");
  await expect(entry.locator(".tags li")).toHaveText(["sea", "summer"]);
  await expect(page.locator(".cal .d.today")).toHaveClass(/m5/);
  await expect(page.locator(".cal .d.today")).toHaveAttribute("aria-label", /1 entry, Great/);
  await expect(page.locator(".stat-line")).toContainText("1 day in a row");
  await entry.getByRole("button", { name: "Edit" }).click();
  await expect(page.locator("#entry-text")).toHaveValue("Swam in the sea.");
  await page.fill("#entry-text", "Swam in the sea. Cold!");
  await page.click('form.composer button[type="submit"]');
  await expect(page.locator("article.entry")).toHaveCount(1);
  await expect(page.locator("article.entry")).toContainText("Cold!");
  await page.locator("article.entry").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("article.entry")).toHaveCount(0);
  await page.locator("#toast button").click();
  await expect(page.locator("article.entry")).toHaveCount(1);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("article.entry")).toContainText("Cold!");
});

test("photos are made smaller and lose their hidden GPS location before they are kept", async ({ page }) => {
  await open(page);
  const file = await photoWithGPS(page);
  expect(file.buffer.includes("SecretCameraMaker")).toBe(true);
  await chooseFile(page, file, () => page.getByRole("button", { name: "Add Photos" }).click());
  await expect(page.locator(".thumbs img")).toHaveCount(1);
  await page.fill("#entry-text", "Beach day");
  await page.click('form.composer button[type="submit"]');
  await expect(page.locator("article.entry .photos img")).toHaveCount(1);
  await expect.poll(async () => (await page.locator("article.entry .photos img").evaluate((i) => i.naturalWidth))).toBe(640);
  const files = await storedFiles(page);
  expect(files).toHaveLength(1);
  expect(files[0].type).toBe("image/jpeg");
  // Safari's own encoder may add a minimal Exif header (image size only); what must be gone is
  // the camera make/model and the GPS block (tag 0x8825) from the original photo.
  const at = files[0].text.indexOf("Exif");
  const exif = at < 0 ? "" : files[0].text.slice(at, at + files[0].text.charCodeAt(at - 2) * 256 + files[0].text.charCodeAt(at - 1));
  expect(exif).not.toContain("\x88%");
  expect(files[0].text).not.toContain("SecretCamera");
});

test("a file that is not a photo is refused with a clear message", async ({ page }) => {
  await open(page);
  await chooseFile(page, { name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("definitely not a picture") }, () => page.getByRole("button", { name: "Add Photos" }).click());
  await expect(page.locator("#toast span")).toHaveText("That file is not a photo this app can read.");
  await expect(page.locator(".thumbs img")).toHaveCount(0);
});

test("pages: shortcuts make headings, to-dos, quotes and dividers; Enter and Backspace add and remove blocks; tables grow", async ({ page }) => {
  await open(page, { hash: "#pages" });
  await page.getByRole("button", { name: "New Page" }).click();
  await page.fill(".page-title", "Trip Plan");
  const first = page.locator(".blocks textarea").first();
  await first.fill("# Packing");
  await expect(page.locator(".block.h textarea")).toHaveValue("Packing");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] passport");
  await expect(page.locator(".block.todo textarea")).toHaveValue("passport");
  await page.keyboard.press("Enter"); await page.keyboard.type("charger");
  await expect(page.locator(".block.todo")).toHaveCount(2);
  await page.keyboard.press("Enter"); await page.keyboard.press("Backspace");
  await expect(page.locator(".block.todo")).toHaveCount(2);
  await page.locator(".block.todo input[type=checkbox]").first().check();
  await expect(page.locator(".block.todo").first()).toHaveClass(/done/);
  await page.getByRole("button", { name: "+ Quote" }).click(); await page.keyboard.type("Not all who wander are lost");
  await page.getByRole("button", { name: "+ Divider" }).click();
  await page.getByRole("button", { name: "+ Table" }).click();
  const table = page.locator(".block.table");
  await table.getByRole("button", { name: "Add Row" }).click();
  await table.getByRole("button", { name: "Add Column" }).click();
  await expect(table.locator("tr")).toHaveCount(3); await expect(table.locator("tr").first().locator("td")).toHaveCount(3);
  await table.locator("input").first().fill("Day");
  await page.locator(".block.quote").getByRole("button", { name: "Move Up" }).click();
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".page-title")).toHaveValue("Trip Plan");
  expect(await page.$$eval(".blocks > li", (l) => l.map((x) => x.classList[1]))).toEqual(["h", "todo", "quote", "todo", "divider", "table"]);
  await expect(page.locator(".block.table input").first()).toHaveValue("Day");
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.locator(".tile").first()).toContainText("Trip Plan");
  await expect(page.locator(".tile").first()).toContainText("1/2 ✓");
});

test("boards: notes and images can be placed anywhere, resized, recoloured, moved with keys, and stay put", async ({ page, isMobile }) => {
  await open(page, { hash: "#boards" });
  await page.getByRole("button", { name: "New Board" }).click();
  await page.fill(".page-title", "Kitchen Ideas");
  await page.getByRole("button", { name: "Add Note" }).click();
  await page.locator(".bi textarea").fill("Blue tiles");
  const note = page.locator(".bi").first();
  const before = await note.boundingBox();
  if (!isMobile) {
    const grip = await note.locator(".grip").boundingBox();
    await page.mouse.move(grip.x + 20, grip.y + 10); await page.mouse.down(); await page.mouse.move(grip.x + 220, grip.y + 130, { steps: 6 }); await page.mouse.up();
    const after = await note.boundingBox();
    expect(Math.round(after.x - before.x)).toBe(200);
    const h = await note.locator(".resize").boundingBox();
    await page.mouse.move(h.x + 15, h.y + 15); await page.mouse.down(); await page.mouse.move(h.x + 95, h.y + 55, { steps: 5 }); await page.mouse.up();
    expect(Math.round((await note.boundingBox()).width - after.width)).toBe(80);
  }
  await note.focus();
  const k0 = await note.boundingBox();
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowDown");
  const k1 = await note.boundingBox();
  expect(Math.round(k1.x - k0.x)).toBe(10); expect(Math.round(k1.y - k0.y)).toBe(50);
  await page.locator(".bi.selected").getByRole("radio", { name: "Sage" }).click(); // the colour is picked on the note itself
  await expect(page.locator(".bi").first()).toHaveClass(/sage/);
  const file = await photoWithGPS(page);
  await chooseFile(page, file, () => page.getByRole("button", { name: "Add Image" }).click());
  await expect(page.locator(".bi img")).toHaveCount(1);
  await page.waitForTimeout(500);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator(".bi")).toHaveCount(2);
  await expect(page.locator(".bi textarea")).toHaveValue("Blue tiles");
  await expect(page.locator(".bi").first()).toHaveClass(/sage/);
});

test("books: a photo album with pages to turn, and a burn book with its own look", async ({ page }) => {
  await open(page, { hash: "#books" });
  await page.getByRole("button", { name: "New Photo Album" }).click();
  await page.fill(".page-title", "Lisbon 2026");
  const file = await photoWithGPS(page);
  await chooseFile(page, file, () => page.locator(".book-page").getByRole("button", { name: "Add Photos" }).click());
  await expect(page.locator(".book-page .ph img")).toHaveCount(1);
  await page.getByLabel("Title", { exact: true }).fill("Alfama");
  await page.getByRole("button", { name: "Add Page" }).click();
  await expect(page.locator(".book-nav .count")).toHaveText("Page 2 of 2");
  await page.getByLabel("Title", { exact: true }).fill("Belém");
  await page.getByRole("button", { name: "‹ Previous Page" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Alfama");
  await page.getByRole("radio", { name: "All Pages" }).click();
  await expect(page.locator(".book-grid li")).toHaveCount(2);
  await page.getByRole("button", { name: "← Back" }).click();
  await page.getByRole("button", { name: "New Burn Book" }).click();
  await expect(page.locator(".burn .book-page")).toHaveCount(1);
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.locator(".tile .kind")).toHaveText(["Burn Book", "Photo Album"]);
});

test("search finds words in every kind of item, without accents", async ({ page }) => {
  await open(page);
  await page.fill("#entry-text", "Café com a avó"); await page.click('form.composer button[type="submit"]');
  await page.goto("/#pages"); await page.getByRole("button", { name: "New Page" }).click(); await page.fill(".page-title", "Receitas da avó");
  await page.waitForTimeout(450);
  await page.goto("/#search");
  await page.getByRole("searchbox").fill("AVO");
  await expect(page.locator(".found")).toHaveText("2 found");
  await page.getByRole("combobox").selectOption("page");
  await expect(page.locator(".results .tile")).toHaveCount(1);
  await page.locator(".results .tile").click();
  await expect(page.locator(".page-title")).toHaveValue("Receitas da avó");
});

test("backup with photos, delete everything only after typing the word, then restore it all", async ({ page }) => {
  await open(page);
  const file = await photoWithGPS(page);
  await chooseFile(page, file, () => page.getByRole("button", { name: "Add Photos" }).click());
  await page.fill("#entry-text", "Keep me"); await page.click('form.composer button[type="submit"]');
  await expect(page.locator("article.entry .photos img")).toHaveCount(1);
  await page.goto("/#settings");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#backup")]);
  expect(dl.suggestedFilename()).toMatch(/^quill-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const backup = await dl.path();
  await page.click("#wipe"); await page.locator("#confirm input").fill("nah"); await page.locator("#confirm-yes").click();
  await page.goto("/#today"); await expect(page.locator("article.entry")).toHaveCount(1);
  await page.goto("/#settings"); await page.click("#wipe"); await page.locator("#confirm input").fill("delete"); await page.locator("#confirm-yes").click();
  await page.waitForURL(/\/$/); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("article.entry")).toHaveCount(0);
  expect(await storedFiles(page)).toHaveLength(0);
  await page.goto("/#settings");
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles(backup);
  await expect(page.locator("article.entry")).toContainText("Keep me");
  await expect.poll(async () => page.locator("article.entry .photos img").evaluate((i) => i.naturalWidth)).toBe(640);
  await page.goto("/#settings");
  await page.locator('input[type="file"][accept^=".zip"]').setInputFiles({ name: "x.zip", mimeType: "application/zip", buffer: Buffer.from("nope") });
  await expect(page.locator("#toast span")).toHaveText("That is not a backup from this app.");
});

test("text typed as HTML stays text everywhere", async ({ page }) => {
  await open(page);
  await page.fill("#entry-text", '<img src=x onerror="window.__xss=1"><b>bold</b>');
  await page.click('form.composer button[type="submit"]');
  await page.goto("/#pages"); await page.getByRole("button", { name: "New Page" }).click(); await page.fill(".page-title", "<script>window.__xss=2</script>");
  await page.waitForTimeout(450); await page.goto("/#pages"); await page.goto("/#search"); await page.getByRole("searchbox").fill("img");
  await page.goto("/#today");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator("article.entry img, article.entry b").count()).toBe(0);
});

test("Portuguese: every label switches and headings and buttons are in Title Case in both languages", async ({ page }) => {
  await open(page);
  const SMALL = { en: new Set(["a", "an", "and", "the", "of", "in", "on", "at", "to", "for", "by", "as", "or"]), pt: new Set(["o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "por", "para", "com", "ao", "um", "uma", "como"]) };
  for (const lang of ["en", "pt"]) {
    if (lang === "pt") await page.click("#lang");
    const bad = [];
    for (const v of ["today", "pages", "boards", "books", "search", "settings"]) {
      await page.goto(`/#${v}`); await page.waitForTimeout(80);
      const texts = await page.$$eval("h1, h2, legend, button:not(.icon-btn):not(.row-btn), .nav span, label > span:first-child, .mood span, option", (els) => els.filter((e) => !e.closest(".thumbs, .book-grid, .entry-head, #toast")).map((e) => e.textContent.trim()).filter(Boolean));
      for (const s of texts) s.replace(/[(),…:·‹›←+]/g, " ").split(/\s+/).filter(Boolean).forEach((w, i) => { if (!/^\p{L}/u.test(w) || (i && SMALL[lang].has(w))) return; if (w[0] !== w[0].toUpperCase()) bad.push(`${v}: ${s} [${w}]`); });
    }
    expect(bad, lang).toEqual([]);
  }
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-PT");
  await page.goto("/#today");
  await expect(page.locator("legend")).toHaveText("Como Está?");
});

for (const view of ["today", "pages", "boards", "books", "search", "settings"]) {
  test(`${view}: no serious accessibility problems, light and dark`, async ({ page }) => {
    await open(page);
    await page.locator(".mood", { hasText: "Good" }).click(); await page.fill("#entry-text", "Hello"); await page.click('form.composer button[type="submit"]');
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`/#${view}`); await page.waitForTimeout(120);
      if (view === "pages" && scheme === "light") { await page.getByRole("button", { name: "New Page" }).click(); await page.locator(".blocks textarea").first().fill("[] a"); await page.getByRole("button", { name: "+ Table" }).click(); }
      if (view === "boards" && scheme === "light") { await page.getByRole("button", { name: "New Board" }).click(); await page.getByRole("button", { name: "Add Note" }).click(); }
      if (view === "books" && scheme === "light") { await page.getByRole("button", { name: "New Burn Book" }).click(); }
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(r.violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => `${scheme}: ${v.id} ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    }
  });
}

test("phone: nothing scrolls sideways and every button is at least 44px tall", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone only");
  await open(page);
  for (const v of ["today", "pages", "boards", "books", "search", "settings"]) {
    await page.goto(`/#${v}`); await page.waitForTimeout(100);
    if (v === "pages") await page.getByRole("button", { name: "New Page" }).click();
    if (v === "books") await page.getByRole("button", { name: "New Photo Album" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), v).toBe(true);
    const small = await page.$$eval("button, a[href], select, input:not([type=checkbox]):not([type=file]):not([type=radio]), .mood span", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 43.5 && !e.closest("[hidden], .thumbs"); }).map((e) => `${e.tagName} ${e.textContent.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}`));
    expect(small, v).toEqual([]);
  }
});

test("the privacy page exists in both languages and runs only the frame script", async ({ page }) => {
  await page.goto("/privacy.html");
  await expect(page.locator("h1")).toHaveText(["Privacy", "Privacidade"]);
  await expect(page.locator("script")).toHaveCount(1);
  await expect(page.locator("script")).toHaveAttribute("src", "/js/frame.js");
  await expect(page.locator("body")).toContainText("GPS");
});

test("works offline after the first visit (installable app)", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "service workers need localhost or https; checked in Chrome");
  await page.goto("http://localhost:4184/"); await page.waitForSelector("html[data-ready]");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await page.fill("#entry-text", "Offline thought"); await page.click('form.composer button[type="submit"]');
  await expect(page.locator("article.entry")).toHaveCount(1);
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector("html[data-ready]");
  await expect(page.locator("article.entry")).toContainText("Offline thought");
});

test("monkey: 150 random taps, keys and typing break nothing", async ({ page }) => {
  test.setTimeout(150000);
  const problems = await open(page);
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 150; i++) {
    const r = rnd();
    if (await page.locator("dialog[open]").count()) { await page.keyboard.press("Escape"); continue; }
    if (r < 0.6) {
      const els = await page.$$("button:visible, a[href^='#']:visible, .mood:visible");
      const el = els[Math.floor(rnd() * els.length)];
      if (el && !(await el.evaluate((e) => e.id === "wipe" || e.closest("#toast") || /Add Photos|Add Image|\+ Image/.test(e.textContent)))) await el.click({ timeout: 1000 }).catch(() => {});
    } else if (r < 0.85) {
      const inputs = await page.$$("input:visible:not([type=file]):not([type=checkbox]):not([type=radio]), textarea:visible");
      const el = inputs[Math.floor(rnd() * inputs.length)];
      if (el) await el.fill(["# title", "[] task", "> q", "---", "<b>x</b>", "", "olá 🌙"][Math.floor(rnd() * 7)], { timeout: 1000 }).catch(() => {});
    } else await page.keyboard.press(["Enter", "Backspace", "Tab", "Escape", "ArrowRight", "ArrowDown"][Math.floor(rnd() * 6)]);
  }
  expect(problems).toEqual([]);
});

/* ---------- phone frame (same as ivolopes.com) ---------- */
test("nothing is pinned to the screen edges (iPhone Safari paints a solid band over it)", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("html[data-ready]");
  const pinned = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position)).map((el) => el.id || el.className));
  expect(pinned).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe("hidden");
});

test("the window sits scrolled down by the strip above it, and only the page layer scrolls", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("html[data-ready]");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160);
  const top = await page.locator(".top").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(40);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(160);
});

test("the background covers the whole screen and past it, and is never one flat colour", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("html[data-ready]");
  const vp = page.viewportSize();
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const bg = await page.locator(".bg").evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, img: getComputedStyle(el).backgroundImage }; });
    expect(bg.top, scheme).toBeLessThanOrEqual(-150);
    expect(bg.bottom, scheme).toBeGreaterThanOrEqual(vp.height);
    expect(bg.w, scheme).toBeGreaterThanOrEqual(vp.width);
    expect(bg.img, scheme).not.toBe("none");
  }
});
