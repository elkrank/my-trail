import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { fetchBuffer } from "./fetch.mjs";
import { normalizeWhitespace } from "./parse.mjs";

export async function fetchPdfText(url, options = {}) {
  const result = await fetchBuffer(url, {
    ...options,
    accept: "application/pdf,*/*;q=0.8",
  });
  if (!/application\/pdf|octet-stream/i.test(result.contentType ?? "")) {
    const error = new Error(`Expected PDF for ${url}, got ${result.contentType ?? "unknown content type"}`);
    error.status = result.status;
    throw error;
  }

  const parsed = await parsePdfBuffer(result.content);
  return {
    ...result,
    text: parsed.text,
    pageCount: parsed.numpages ?? null,
    layoutPages: parsed.layoutPages,
  };
}

export async function parsePdfBuffer(content) {
  const layoutPages = [];
  const parsed = await pdfParse(content, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true,
      });
      const items = textContent.items.map((item) => ({
        text: item.str,
        x: round(item.transform?.[4]),
        y: round(item.transform?.[5]),
        width: round(item.width),
        height: round(item.height),
      }));
      layoutPages.push({ pageNumber: layoutPages.length + 1, items });
      return renderTextItems(items);
    },
  });
  return {
    ...parsed,
    text: normalizeWhitespace(parsed.text ?? ""),
    layoutPages,
  };
}

function renderTextItems(items) {
  let lastY = null;
  let text = "";
  for (const item of items) {
    text += lastY === null || Math.abs(lastY - item.y) < 0.1 ? item.text : `\n${item.text}`;
    lastY = item.y;
  }
  return text;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}
