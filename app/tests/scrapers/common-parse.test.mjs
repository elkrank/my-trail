import assert from "node:assert/strict";
import test from "node:test";
import {
  extractIllustration,
  minutesBetween,
  parseCutoffDisplayToIso,
  parseDate,
  parseDurationToMinutes,
  parseTime,
  stripHtml,
} from "../../scrapers/common/parse.mjs";

test("parses French and English race dates", () => {
  assert.equal(parseDate("28 novembre 2026", 2026), "2026-11-28");
  assert.equal(parseDate("Friday 28th August 2026", 2026), "2026-08-28");
  assert.equal(parseDate("2026-10-17", 2026), "2026-10-17");
});

test("parses duration formats used by official race pages", () => {
  assert.equal(parseDurationToMinutes("46:45"), 2805);
  assert.equal(parseDurationToMinutes("13h15"), 795);
  assert.equal(parseDurationToMinutes("46 Hours 45 Minutes"), 2805);
});

test("parses cutoff display when start date and weekday make it certain", () => {
  const start = "2026-08-28T17:45:00";
  const cutoff = parseCutoffDisplayToIso("Sat 12:00 AM", start);
  assert.equal(cutoff, "2026-08-29T00:00:00");
  assert.equal(minutesBetween(start, cutoff), 375);
});

test("keeps absent values as null", () => {
  assert.equal(parseDate("date a venir", 2026), null);
  assert.equal(parseTime("a venir"), null);
  assert.equal(parseDurationToMinutes("a venir"), null);
});

test("decodes common official HTML entities", () => {
  assert.equal(stripHtml("<p>D&eacute;nivel&eacute; : 1&nbsp;500 m &euro;</p>"), "Dénivelé : 1 500 m €");
});
test("extracts official illustration meta images as absolute HTTP URLs", () => {
  assert.equal(
    extractIllustration('<meta property="og:image" content="/media/race.jpg">', "https://example.test/course/utmb"),
    "https://example.test/media/race.jpg",
  );

  assert.equal(
    extractIllustration('<meta property="og:image" content="/logo.svg"><meta name="twitter:image" content="https://cdn.example.test/race.webp">', "https://example.test"),
    "https://cdn.example.test/race.webp",
  );
});

test("extracts the first likely illustration image and ignores unsafe URLs", () => {
  const html = `
    <img src="/assets/logo.png" alt="Logo">
    <img data-src="/photos/trail.jpg" alt="Trail route">
  `;

  assert.equal(extractIllustration(html, "https://example.test/course"), "https://example.test/photos/trail.jpg");
  assert.equal(
    extractIllustration('<picture><source srcset="/photos/trail.webp 1x"><img src="/assets/logo.png" alt="Logo"></picture>', "https://example.test/course"),
    "https://example.test/photos/trail.webp",
  );
  assert.equal(extractIllustration('<img src="data:image/png;base64,abc">', "https://example.test/course"), null);
});
