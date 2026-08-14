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

  const parsed = await pdfParse(result.content);
  return {
    ...result,
    text: normalizeWhitespace(parsed.text ?? ""),
    pageCount: parsed.numpages ?? null,
  };
}
