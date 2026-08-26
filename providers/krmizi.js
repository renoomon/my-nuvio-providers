/**
 * Krmizi provider for Nuvio v0.2.0
 * Target: https://krmizi.onl/
 *
 * QuickJS/Hermes-safe:
 * - Promise chains only (no async/await)
 * - no URL() constructor
 * - public page parsing only
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE_URL = "https://krmizi.onl";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function makeHeaders(referer) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7,tr;q=0.6"
  };
  if (referer) h["Referer"] = referer;
  return h;
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : BASE_URL;
}

function absUrl(url, base) {
  if (!url) return "";
  var s = String(url).trim().replace(/&amp;/g, "&");
  if (!s || /^javascript:/i.test(s) || s.charAt(0) === "#") return "";
  if (s.indexOf("//") === 0) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;

  var b = base || BASE_URL;
  var origin = originOf(b);

  if (s.charAt(0) === "/") return origin + s;

  var clean = b.split("#")[0].split("?")[0];
  if (clean.charAt(clean.length - 1) !== "/") {
    clean = clean.substring(0, clean.lastIndexOf("/") + 1);
  }
  return clean + s;
}

function fetchText(url, referer) {
  return fetch(url, {
    headers: makeHeaders(referer),
    skipSizeCheck: true
  }).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    }
    return res.text();
  });
}

function looksLikeChallenge(html) {
  var s = String(html || "").toLowerCase();
  return s.indexOf("cf-chl-") >= 0 ||
         s.indexOf("challenge-platform") >= 0 ||
         s.indexOf("just a moment") >= 0 ||
         s.indexOf("checking your browser") >= 0;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[إأآٱا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF\u00C0-\u024F]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEpisodeWords(s) {
  return normalizeText(s)
    .replace(/\bمسلسل\b/g, " ")
    .replace(/\bالحلقه\b/g, " ")
    .replace(/\bحلقه\b/g, " ")
    .replace(/\bمترجم\w*\b/g, " ")
    .replace(/\bمدبلج\w*\b/g, " ")
    .replace(/\bالموسم\b/g, " ")
    .replace(/\bseason\b/g, " ")
    .replace(/\bepisode\b/g, " ")
    .replace(/\bep\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTmdbTitle(s) {
  return String(s || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*-\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .trim();
}

function getTmdbTitle(tmdbId, language) {
  var url = "https://www.themoviedb.org/tv/" + encodeURIComponent(tmdbId) + "?language=" + encodeURIComponent(language);
  return fetchText(url, "").then(function (html) {
    var $ = cheerio.load(html);
    return cleanTmdbTitle(
      $('meta[property="og:title"]').attr("content") ||
      $("section.inner_content h2 a").first().text() ||
      $("title").text()
    );
  }).catch(function (e) {
    console.log("[Krmizi] TMDB " + language + " failed: " + e.message);
    return "";
  });
}

function getTitleCandidates(tmdbId) {
  var langs = ["ar-SA", "tr-TR", "en-US"];
  var out = [];

  function next(i) {
    if (i >= langs.length) return Promise.resolve(out);
    return getTmdbTitle(tmdbId, langs[i]).then(function (t) {
      if (t && out.indexOf(t) < 0) out.push(t);
      return next(i + 1);
    });
  }

  return next(0);
}

function titleMatches(text, candidates) {
  var raw = normalizeText(text);
  var stripped = stripEpisodeWords(text);

  for (var i = 0; i < candidates.length; i++) {
    var qRaw = normalizeText(candidates[i]);
    var q = stripEpisodeWords(candidates[i]);

    if (!qRaw && !q) continue;
    if (qRaw && (raw === qRaw || raw.indexOf(qRaw) >= 0 || qRaw.indexOf(raw) >= 0)) return true;
    if (q && (stripped === q || stripped.indexOf(q) >= 0 || q.indexOf(stripped) >= 0)) return true;

    var words = q.split(" ");
    var hits = 0;
    var useful = 0;
    for (var w = 0; w < words.length; w++) {
      if (words[w].length < 3) continue;
      useful++;
      if (stripped.indexOf(words[w]) >= 0) hits++;
    }
    if (useful > 0 && hits / useful >= 0.7) return true;
  }
  return false;
}

function extractEpisodeNumber(text) {
  var s = String(text || "");
  var m = s.match(/(?:الحلقة|حلقه|حلقة)\s*[:\-]?\s*(\d+)/i);
  if (!m) m = s.match(/episode\s*[:\-]?\s*(\d+)/i);
  if (!m) m = s.match(/\bep(?:isode)?[\s._-]*(\d+)\b/i);
  return m ? parseInt(m[1], 10) : NaN;
}

function parseItems(html, pageUrl) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function pushItem(el) {
    var a = $(el).find("a[href]").first();
    if (!a.length && $(el).is("a")) a = $(el);
    var href = absUrl(a.attr("href"), pageUrl);
    if (!href || seen[href]) return;

    var text =
      a.find("div.title").first().text().trim() ||
      $(el).find("div.title").first().text().trim() ||
      a.attr("title") ||
      a.text().trim() ||
      $(el).text().trim();

    if (!text) return;
    seen[href] = true;
    out.push({
      href: href,
      text: text,
      episode: extractEpisodeNumber(text)
    });
  }

  $("article.postEp, div.block-post, .postEp").each(function (_, el) {
    pushItem(el);
  });

  if (!out.length) {
    $("a[href*='/episode/'], a[href*='/series/']").each(function (_, el) {
      pushItem(el);
    });
  }

  return out;
}

function searchNative(query) {
  if (!query) return Promise.resolve([]);
  var url = BASE_URL + "/?s=" + encodeURIComponent(query);

  return fetchText(url, BASE_URL + "/").then(function (html) {
    if (looksLikeChallenge(html)) throw new Error("Cloudflare challenge");
    return parseItems(html, url);
  }).catch(function (e) {
    console.log("[Krmizi] native search failed: " + e.message);
    return [];
  });
}

function pickMatch(items, candidates, episodeNum) {
  var sameSeries = null;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!titleMatches(item.text, candidates)) continue;

    if (Number(item.episode) === Number(episodeNum)) {
      return { exact: item, seed: item };
    }
    if (!sameSeries) sameSeries = item;
  }

  return { exact: null, seed: sameSeries };
}

function crawlLatest(candidates, episodeNum, maxPages) {
  var seed = null;

  function next(page) {
    if (page > maxPages) return Promise.resolve({ exact: null, seed: seed });

    var url = page === 1 ? BASE_URL + "/" : BASE_URL + "/page/" + page + "/";
    return fetchText(url, BASE_URL + "/").then(function (html) {
      if (looksLikeChallenge(html)) throw new Error("Cloudflare challenge");
      var items = parseItems(html, url);
      var picked = pickMatch(items, candidates, episodeNum);

      if (picked.exact) return picked;
      if (!seed && picked.seed) seed = picked.seed;

      if (!items.length) return { exact: null, seed: seed };
      return next(page + 1);
    }).catch(function (e) {
      console.log("[Krmizi] latest page " + page + " failed: " + e.message);
      return { exact: null, seed: seed };
    });
  }

  return next(1);
}

function crawlSeriesList(candidates, maxPages) {
  var found = null;

  function next(page) {
    if (page > maxPages || found) return Promise.resolve(found);

    var url = BASE_URL + "/series-list/page/" + page + "/";
    return fetchText(url, BASE_URL + "/").then(function (html) {
      if (looksLikeChallenge(html)) throw new Error("Cloudflare challenge");
      var items = parseItems(html, url);

      for (var i = 0; i < items.length; i++) {
        if (titleMatches(items[i].text, candidates)) {
          found = items[i];
          break;
        }
      }

      if (found || !items.length) return found;
      return next(page + 1);
    }).catch(function (e) {
      console.log("[Krmizi] series-list page " + page + " failed: " + e.message);
      return found;
    });
  }

  return next(1);
}

function resolveSeriesPage(seedUrl) {
  if (!seedUrl) return Promise.resolve("");

  return fetchText(seedUrl, BASE_URL + "/").then(function (html) {
    var $ = cheerio.load(html);
    var href =
      $("div.singleSeries div.info h1 a[href]").first().attr("href") ||
      $(".singleSeries .info h1 a[href]").first().attr("href") ||
      $(".single-series .info h1 a[href]").first().attr("href");

    if (href) return absUrl(href, seedUrl);
    if (/\/series\//i.test(seedUrl)) return seedUrl;
    return "";
  }).catch(function () {
    return /\/series\//i.test(seedUrl) ? seedUrl : "";
  });
}

function findEpisodeOnSeries(seriesUrl, episodeNum) {
  if (!seriesUrl) return Promise.resolve("");

  return fetchText(seriesUrl, BASE_URL + "/").then(function (html) {
    var $ = cheerio.load(html);
    var exact = "";

    $("article.postEp, .postEp, a[href*='/episode/']").each(function (_, el) {
      if (exact) return;

      var node = $(el);
      var a = node.is("a") ? node : node.find("a[href]").first();
      var href = absUrl(a.attr("href"), seriesUrl);
      if (!href) return;

      var explicit = node.find("div.episodeNum span:last-child").first().text().trim();
      var n = parseInt(explicit, 10);
      if (!isFinite(n)) {
        n = extractEpisodeNumber(
          node.find("div.title").first().text() ||
          a.attr("title") ||
          node.text()
        );
      }

      if (Number(n) === Number(episodeNum)) exact = href;
    });

    return exact;
  }).catch(function (e) {
    console.log("[Krmizi] series episode lookup failed: " + e.message);
    return "";
  });
}

function directMedia(url) {
  return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(String(url || ""));
}

function qualityFromUrl(url) {
  var s = String(url || "").toLowerCase();
  if (/2160|4k/.test(s)) return "4K";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "Unknown";
}

function unpackPacker(source) {
  try {
    var m = source.match(/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:d|r)\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(\s*['"]\|['"]\s*\)/);
    if (!m) return "";

    var payload = m[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    var radix = parseInt(m[3], 10);
    var count = parseInt(m[4], 10);
    var words = m[6].split("|");
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    function encode(num, base) {
      if (num === 0) return "0";
      var out = "";
      while (num > 0) {
        out = chars[num % base] + out;
        num = Math.floor(num / base);
      }
      return out;
    }

    for (var i = count - 1; i >= 0; i--) {
      if (!words[i]) continue;
      var token = encode(i, radix);
      payload = payload.replace(new RegExp("\\b" + token + "\\b", "g"), words[i]);
    }
    return payload;
  } catch (_) {
    return "";
  }
}

function urlsFromHtml(html, pageUrl) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function push(u, ref) {
    var x = absUrl(u, pageUrl);
    if (!x || !/^https?:\/\//i.test(x) || seen[x]) return;
    seen[x] = true;
    out.push({ url: x, referer: ref || pageUrl });
  }

  $("video[src], source[src], iframe[src]").each(function (_, el) {
    push($(el).attr("src"), pageUrl);
  });

  $("a[href]").each(function (_, el) {
    var href = $(el).attr("href");
    if (href && (directMedia(href) || /embed|player|watch|stream/i.test(href))) {
      push(href, pageUrl);
    }
  });

  var patterns = [
    /(?:file|src)\s*[:=]\s*["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi,
    /["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi
  ];

  for (var p = 0; p < patterns.length; p++) {
    var re = patterns[p], mm;
    while ((mm = re.exec(html)) !== null) {
      push(mm[1].replace(/\\\//g, "/"), pageUrl);
    }
  }

  var unpacked = unpackPacker(html);
  if (unpacked) {
    var re2 = /(?:file|src)\s*:\s*["']([^"']+)["']/gi, m2;
    while ((m2 = re2.exec(unpacked)) !== null) {
      push(m2[1].replace(/\\\//g, "/"), pageUrl);
    }
  }

  return out;
}

function streamObject(url, referer, label) {
  return {
    name: "Krmizi",
    title: label || ("Krmizi " + qualityFromUrl(url)),
    url: url,
    quality: qualityFromUrl(url),
    type: /\.m3u8(?:[?#]|$)/i.test(url) ? "m3u8" : "mp4",
    headers: {
      "Referer": referer || BASE_URL + "/",
      "User-Agent": UA
    }
  };
}

function inspectCandidate(candidate, out, seen) {
  if (!candidate || !candidate.url) return Promise.resolve();

  if (directMedia(candidate.url)) {
    if (!seen[candidate.url]) {
      seen[candidate.url] = true;
      out.push(streamObject(candidate.url, candidate.referer));
    }
    return Promise.resolve();
  }

  return fetchText(candidate.url, candidate.referer).then(function (html) {
    var links = urlsFromHtml(html, candidate.url);

    function inspectNested(i) {
      if (i >= links.length) return Promise.resolve();
      var x = links[i];

      if (directMedia(x.url)) {
        if (!seen[x.url]) {
          seen[x.url] = true;
          out.push(streamObject(x.url, x.referer));
        }
        return inspectNested(i + 1);
      }

      if (i < 4 && /embed|player|watch|stream/i.test(x.url)) {
        return fetchText(x.url, x.referer).then(function (nestedHtml) {
          var nested = urlsFromHtml(nestedHtml, x.url);
          for (var n = 0; n < nested.length; n++) {
            if (directMedia(nested[n].url) && !seen[nested[n].url]) {
              seen[nested[n].url] = true;
              out.push(streamObject(nested[n].url, nested[n].referer));
            }
          }
          return inspectNested(i + 1);
        }).catch(function () {
          return inspectNested(i + 1);
        });
      }

      return inspectNested(i + 1);
    }

    return inspectNested(0);
  }).catch(function (e) {
    console.log("[Krmizi] server failed " + candidate.url + ": " + e.message);
  });
}

function extractEpisodeStreams(episodeUrl) {
  return fetchText(episodeUrl, BASE_URL + "/").then(function (episodeHtml) {
    var $ep = cheerio.load(episodeHtml);

    var playerUrl = absUrl(
      $ep("a.fullscreen-clickable[href]").first().attr("href") ||
      $ep("iframe[src]").first().attr("src") ||
      $ep("video[src]").first().attr("src") ||
      $ep("source[src]").first().attr("src"),
      episodeUrl
    );

    if (!playerUrl) {
      console.log("[Krmizi] no player URL on episode page");
      return [];
    }

    if (directMedia(playerUrl)) {
      return [streamObject(playerUrl, episodeUrl)];
    }

    return fetchText(playerUrl, episodeUrl).then(function (playerHtml) {
      var $ = cheerio.load(playerHtml);
      var candidates = [];
      var seenCandidates = {};

      function add(u, ref) {
        var x = absUrl(u, playerUrl);
        if (!x || !/^https?:\/\//i.test(x) || seenCandidates[x]) return;
        seenCandidates[x] = true;
        candidates.push({ url: x, referer: ref || playerUrl });
      }

      $("ul.serversList li, .serversList li, [data-server]").each(function (_, li) {
        var el = $(li);
        add(el.attr("data-url"), playerUrl);
        add(el.attr("data-src"), playerUrl);
        add(el.attr("data-link"), playerUrl);
        add(el.attr("data-embed"), playerUrl);
        add(el.find("a[href]").first().attr("href"), playerUrl);
        add(el.find("iframe[src]").first().attr("src"), playerUrl);
        add(el.find("code a[href]").first().attr("href"), playerUrl);

        var code = el.find("code").text().trim();
        if (/^(https?:)?\/\//i.test(code)) add(code, playerUrl);

        var onclick = el.attr("onclick") || "";
        var qm = onclick.match(/['"]((?:https?:)?\/\/[^'"]+)['"]/);
        if (qm) add(qm[1], playerUrl);
      });

      var pageUrls = urlsFromHtml(playerHtml, playerUrl);
      for (var j = 0; j < pageUrls.length; j++) {
        add(pageUrls[j].url, pageUrls[j].referer);
      }

      var streams = [];
      var seenStreams = {};

      function next(i) {
        if (i >= candidates.length || i >= 12) return Promise.resolve(streams);
        return inspectCandidate(candidates[i], streams, seenStreams).then(function () {
          return next(i + 1);
        });
      }

      return next(0);
    });
  }).catch(function (e) {
    console.log("[Krmizi] episode extraction failed: " + e.message);
    return [];
  });
}

function findEpisodeUrl(candidates, episodeNum) {
  var queryIndex = 0;
  var nativeSeed = null;

  function trySearches() {
    if (queryIndex >= candidates.length) {
      return crawlLatest(candidates, episodeNum, 12);
    }

    var q = candidates[queryIndex++];
    return searchNative(q).then(function (items) {
      var picked = pickMatch(items, candidates, episodeNum);
      if (picked.exact) return picked;
      if (!nativeSeed && picked.seed) nativeSeed = picked.seed;
      return trySearches();
    });
  }

  return trySearches().then(function (picked) {
    if (picked && picked.exact) return picked.exact.href;

    var seed = (picked && picked.seed) || nativeSeed;
    if (seed) {
      return resolveSeriesPage(seed.href).then(function (seriesUrl) {
        return findEpisodeOnSeries(seriesUrl, episodeNum);
      });
    }

    return crawlSeriesList(candidates, 8).then(function (seriesItem) {
      if (!seriesItem) return "";
      return resolveSeriesPage(seriesItem.href).then(function (seriesUrl) {
        return findEpisodeOnSeries(seriesUrl || seriesItem.href, episodeNum);
      });
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv" || !episode) return Promise.resolve([]);

  console.log("[Krmizi] request TMDB=" + tmdbId + " S" + (season || 1) + "E" + episode);

  return getTitleCandidates(tmdbId)
    .then(function (candidates) {
      console.log("[Krmizi] titles: " + candidates.join(" | "));
      if (!candidates.length) return "";

      return findEpisodeUrl(candidates, episode);
    })
    .then(function (episodeUrl) {
      if (!episodeUrl) {
        console.log("[Krmizi] episode not found");
        return [];
      }

      console.log("[Krmizi] episode URL: " + episodeUrl);
      return extractEpisodeStreams(episodeUrl);
    })
    .then(function (streams) {
      console.log("[Krmizi] streams found: " + streams.length);
      return streams;
    })
    .catch(function (e) {
      console.error("[Krmizi] fatal: " + (e && e.message ? e.message : e));
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  globalThis.getStreams = getStreams;
}
