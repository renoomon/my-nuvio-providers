/**
 * Krmizi / Qrmzi provider for Nuvio
 * Version: 0.6.0
 *
 * Strategy:
 * TMDB -> strict series resolution on qrmzi.tv -> exact episode link
 * -> primary episode iframe only -> exact player/server embeds only.
 *
 * This intentionally NEVER crawls "related" episode links.
 * Promise chains only for Hermes/QuickJS compatibility.
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var BASES = ["https://www.qrmzi.tv", "https://krmizi.onl"];
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(referer) {
  var h = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.8,en;q=0.7,tr;q=0.6"
  };
  if (referer) h["Referer"] = referer;
  return h;
}

function fetchText(url, referer) {
  return fetch(url, { headers: headers(referer), skipSizeCheck: true })
    .then(function (r) {
      if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?") + " " + url);
      return r.text();
    });
}

function fetchJson(url, referer) {
  return fetch(url, { headers: headers(referer), skipSizeCheck: true })
    .then(function (r) {
      if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?") + " " + url);
      return r.json();
    });
}

function originOf(url) {
  var m = String(url || "").match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : "";
}

function absUrl(url, base) {
  if (!url) return "";
  var s = String(url).trim()
    .replace(/&amp;/g, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  if (!s || /^javascript:/i.test(s) || s.charAt(0) === "#") return "";
  if (s.indexOf("//") === 0) return "https:" + s;
  if (/^https?:\/\//i.test(s)) return s;

  var origin = originOf(base || BASES[0]);
  if (s.charAt(0) === "/") return origin + s;

  var clean = String(base || BASES[0]).split("#")[0].split("?")[0];
  if (clean.charAt(clean.length - 1) !== "/") clean = clean.substring(0, clean.lastIndexOf("/") + 1);
  return clean + s;
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[إأآٱا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTmdbTitle(s) {
  return String(s || "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/\s*-\s*The Movie Database.*$/i, "")
    .replace(/\s*\|\s*TMDB.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function episodeNumber(s) {
  var text = String(s || "");
  var m = text.match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*[:\-]?\s*(\d+)/i);
  if (!m) m = text.match(/\bS\d{1,2}E(\d{1,3})\b/i);
  if (!m) m = text.match(/\bep(?:isode)?[\s._-]*(\d+)\b/i);
  if (!m) m = text.match(/[-_\/]e(\d{1,3})(?:[\/?._-]|$)/i);
  return m ? parseInt(m[1], 10) : NaN;
}

function isChallenge(html) {
  var s = String(html || "").toLowerCase();
  return s.indexOf("cf-chl-") >= 0 ||
    s.indexOf("challenge-platform") >= 0 ||
    s.indexOf("just a moment") >= 0 ||
    s.indexOf("checking your browser") >= 0;
}

function tmdbTitle(tmdbId, lang) {
  var url = "https://www.themoviedb.org/tv/" + encodeURIComponent(tmdbId) +
    "?language=" + encodeURIComponent(lang);
  return fetchText(url, "").then(function (html) {
    var $ = cheerio.load(html);
    return cleanTmdbTitle(
      $('meta[property="og:title"]').attr("content") ||
      $("section.inner_content h2 a").first().text() ||
      $("h2 a").first().text() ||
      $("title").text()
    );
  }).catch(function () { return ""; });
}

function getCandidates(tmdbId) {
  var langs = ["tr-TR", "en-US", "ar-SA"];
  var out = [];
  function next(i) {
    if (i >= langs.length) return Promise.resolve(out);
    return tmdbTitle(tmdbId, langs[i]).then(function (t) {
      if (t && out.indexOf(t) < 0) out.push(t);
      return next(i + 1);
    });
  }
  return next(0);
}

function strictContains(identity, candidates) {
  var t = normalize(identity);
  if (!t) return false;

  for (var i = 0; i < candidates.length; i++) {
    var q = normalize(candidates[i]);
    if (!q || q.length < 3) continue;
    if (t.indexOf(q) >= 0) return true;
  }
  return false;
}

/* Only text that identifies the page itself — NOT related-post lists. */
function pageIdentity($) {
  var parts = [
    $('meta[property="og:title"]').attr("content") || "",
    $('meta[name="description"]').attr("content") || "",
    $("h1").first().text() || "",
    $("h2").first().text() || "",
    $(".entry-title").first().text() || "",
    $(".entry-content > p").first().text() || "",
    $("article p").first().text() || "",
    $(".description").first().text() || "",
    $(".story").first().text() || "",
    $(".singleSeries").first().text() || ""
  ];
  return parts.join(" ");
}

