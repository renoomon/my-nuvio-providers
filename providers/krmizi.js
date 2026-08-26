/**
 * Krmizi / Qrmzi provider for Nuvio
 * Version: 0.4.0
 *
 * Current targets:
 *   https://www.qrmzi.tv
 *   https://qeseh.krmizitv.com
 *
 * Runtime-safe for Nuvio QuickJS/Hermes:
 * - Promise chains only (no async/await)
 * - no URL() constructor
 * - ES5-style functions/var where practical
 *
 * Public pages/embeds only. No DRM bypass.
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var MAIN = "https://www.qrmzi.tv";
var VIDEO = "https://qeseh.krmizitv.com";
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
  return m ? m[1] : "";
}

function absUrl(url, base) {
  if (!url) return "";
  var s = String(url)
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  if (!s || /^javascript:/i.test(s) || s.charAt(0) === "#") return "";
  if (s.indexOf("//") === 0) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;

  var b = base || MAIN;
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

function fetchJson(url, referer) {
  return fetch(url, {
    headers: makeHeaders(referer),
    skipSizeCheck: true
  }).then(function (res) {
    if (!res || !res.ok) {
      throw new Error("HTTP " + (res ? res.status : "?") + " " + url);
    }
    return res.json();
  });
}

function isChallenge(html) {
  var s = String(html || "").toLowerCase();
  return s.indexOf("cf-chl-") >= 0 ||
    s.indexOf("challenge-platform") >= 0 ||
    s.indexOf("just a moment") >= 0 ||
    s.indexOf("checking your browser") >= 0;
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[إأآٱا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asciiTurkish(s) {
  return String(s || "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c");
}

function cleanTitle(s) {
  return String(s || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*-\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function episodeNumber(text) {
  var s = String(text || "");
  var m = s.match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*[:\-]?\s*(\d+)/i);
  if (!m) m = s.match(/episode\s*[:\-]?\s*(\d+)/i);
  if (!m) m = s.match(/\bep(?:isode)?[\s._-]*(\d+)\b/i);
  if (!m) m = s.match(/(?:^|[-_\/])ep(\d+)(?:$|[-_\/.?])/i);
  return m ? parseInt(m[1], 10) : NaN;
}

function titleCompatible(text, candidates) {
  var t = normalize(text);
  if (!t) return false;

  for (var i = 0; i < candidates.length; i++) {
    var q = normalize(candidates[i]);
    if (!q) continue;
    if (t === q || t.indexOf(q) >= 0 || q.indexOf(t) >= 0) return true;

    var words = q.split(" ");
    var hits = 0;
    var useful = 0;
    for (var w = 0; w < words.length; w++) {
      if (words[w].length < 3) continue;
      useful++;
      if (t.indexOf(words[w]) >= 0) hits++;
    }
    if (useful > 0 && hits / useful >= 0.7) return true;
  }
  return false;
}

function tmdbTitle(tmdbId, lang) {
  var url = "https://www.themoviedb.org/tv/" + encodeURIComponent(tmdbId) + "?language=" + encodeURIComponent(lang);
  return fetchText(url, "").then(function (html) {
    var $ = cheerio.load(html);
    return cleanTitle(
      $('meta[property="og:title"]').attr("content") ||
      $("section.inner_content h2 a").first().text() ||
      $("h2 a").first().text() ||
      $("title").text()
    );
  }).catch(function (e) {
    console.log("[Krmizi] TMDB " + lang + " failed: " + e.message);
    return "";
  });
}

function getTitleCandidates(tmdbId) {
  var langs = ["tr-TR", "ar-SA", "en-US"];
  var out = [];

  function next(i) {
    if (i >= langs.length) {
      var extra = [];
      for (var x = 0; x < out.length; x++) {
        var ascii = asciiTurkish(out[x]);
        if (ascii && ascii !== out[x] && extra.indexOf(ascii) < 0) extra.push(ascii);
      }
      return Promise.resolve(out.concat(extra));
    }

    return tmdbTitle(tmdbId, langs[i]).then(function (t) {
      if (t && out.indexOf(t) < 0) out.push(t);
      return next(i + 1);
    });
  }

  return next(0);
}

function parseVideoEntries(html, base) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function add(href, text) {
    var u = absUrl(href, base);
    if (!u || seen[u] || u.indexOf("/video/") < 0) return;
    seen[u] = true;
    out.push({
      href: u,
      text: String(text || "").replace(/\s+/g, " ").trim(),
      episode: episodeNumber(String(text || "") + " " + u)
    });
  }

  $("article, .post, .item, .video-item, .blog-post").each(function (_, el) {
    var node = $(el);
    var a = node.find('a[href*="/video/"]').first();
    if (a.length) add(a.attr("href"), node.text() + " " + (a.attr("title") || ""));
  });

  $('a[href*="/video/"]').each(function (_, el) {
    var a = $(el);
    add(a.attr("href"), (a.attr("title") || "") + " " + a.text());
  });

  return out;
}

function searchQeseh(query) {
  var url = VIDEO + "/?s=" + encodeURIComponent(query);
  return fetchText(url, VIDEO + "/").then(function (html) {
    if (isChallenge(html)) throw new Error("challenge");
    return parseVideoEntries(html, url);
  }).catch(function (e) {
    console.log('[Krmizi] qeseh search "' + query + '" failed: ' + e.message);
    return [];
  });
}

function inspectVideoPage(entry, candidates, wantedEpisode) {
  return fetchText(entry.href, VIDEO + "/").then(function (html) {
    if (isChallenge(html)) return null;

    var $ = cheerio.load(html);
    var text = [
      $("title").text(),
      $("h1").first().text(),
      $("article").first().text(),
      $("body").text(),
      entry.text,
      entry.href
    ].join(" ");

    var ep = episodeNumber(text);
    var sameEpisode = Number(ep) === Number(wantedEpisode);
    var sameTitle = titleCompatible(text, candidates);

    if (sameEpisode && sameTitle) return entry.href;

    // If the search query already returned this page and the episode is exact,
    // accept it even when the Arabic title differs from TMDB's English title.
    if (sameEpisode && entry.searchHit) return entry.href;

    return null;
  }).catch(function () {
    return null;
  });
}

function findOnQeseh(candidates, wantedEpisode) {
  var queryIndex = 0;

  function tryQuery() {
    if (queryIndex >= candidates.length) return Promise.resolve("");

    var q = candidates[queryIndex++];
    return searchQeseh(q).then(function (entries) {
      var exact = [];
      var others = [];

      for (var i = 0; i < entries.length; i++) {
        entries[i].searchHit = true;
        if (Number(entries[i].episode) === Number(wantedEpisode)) exact.push(entries[i]);
        else others.push(entries[i]);
      }

      var queue = exact.concat(others.slice(0, 8));

      function inspectAt(idx) {
        if (idx >= queue.length) return Promise.resolve("");
        return inspectVideoPage(queue[idx], candidates, wantedEpisode).then(function (hit) {
          if (hit) return hit;
          return inspectAt(idx + 1);
        });
      }

      return inspectAt(0).then(function (hit) {
        if (hit) return hit;
        return tryQuery();
      });
    });
  }

  return tryQuery();
}

function parseMainEpisodeEntries(html, base) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function add(href, text) {
    var u = absUrl(href, base);
    if (!u || seen[u] || u.indexOf("/episode/") < 0) return;
    seen[u] = true;
    out.push({
      href: u,
      text: String(text || "").replace(/\s+/g, " ").trim(),
      episode: episodeNumber(String(text || "") + " " + u)
    });
  }

  $("article, .post, .item, .block-post, .postEp").each(function (_, el) {
    var node = $(el);
    var a = node.find('a[href*="/episode/"]').first();
    if (a.length) add(a.attr("href"), node.text() + " " + (a.attr("title") || ""));
  });

  $('a[href*="/episode/"]').each(function (_, el) {
    var a = $(el);
    add(a.attr("href"), (a.attr("title") || "") + " " + a.text());
  });

  return out;
}

function searchMain(query) {
  var url = MAIN + "/?s=" + encodeURIComponent(query);
  return fetchText(url, MAIN + "/").then(function (html) {
    if (isChallenge(html)) throw new Error("challenge");
    return parseMainEpisodeEntries(html, url);
  }).catch(function (e) {
    console.log('[Krmizi] main search "' + query + '" failed: ' + e.message);
    return [];
  });
}

function findOnMain(candidates, wantedEpisode) {
  var qi = 0;

  function nextQuery() {
    if (qi >= candidates.length) return Promise.resolve("");
    var q = candidates[qi++];

    return searchMain(q).then(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (Number(entries[i].episode) === Number(wantedEpisode)) {
          return entries[i].href;
        }
      }
      return nextQuery();
    });
  }

  return nextQuery();
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
    var m = String(source || "").match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*(?:d|r)\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(\s*['"]\|['"]\s*\)/
    );
    if (!m) return "";

    var payload = m[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    var radix = parseInt(m[3], 10);
    var count = parseInt(m[4], 10);
    var words = m[6].split("|");
    var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    function enc(num, base) {
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
      var token = enc(i, radix);
      payload = payload.replace(new RegExp("\\b" + token + "\\b", "g"), words[i]);
    }
    return payload;
  } catch (_) {
    return "";
  }
}

function safeAtob(s) {
  try {
    if (typeof atob === "function") return atob(s);
  } catch (_) {}
  return "";
}

function collectLinks(html, pageUrl) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function add(u, referer, force) {
    var x = absUrl(u, pageUrl);
    if (!x || !/^https?:\/\//i.test(x) || seen[x]) return;

    var interesting = directMedia(x) ||
      /\/embed\/|player|watch|stream|video|m3u8|mp4/i.test(x) ||
      /qeseh|krmizitv|qrmzi|qesen|newaat|dailymotion|dai\.ly|vidmoly|voe|streamtape/i.test(x);

    if (!interesting && !force) return;
    seen[x] = true;
    out.push({ url: x, referer: referer || pageUrl });
  }

  $("video[src], source[src], iframe[src]").each(function (_, el) {
    add($(el).attr("src"), pageUrl, true);
  });

  $('meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]').each(function (_, el) {
    add($(el).attr("content"), pageUrl, true);
  });

  $("[data-url], [data-src], [data-link], [data-embed]").each(function (_, el) {
    var node = $(el);
    add(node.attr("data-url"), pageUrl, true);
    add(node.attr("data-src"), pageUrl, true);
    add(node.attr("data-link"), pageUrl, true);
    add(node.attr("data-embed"), pageUrl, true);
  });

  $("a[href], code a[href]").each(function (_, el) {
    add($(el).attr("href"), pageUrl, false);
  });

  $("*[onclick]").each(function (_, el) {
    var s = $(el).attr("onclick") || "";
    var mm = s.match(/['"]((?:https?:)?\/\/[^'"]+)['"]/);
    if (mm) add(mm[1], pageUrl, true);

    var b64 = s.match(/(?:showVideo|atob)\s*\(\s*['"]([A-Za-z0-9+/=]{12,})['"]/i);
    if (b64) {
      var decoded = safeAtob(b64[1]);
      if (decoded) add(decoded, pageUrl, true);
    }
  });

  var normalizedHtml = String(html || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  var patterns = [
    /(?:file|src|source|hls|playlist)\s*[:=]\s*["'](https?:[^"']+)["']/gi,
    /["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi
  ];

  for (var p = 0; p < patterns.length; p++) {
    var re = patterns[p], m;
    while ((m = re.exec(normalizedHtml)) !== null) {
      add(m[1], pageUrl, true);
    }
  }

  var unpacked = unpackPacker(normalizedHtml);
  if (unpacked) {
    var re2 = /(?:file|src|source|hls|playlist)\s*[:=]\s*["']([^"']+)["']/gi;
    var m2;
    while ((m2 = re2.exec(unpacked)) !== null) {
      add(m2[1], pageUrl, true);
    }

    var re3 = /https?:\/\/[^"'\\\s<>]+/gi;
    var m3;
    while ((m3 = re3.exec(unpacked)) !== null) {
      add(m3[0], pageUrl, false);
    }
  }

  return out;
}

function streamObject(url, referer, label) {
  var h = {
    "User-Agent": UA
  };
  if (referer) {
    h["Referer"] = referer;
    var o = originOf(referer);
    if (o) h["Origin"] = o;
  }

  return {
    name: "Krmizi",
    title: label || ("Krmizi " + qualityFromUrl(url)),
    url: url,
    quality: qualityFromUrl(url),
    type: /\.m3u8(?:[?#]|$)/i.test(url) ? "m3u8" : "mp4",
    language: "ar",
    headers: h
  };
}

function dailymotionId(url) {
  var s = String(url || "");
  var m = s.match(/dailymotion\.com\/(?:embed\/)?video\/([A-Za-z0-9]+)/i);
  if (!m) m = s.match(/dai\.ly\/([A-Za-z0-9]+)/i);
  return m ? m[1] : "";
}

function resolveDailymotion(url, referer, streams, seenStreams) {
  var id = dailymotionId(url);
  if (!id) return Promise.resolve();

  var metaUrl = "https://www.dailymotion.com/player/metadata/video/" + id;
  return fetchJson(metaUrl, referer).then(function (data) {
    function add(u, label) {
      if (!u || seenStreams[u]) return;
      if (!/^https?:\/\//i.test(u)) return;
      seenStreams[u] = true;
      streams.push(streamObject(u, referer, label || "Krmizi Dailymotion"));
    }

    if (data) {
      add(data.stream_hls_url, "Krmizi Dailymotion HLS");
      add(data.stream_url, "Krmizi Dailymotion");

      var qualities = data.qualities || {};
      var keys = Object.keys(qualities);
      for (var i = 0; i < keys.length; i++) {
        var arr = qualities[keys[i]];
        if (!arr || !arr.length) continue;
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] && arr[j].url) add(arr[j].url, "Krmizi Dailymotion " + keys[i]);
        }
      }
    }
  }).catch(function () {});
}

function walkPlayer(url, referer, depth, streams, visited, seenStreams) {
  if (!url || depth > 3 || visited[url]) return Promise.resolve();
  visited[url] = true;

  if (directMedia(url)) {
    if (!seenStreams[url]) {
      seenStreams[url] = true;
      streams.push(streamObject(url, referer));
    }
    return Promise.resolve();
  }

  if (/dailymotion\.com|dai\.ly/i.test(url)) {
    return resolveDailymotion(url, referer, streams, seenStreams);
  }

  return fetchText(url, referer).then(function (html) {
    if (isChallenge(html)) {
      console.log("[Krmizi] challenge on " + url);
      return;
    }

    var links = collectLinks(html, url);

    function next(i) {
      if (i >= links.length || i >= 20) return Promise.resolve();
      var item = links[i];

      if (directMedia(item.url)) {
        if (!seenStreams[item.url]) {
          seenStreams[item.url] = true;
          streams.push(streamObject(item.url, item.referer));
        }
        return next(i + 1);
      }

      return walkPlayer(item.url, item.referer, depth + 1, streams, visited, seenStreams)
        .then(function () { return next(i + 1); })
        .catch(function () { return next(i + 1); });
    }

    return next(0);
  }).catch(function (e) {
    console.log("[Krmizi] player fetch failed " + url + ": " + e.message);
  });
}

function extractFromVideoPage(videoPageUrl) {
  var streams = [];
  var visited = {};
  var seenStreams = {};

  return walkPlayer(videoPageUrl, VIDEO + "/", 0, streams, visited, seenStreams)
    .then(function () { return streams; });
}

function extractFromMainEpisode(mainEpisodeUrl) {
  return fetchText(mainEpisodeUrl, MAIN + "/").then(function (html) {
    var links = collectLinks(html, mainEpisodeUrl);
    var preferred = "";

    for (var i = 0; i < links.length; i++) {
      if (/qeseh\.krmizitv\.com/i.test(links[i].url)) {
        preferred = links[i].url;
        break;
      }
    }

    if (!preferred && links.length) preferred = links[0].url;
    if (!preferred) return [];

    var streams = [];
    var visited = {};
    var seenStreams = {};
    return walkPlayer(preferred, mainEpisodeUrl, 0, streams, visited, seenStreams)
      .then(function () { return streams; });
  }).catch(function () {
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = String(mediaType || "").toLowerCase();
  if (type !== "tv" && type !== "series" && type !== "show") return Promise.resolve([]);
  if (!episode) return Promise.resolve([]);

  console.log("[Krmizi] request TMDB=" + tmdbId + " S" + (season || 1) + "E" + episode);

  var candidates = [];

  return getTitleCandidates(tmdbId)
    .then(function (titles) {
      candidates = titles || [];
      console.log("[Krmizi] title candidates: " + candidates.join(" | "));
      if (!candidates.length) return "";

      // Primary route: qeseh.krmizitv.com — this is where current video posts/embeds live.
      return findOnQeseh(candidates, episode);
    })
    .then(function (qesehPage) {
      if (qesehPage) {
        console.log("[Krmizi] qeseh video page: " + qesehPage);
        return extractFromVideoPage(qesehPage);
      }

      // Fallback route: qrmzi.tv main site.
      return findOnMain(candidates, episode).then(function (mainEpisode) {
        if (!mainEpisode) return [];
        console.log("[Krmizi] qrmzi episode page: " + mainEpisode);
        return extractFromMainEpisode(mainEpisode);
      });
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[Krmizi] streams found: " + streams.length);
      return streams;
    })
    .catch(function (e) {
      console.error("[Krmizi] fatal: " + (e && e.message ? e.message : e));
      return [];
    });
}

module.exports = { getStreams: getStreams };
