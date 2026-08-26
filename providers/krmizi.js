/**
 * Krmizi provider for Nuvio
 * Target: https://krmizi.onl/
 *
 * Notes:
 * - TV series only.
 * - Uses public TMDB web pages (no API key) to obtain Arabic/Turkish/English titles.
 * - Does not bypass DRM. It only reads publicly available pages/embeds.
 */

const cheerio = require("cheerio-without-node-native");

const BASE_URL = "https://krmizi.onl";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(referer) {
  const h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7,tr;q=0.6"
  };
  if (referer) h["Referer"] = referer;
  return h;
}

function absUrl(url, base) {
  if (!url) return "";
  const s = String(url).trim().replace(/&amp;/g, "&");
  if (!s) return "";
  if (s.startsWith("//")) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;
  try {
    return new URL(s, base || BASE_URL).toString();
  } catch (_) {
    return "";
  }
}

function cleanTitle(s) {
  return String(s || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*-\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .trim();
}

async function fetchText(url, referer) {
  const res = await fetch(url, {
    headers: headers(referer),
    skipSizeCheck: true
  });
  if (!res || !res.ok) {
    throw new Error(`HTTP ${res ? res.status : "?"} for ${url}`);
  }
  return await res.text();
}

function looksLikeCloudflare(html) {
  const s = String(html || "").toLowerCase();
  return (
    s.includes("cf-chl-") ||
    s.includes("challenge-platform") ||
    s.includes("just a moment") ||
    s.includes("checking your browser")
  );
}

async function getTmdbTitle(tmdbId, language) {
  try {
    const url = `https://www.themoviedb.org/tv/${encodeURIComponent(tmdbId)}?language=${encodeURIComponent(language)}`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const og = $('meta[property="og:title"]').attr("content");
    const h2 = $("section.inner_content h2 a").first().text();
    const pageTitle = $("title").text();
    return cleanTitle(og || h2 || pageTitle);
  } catch (e) {
    console.log(`[Krmizi] TMDB title ${language} failed: ${e.message}`);
    return "";
  }
}

function normalizeForCompare(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTitle(candidate, queries) {
  const c = normalizeForCompare(candidate);
  if (!c) return -1;
  let score = 0;
  for (const q0 of queries) {
    const q = normalizeForCompare(q0);
    if (!q) continue;
    if (c === q) score = Math.max(score, 100);
    else if (c.includes(q) || q.includes(c)) score = Math.max(score, 80);
    else {
      const qWords = q.split(" ").filter(Boolean);
      const hits = qWords.filter(w => c.includes(w)).length;
      if (qWords.length) score = Math.max(score, Math.round((hits / qWords.length) * 60));
    }
  }
  return score;
}

async function searchKrmizi(query) {
  if (!query) return [];
  const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
  const html = await fetchText(url, BASE_URL + "/");
  if (looksLikeCloudflare(html)) {
    throw new Error("Cloudflare challenge returned by Krmizi");
  }

  const $ = cheerio.load(html);
  const results = [];

  // Old/current Krmizi layouts.
  $("div.block-post, article.postEp").each((_, el) => {
    const a = $(el).find("a").first();
    const href = absUrl(a.attr("href"), BASE_URL);
    if (!href) return;

    const title =
      a.find("div.title").first().text().trim() ||
      $(el).find("div.title").first().text().trim() ||
      a.attr("title") ||
      a.text().trim();

    results.push({ href, title });
  });

  // Fallback: collect likely series/episode links.
  if (!results.length) {
    $("a[href]").each((_, el) => {
      const href = absUrl($(el).attr("href"), BASE_URL);
      const title = ($(el).attr("title") || $(el).text() || "").trim();
      if (!href || !title) return;
      if (/\/(series|episode)\//i.test(href)) results.push({ href, title });
    });
  }

  return results;
}

async function resolveSeriesPage(resultUrl) {
  const html = await fetchText(resultUrl, BASE_URL + "/");
  const $ = cheerio.load(html);

  // If search result is an episode, Krmizi links back to its series here.
  const seriesHref = $("div.singleSeries div.info h1 a").first().attr("href");
  if (seriesHref) return absUrl(seriesHref, resultUrl);

  return resultUrl;
}

async function findSeriesPage(titleCandidates) {
  let all = [];
  for (const q of titleCandidates) {
    if (!q) continue;
    try {
      const r = await searchKrmizi(q);
      all = all.concat(r);
      if (r.length) break;
    } catch (e) {
      console.log(`[Krmizi] Search failed for "${q}": ${e.message}`);
    }
  }
  if (!all.length) return "";

  all.sort((a, b) => scoreTitle(b.title, titleCandidates) - scoreTitle(a.title, titleCandidates));

  // Prefer explicit series links.
  const preferred =
    all.find(x => /\/series\//i.test(x.href)) ||
    all.find(x => !/\/episode\//i.test(x.href)) ||
    all[0];

  return await resolveSeriesPage(preferred.href);
}

function extractEpisodeNumber($, el) {
  const explicit = $(el).find("div.episodeNum span:last-child").first().text().trim();
  const n1 = parseInt(explicit, 10);
  if (Number.isFinite(n1)) return n1;

  const text = ($(el).find("div.title").text() || $(el).text() || "").trim();
  const m =
    text.match(/(?:الحلقة|حلقة)\s*(\d+)/i) ||
    text.match(/episode\s*(\d+)/i) ||
    text.match(/\bep(?:isode)?[\s._-]*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : NaN;
}

async function findEpisodePage(seriesUrl, episodeNumber) {
  const html = await fetchText(seriesUrl, BASE_URL + "/");
  const $ = cheerio.load(html);

  let exact = "";
  let fallback = "";

  $("article.postEp").each((_, el) => {
    const href = absUrl($(el).find("a").first().attr("href"), seriesUrl);
    if (!href) return;
    if (!fallback) fallback = href;

    const n = extractEpisodeNumber($, el);
    if (n === Number(episodeNumber)) exact = href;
  });

  if (exact) return exact;

  // Fallback for layouts that don't use article.postEp.
  $("a[href*='/episode/']").each((_, el) => {
    if (exact) return;
    const href = absUrl($(el).attr("href"), seriesUrl);
    const text = ($(el).attr("title") || $(el).text() || "").trim();
    const m = text.match(/(?:الحلقة|حلقة)\s*(\d+)/i) || text.match(/episode\s*(\d+)/i);
    if (m && parseInt(m[1], 10) === Number(episodeNumber)) exact = href;
  });

  return exact || "";
}

function directMediaUrl(url) {
  return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(String(url || ""));
}

function qualityFromUrl(url) {
  const s = String(url || "").toLowerCase();
  if (/2160|4k/.test(s)) return "4K";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Unknown";
}

function unpackPacker(source) {
  try {
    const m = source.match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:d|r)\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(\s*['"]\|['"]\s*\)/
    );
    if (!m) return "";

    let payload = m[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const words = m[6].split("|");
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    function encode(num, base) {
      if (num === 0) return "0";
      let out = "";
      while (num > 0) {
        out = chars[num % base] + out;
        num = Math.floor(num / base);
      }
      return out;
    }

    for (let i = count - 1; i >= 0; i--) {
      if (!words[i]) continue;
      const token = encode(i, radix);
      payload = payload.replace(new RegExp("\\b" + token + "\\b", "g"), words[i]);
    }
    return payload;
  } catch (_) {
    return "";
  }
}

function urlsFromHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = [];

  const push = (u, ref) => {
    const abs = absUrl(u, pageUrl);
    if (!abs) return;
    if (!/^https?:\/\//i.test(abs)) return;
    if (!out.some(x => x.url === abs)) out.push({ url: abs, referer: ref || pageUrl });
  };

  $("video[src], source[src], iframe[src]").each((_, el) => push($(el).attr("src"), pageUrl));
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && (directMediaUrl(href) || /embed|player|watch|stream/i.test(href))) {
      push(href, pageUrl);
    }
  });

  const patterns = [
    /(?:file|src)\s*[:=]\s*["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi,
    /["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) push(m[1].replace(/\\\//g, "/"), pageUrl);
  }

  const unpacked = unpackPacker(html);
  if (unpacked) {
    let m;
    const re = /(?:file|src)\s*:\s*["']([^"']+)["']/gi;
    while ((m = re.exec(unpacked)) !== null) push(m[1].replace(/\\\//g, "/"), pageUrl);
  }

  return out;
}

async function extractEpisodeStreams(episodeUrl) {
  const episodeHtml = await fetchText(episodeUrl, BASE_URL + "/");
  const $ep = cheerio.load(episodeHtml);

  let extractorUrl = absUrl($ep("a.fullscreen-clickable").first().attr("href"), episodeUrl);

  // Some layouts may expose a direct iframe instead.
  if (!extractorUrl) {
    extractorUrl = absUrl(
      $ep("iframe[src]").first().attr("src") ||
      $ep("video[src]").first().attr("src") ||
      $ep("source[src]").first().attr("src"),
      episodeUrl
    );
  }

  if (!extractorUrl) {
    console.log("[Krmizi] No fullscreen/player URL found on episode page");
    return [];
  }

  if (directMediaUrl(extractorUrl)) {
    return [{
      name: "Krmizi",
      title: "Krmizi",
      url: extractorUrl,
      quality: qualityFromUrl(extractorUrl),
      headers: { "Referer": episodeUrl, "User-Agent": UA }
    }];
  }

  const extractorHtml = await fetchText(extractorUrl, episodeUrl);
  const $ = cheerio.load(extractorHtml);

  const candidates = [];
  const add = (u, ref) => {
    const abs = absUrl(u, extractorUrl);
    if (!abs) return;
    if (!candidates.some(x => x.url === abs)) candidates.push({ url: abs, referer: ref || extractorUrl });
  };

  // Old Krmizi player structure.
  $("ul.serversList li").each((_, li) => {
    const el = $(li);
    [
      el.attr("data-url"),
      el.attr("data-src"),
      el.attr("data-link"),
      el.attr("data-embed"),
      el.find("a[href]").first().attr("href"),
      el.find("iframe[src]").first().attr("src"),
      el.find("code a[href]").first().attr("href")
    ].forEach(u => add(u, extractorUrl));

    const code = el.find("code").text().trim();
    if (/^https?:\/\//i.test(code) || code.startsWith("//")) add(code, extractorUrl);

    const onclick = el.attr("onclick") || "";
    const quoted = onclick.match(/['"]((?:https?:)?\/\/[^'"]+)['"]/);
    if (quoted) add(quoted[1], extractorUrl);
  });

  // Also inspect player page itself.
  urlsFromHtml(extractorHtml, extractorUrl).forEach(x => add(x.url, x.referer));

  const streams = [];
  const seen = new Set();

  const addStream = (u, ref, label) => {
    if (!u || seen.has(u) || !directMediaUrl(u)) return;
    seen.add(u);
    streams.push({
      name: "Krmizi",
      title: label || `Krmizi ${qualityFromUrl(u)}`,
      url: u,
      quality: qualityFromUrl(u),
      headers: {
        "Referer": ref || extractorUrl,
        "User-Agent": UA
      }
    });
  };

  for (const c of candidates.slice(0, 12)) {
    if (directMediaUrl(c.url)) {
      addStream(c.url, c.referer);
      continue;
    }

    // Only inspect http(s) player/embed pages; one additional iframe level is enough.
    try {
      const html = await fetchText(c.url, c.referer || extractorUrl);
      const firstLevel = urlsFromHtml(html, c.url);

      for (const x of firstLevel) {
        if (directMediaUrl(x.url)) {
          addStream(x.url, x.referer);
        } else if (/embed|player|watch|stream/i.test(x.url)) {
          try {
            const nested = await fetchText(x.url, x.referer || c.url);
            urlsFromHtml(nested, x.url).forEach(y => addStream(y.url, y.referer));
          } catch (_) {}
        }
      }
    } catch (e) {
      console.log(`[Krmizi] Server failed ${c.url}: ${e.message}`);
    }
  }

  return streams;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType !== "tv") return [];
    if (!episode) return [];

    console.log(`[Krmizi] Request TMDB=${tmdbId} S${season || 1}E${episode}`);

    const titleCandidates = [];
    for (const lang of ["ar-SA", "tr-TR", "en-US"]) {
      const t = await getTmdbTitle(tmdbId, lang);
      if (t && !titleCandidates.includes(t)) titleCandidates.push(t);
    }

    if (!titleCandidates.length) {
      console.log("[Krmizi] Could not resolve TMDB title");
      return [];
    }

    console.log(`[Krmizi] Titles: ${titleCandidates.join(" | ")}`);

    const seriesUrl = await findSeriesPage(titleCandidates);
    if (!seriesUrl) {
      console.log("[Krmizi] Series not found");
      return [];
    }

    const episodeUrl = await findEpisodePage(seriesUrl, episode);
    if (!episodeUrl) {
      console.log(`[Krmizi] Episode ${episode} not found`);
      return [];
    }

    return await extractEpisodeStreams(episodeUrl);
  } catch (e) {
    console.error(`[Krmizi] ${e && e.message ? e.message : e}`);
    return [];
  }
}

module.exports = { getStreams };