function collectSearchResults(html, base) {
  var $ = cheerio.load(html);
  var series = [];
  var episodes = [];
  var seen = {};

  $("a[href]").each(function (_, el) {
    var a = $(el);
    var u = absUrl(a.attr("href"), base);
    if (!u || seen[u]) return;
    if (u.indexOf("/series/") >= 0) {
      seen[u] = true;
      series.push(u);
    } else if (u.indexOf("/episode/") >= 0) {
      seen[u] = true;
      episodes.push(u);
    }
  });

  return { series: series.slice(0, 12), episodes: episodes.slice(0, 12) };
}

function verifySeries(seriesUrl, candidates) {
  return fetchText(seriesUrl, originOf(seriesUrl) + "/").then(function (html) {
    if (isChallenge(html)) return false;
    var $ = cheerio.load(html);
    return strictContains(pageIdentity($), candidates);
  }).catch(function () { return false; });
}

function seriesFromEpisode(episodeUrl, candidates) {
  return fetchText(episodeUrl, originOf(episodeUrl) + "/").then(function (html) {
    if (isChallenge(html)) return "";
    var $ = cheerio.load(html);
    var links = [];

    $('a[href*="/series/"]').each(function (_, el) {
      var u = absUrl($(el).attr("href"), episodeUrl);
      if (u && links.indexOf(u) < 0) links.push(u);
    });

    function next(i) {
      if (i >= links.length) return Promise.resolve("");
      return verifySeries(links[i], candidates).then(function (ok) {
        if (ok) return links[i];
        return next(i + 1);
      });
    }
    return next(0);
  }).catch(function () { return ""; });
}

function resolveSeriesOnBase(base, candidates) {
  var qi = 0;

  function nextQuery() {
    if (qi >= candidates.length) return Promise.resolve("");
    var q = candidates[qi++];
    if (!q) return nextQuery();

    var url = base + "/?s=" + encodeURIComponent(q);
    return fetchText(url, base + "/").then(function (html) {
      if (isChallenge(html)) return nextQuery();
      var found = collectSearchResults(html, url);

      function trySeries(i) {
        if (i >= found.series.length) return tryEpisodes(0);
        return verifySeries(found.series[i], candidates).then(function (ok) {
          if (ok) return found.series[i];
          return trySeries(i + 1);
        });
      }

      function tryEpisodes(i) {
        if (i >= found.episodes.length) return nextQuery();
        return seriesFromEpisode(found.episodes[i], candidates).then(function (seriesUrl) {
          if (seriesUrl) return seriesUrl;
          return tryEpisodes(i + 1);
        });
      }

      return trySeries(0);
    }).catch(function () {
      return nextQuery();
    });
  }

  return nextQuery();
}

function resolveSeries(candidates) {
  var bi = 0;
  function nextBase() {
    if (bi >= BASES.length) return Promise.resolve("");
    var base = BASES[bi++];
    return resolveSeriesOnBase(base, candidates).then(function (url) {
      if (url) return url;
      return nextBase();
    });
  }
  return nextBase();
}

function findExactEpisode(seriesUrl, wantedEpisode) {
  return fetchText(seriesUrl, originOf(seriesUrl) + "/").then(function (html) {
    var $ = cheerio.load(html);
    var hit = "";

    $('a[href*="/episode/"]').each(function (_, el) {
      if (hit) return;
      var a = $(el);
      var u = absUrl(a.attr("href"), seriesUrl);
      var text = (a.attr("title") || "") + " " + a.text() + " " + u;
      var ep = episodeNumber(text);
      if (Number(ep) === Number(wantedEpisode)) hit = u;
    });

    return hit;
  }).catch(function () { return ""; });
}

