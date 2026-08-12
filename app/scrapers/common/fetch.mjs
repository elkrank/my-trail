export async function fetchText(url, options = {}) {
  const retrievedAt = new Date().toISOString();
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": options.language ?? "fr-FR,fr;q=0.9,en;q=0.8",
      "user-agent": options.userAgent ??
        "TrailCompareMVP/0.1 (+https://example.local; official-source-scraper)",
    },
    redirect: "follow",
  });

  const content = await response.text();
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${url}`);
    error.status = response.status;
    error.content = content;
    throw error;
  }

  return {
    url,
    finalUrl: response.url,
    retrievedAt,
    status: response.status,
    contentType: response.headers.get("content-type"),
    content,
  };
}

export async function fetchMany(urls, options = {}) {
  const results = [];
  const errors = [];

  for (const url of urls) {
    try {
      results.push(await fetchText(url, options));
    } catch (error) {
      errors.push({
        url,
        message: error.message,
        status: error.status ?? null,
      });
    }
  }

  return { results, errors };
}