function playerHostAllowed(url) {
  return /anaplayer\.online|krmizitv\.com|dailymotion\.com|dai\.ly|vidoba|vidspeed|vidmoly|voe\.|streamtape|ok\.ru|vk\.com/i.test(String(url || ""));
}

function primaryPlayerFromEpisode(episodeUrl) {
  return fetchText(episodeUrl, originOf(episodeUrl) + "/").then(function (html) {
    var $ = cheerio.load(html);
    var candidates = [];

    $("iframe[src], iframe[data-src], video[src], source[src]").each(function (_, el) {
      var n = $(el);
      var u = absUrl(n.attr("src") || n.attr("data-src"), episodeUrl);
      if (u && playerHostAllowed(u) && candidates.indexOf(u) < 0) candidates.push(u);
    });

    /* Some themes inject the iframe as raw HTML/JS. */
    if (!candidates.length) {
      var re = /(?:src|data-src)=["']([^"']+)["']/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var u2 = absUrl(m[1], episodeUrl);
        if (u2 && playerHostAllowed(u2) && candidates.indexOf(u2) < 0) candidates.push(u2);
      }
    }

    return candidates.length ? candidates[0] : "";
  }).catch(function () { return ""; });
}

function directMedia(url) {
  return /\.(m3u8|mp4)(?:[?#].*)?$/i.test(String(url || ""));
}

function qualityFromUrl(url) {
  var s = String(url || "").toLowerCase();
  if (/2160|4k/.test(s)) return "4K";
  if (/1080/.test(s)) return "1080p";
  if (/720/.test(s)) return "720p";
  if (/576/.test(s)) return "576p";
  if (/480/.test(s)) return "480p";
  if (/360/.test(s)) return "360p";
  return "";
}

function qualityFromResolution(w, h) {
  var width = parseInt(w, 10) || 0;
  var height = parseInt(h, 10) || 0;
  if (height >= 2000 || width >= 3800) return "4K";
  if (height >= 1000 || width >= 1900) return "1080p";
  if (height >= 700 || width >= 1200) return "720p";
  if (height >= 560) return "576p";
  if (height >= 460) return "480p";
  if (height >= 340) return "360p";
  return height ? height + "p" : "";
}

function streamObject(url, referer, quality, serverName) {
  var q = quality || qualityFromUrl(url) || "HD";
  var h = { "User-Agent": UA };
  if (referer) {
    h["Referer"] = referer;
    var o = originOf(referer);
    if (o) h["Origin"] = o;
  }

  return {
    name: "Krmizi",
    title: "Krmizi • " + (serverName || "Server") + " • " + q,
    url: url,
    quality: q,
    provider: "Krmizi",
    language: "ar",
    headers: h
  };
}

function parseHlsMaster(text, masterUrl) {
  var lines = String(text || "").replace(/\r/g, "").split("\n");
  var out = [];

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var info = lines[i];
    var res = info.match(/RESOLUTION=(\d+)x(\d+)/i);
    var q = res ? qualityFromResolution(res[1], res[2]) : "";

    var j = i + 1;
    while (j < lines.length && (!lines[j] || lines[j].charAt(0) === "#")) j++;
    if (j >= lines.length) continue;

    var u = absUrl(lines[j].trim(), masterUrl);
    if (u) out.push({ url: u, quality: q || qualityFromUrl(u) || "HD" });
  }

  return out;
}

function addMedia(url, referer, serverName, streams, seen) {
  if (!url || seen[url]) return Promise.resolve();

  if (!/\.m3u8(?:[?#]|$)/i.test(url)) {
    seen[url] = true;
    streams.push(streamObject(url, referer, qualityFromUrl(url) || "HD", serverName));
    return Promise.resolve();
  }

  return fetchText(url, referer).then(function (playlist) {
    var variants = parseHlsMaster(playlist, url);
    if (variants.length) {
      for (var i = 0; i < variants.length; i++) {
        if (seen[variants[i].url]) continue;
        seen[variants[i].url] = true;
        streams.push(streamObject(variants[i].url, referer, variants[i].quality, serverName));
      }
    } else {
      seen[url] = true;
      streams.push(streamObject(url, referer, qualityFromUrl(url) || "HD", serverName));
    }
  }).catch(function () {
    if (!seen[url]) {
      seen[url] = true;
      streams.push(streamObject(url, referer, qualityFromUrl(url) || "HD", serverName));
    }
  });
}

function dailymotionId(url) {
  var s = String(url || "");
  var m = s.match(/dailymotion\.com\/(?:embed\/)?video\/([A-Za-z0-9]+)/i);
  if (!m) m = s.match(/dai\.ly\/([A-Za-z0-9]+)/i);
  return m ? m[1] : "";
}

function resolveDailymotion(url, referer, serverName, streams, seen) {
  var id = dailymotionId(url);
  if (!id) return Promise.resolve();

  return fetchJson("https://www.dailymotion.com/player/metadata/video/" + id, referer)
    .then(function (data) {
      var jobs = [];
      var qualities = data && data.qualities ? data.qualities : {};
      var keys = Object.keys(qualities);

      for (var i = 0; i < keys.length; i++) {
        var arr = qualities[keys[i]] || [];
        for (var j = 0; j < arr.length; j++) {
          if (arr[j] && arr[j].url) {
            jobs.push(addMedia(arr[j].url, referer, serverName + " " + keys[i], streams, seen));
          }
        }
      }

      if (!jobs.length && data && data.stream_hls_url) {
        jobs.push(addMedia(data.stream_hls_url, referer, serverName, streams, seen));
      }
      return Promise.all(jobs);
    }).catch(function () {});
}

/* Extract ONLY embed/media targets from a player page. Never ordinary links. */
function embeddedTargets(html, pageUrl) {
  var $ = cheerio.load(html);
  var out = [];
  var seen = {};

  function add(u) {
    var x = absUrl(u, pageUrl);
    if (!x || seen[x]) return;
    if (!directMedia(x) && !playerHostAllowed(x)) return;
    seen[x] = true;
    out.push(x);
  }

  $("iframe[src], iframe[data-src], video[src], source[src], [data-video], [data-file]").each(function (_, el) {
    var n = $(el);
    add(n.attr("src") || n.attr("data-src") || n.attr("data-video") || n.attr("data-file"));
  });

  var normalized = String(html || "").replace(/\\\//g, "/").replace(/\\u0026/gi, "&");
  var patterns = [
    /(?:file|src|source|hls|playlist|url)\s*[:=]\s*["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi,
    /["'](https?:[^"']+\.(?:m3u8|mp4)(?:[^"']*)?)["']/gi
  ];
  for (var p = 0; p < patterns.length; p++) {
    var re = patterns[p], m;
    while ((m = re.exec(normalized)) !== null) add(m[1]);
  }

  return out;
}

function resolveGenericPlayer(url, referer, serverName, depth, streams, seenPages, seenStreams) {
  if (!url || depth > 4 || seenPages[url]) return Promise.resolve();
  seenPages[url] = true;

  if (directMedia(url)) return addMedia(url, referer, serverName, streams, seenStreams);
  if (/dailymotion\.com|dai\.ly/i.test(url)) {
    return resolveDailymotion(url, referer, serverName, streams, seenStreams);
  }

  return fetchText(url, referer).then(function (html) {
    var targets = embeddedTargets(html, url);

    function next(i) {
      if (i >= targets.length || i >= 8) return Promise.resolve();
      return resolveGenericPlayer(targets[i], url, serverName, depth + 1, streams, seenPages, seenStreams)
        .then(function () { return next(i + 1); })
        .catch(function () { return next(i + 1); });
    }

    return next(0);
  }).catch(function () {});
}

function resolveAnaPlayer(url, referer, streams, seenPages, seenStreams) {
  return fetchText(url, referer).then(function (html) {
    var $ = cheerio.load(html);
    var servers = [];
    var seenServers = {};

    function addServer(u, label) {
      var x = absUrl(u, url);
      if (!x || seenServers[x]) return;
      if (originOf(x) !== originOf(url)) return;
      if (x.indexOf("?serv=") < 0) return;
      seenServers[x] = true;
      servers.push({ url: x, label: String(label || "").replace(/\s+/g, " ").trim() || "Server" });
    }

    $('a[href*="?serv="]').each(function (_, el) {
      addServer($(el).attr("href"), $(el).text());
    });

    /* serv=0 is commonly the default active server. */
    if (!servers.length) {
      var base = url.split("?")[0];
      addServer(base + "?serv=0", "Default");
    }

    function nextServer(i) {
      if (i >= servers.length || i >= 10) return Promise.resolve();
      var s = servers[i];

      return fetchText(s.url, url).then(function (serverHtml) {
        var targets = embeddedTargets(serverHtml, s.url);

        /* Ignore self-referencing AnaPlayer embed-code iframe. */
        var clean = [];
        for (var k = 0; k < targets.length; k++) {
          var t = targets[k];
          if (/anaplayer\.online/i.test(t) && t.split("?")[0] === s.url.split("?")[0]) continue;
          clean.push(t);
        }

        function nextTarget(j) {
          if (j >= clean.length || j >= 4) return Promise.resolve();
          return resolveGenericPlayer(clean[j], s.url, s.label, 0, streams, seenPages, seenStreams)
            .then(function () { return nextTarget(j + 1); })
            .catch(function () { return nextTarget(j + 1); });
        }

        return nextTarget(0).then(function () { return nextServer(i + 1); });
      }).catch(function () {
        return nextServer(i + 1);
      });
    }

    return nextServer(0);
  }).catch(function () {});
}

function resolvePrimaryPlayer(playerUrl, episodeUrl) {
  var streams = [];
  var seenPages = {};
  var seenStreams = {};

  if (/anaplayer\.online/i.test(playerUrl)) {
    return resolveAnaPlayer(playerUrl, episodeUrl, streams, seenPages, seenStreams)
      .then(function () { return streams; });
  }

  return resolveGenericPlayer(playerUrl, episodeUrl, "Main", 0, streams, seenPages, seenStreams)
    .then(function () { return streams; });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var type = String(mediaType || "").toLowerCase();
  if (type !== "tv" && type !== "series" && type !== "show") return Promise.resolve([]);
  if (!episode) return Promise.resolve([]);

  console.log("[Krmizi v0.6] TMDB=" + tmdbId + " S" + (season || 1) + "E" + episode);

  var candidates = [];

  return getCandidates(tmdbId)
    .then(function (titles) {
      candidates = titles || [];
      console.log("[Krmizi] TMDB titles: " + candidates.join(" | "));
      if (!candidates.length) return "";
      return resolveSeries(candidates);
    })
    .then(function (seriesUrl) {
      if (!seriesUrl) {
        console.log("[Krmizi] series not found");
        return "";
      }
      console.log("[Krmizi] series: " + seriesUrl);
      return findExactEpisode(seriesUrl, episode);
    })
    .then(function (episodeUrl) {
      if (!episodeUrl) {
        console.log("[Krmizi] exact episode not found");
        return "";
      }
      console.log("[Krmizi] episode: " + episodeUrl);
      return primaryPlayerFromEpisode(episodeUrl).then(function (playerUrl) {
        return { episodeUrl: episodeUrl, playerUrl: playerUrl };
      });
    })
    .then(function (data) {
      if (!data || !data.playerUrl) {
        console.log("[Krmizi] primary player not found");
        return [];
      }
      console.log("[Krmizi] primary player: " + data.playerUrl);
      return resolvePrimaryPlayer(data.playerUrl, data.episodeUrl);
    })
    .then(function (streams) {
      streams = streams || [];
      console.log("[Krmizi] exact streams: " + streams.length);
      return streams;
    })
    .catch(function (e) {
      console.error("[Krmizi] fatal: " + (e && e.message ? e.message : e));
      return [];
    });
}

module.exports = { getStreams: getStreams };
