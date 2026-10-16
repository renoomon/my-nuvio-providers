/* Additional catalog adapters. Concatenate into krmizi.js: no extra runtime require.
 * These are separately searched catalogs, not a claim of independent ownership.
 * A source contributes only episode-owned, identity-checked, validated media.
 */
var EXTRA_SOURCES = [
  { name: "3skNews", bases: ["https://q.3sk.news", "https://f1.q3sk.monster"], strategy: "extra" },
  { name: "DDizi", bases: ["https://www.ddizi.im", "https://www.ddizi.tel"], strategy: "extra", language: "tr" },
  { name: "TVDiziler", bases: ["https://tvdiziler.tv"], strategy: "extra", language: "tr" },
  { name: "NOW", bases: ["https://www.nowtv.com.tr"], strategy: "extra", official: "now", language: "tr" },
  { name: "Shahid4U", bases: ["https://sh4u.buzz"], strategy: "extra", search: "php" }
];

function extraUrlKey(url) {
  return String(url || "").split("#")[0].replace(/\/+$/, "").toLowerCase();
}

function extraWrapperAllowed(url) {
  return /^https?:\/\/(?:www\.)?3sktvtr\.com\/watch\//i.test(String(url || ""));
}

function extraEpisodeNumber(value) {
  var n = episodeNumber(value);
  if (n) return n;
  var match = decodeHtml(value).match(/(?:الحلقة|الحلقه|حلقة|حلقه)\s*(?:رقم\s*)?(\d{1,4})/i);
  if (!match) match = normalize(value).match(/(?:^|\s)(\d{1,4})\s*bolum(?:\s|$)/i);
  return match ? parseInt(match[1], 10) : NaN;
}

function extraRequestMatch(identity, requests) {
  var number = extraEpisodeNumber(identity);
  if (!number) return null;
  var explicit = explicitSeasonEpisode(identity);
  for (var i = 0; i < requests.length; i++) {
    if (!explicit && requests[i].season > 1) continue;
    if (requests[i].episode === number && (!explicit || requests[i].season === explicit.season)) return { season: requests[i].season, episode: requests[i].episode, identities: requests };
  }
  return null;
}

function extraAnchorIdentity(anchor) {
  return [anchor.attr("title") || "", anchor.text() || "", anchor.find("img").first().attr("alt") || ""].join(" ");
}

function extraCatalogLinks(html, pageUrl, metadata, requests, seriesVerified) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || seen[extraUrlKey(url)]) return;
    var identity = extraAnchorIdentity(a);
    if (/اعلان|إعلان|تريلر|trailer|fragman/i.test(identity)) return;
    var score = fieldMatchScore(identity, metadata.titles);
    var request = extraRequestMatch(identity, requests);
    // Navigation/category links are never treated as playable episode pages.
    if (!request && !/\/(?:series|tvshows|dizi|diziler)\//i.test(url)) return;
    if (score < 80 && !(seriesVerified && request)) return;
    seen[extraUrlKey(url)] = true;
    links.push({ url: url, identity: identity, score: score, request: request });
  });
  links.sort(function (a, b) { return (b.request ? 1000 : 0) + b.score - ((a.request ? 1000 : 0) + a.score); });
  return links;
}

function extraPageIdentity(html) {
  var $ = cheerio.load(html);
  return [$("h1").first().text() || "", $("meta[property='og:title']").first().attr("content") || "", $("title").first().text() || ""].join(" ");
}

function extraOwnedPlayerTargets(html, pageUrl) {
  var $ = cheerio.load(html), targets = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url]) return;
    // Only the episode's player container or known public player hosts are used.
    var ownEmbed = originOf(url) === originOf(pageUrl) && /\/(?:embed|player|vid\/ply)\//i.test(url);
    if (!ownEmbed && !extraWrapperAllowed(url) && !anaPlayerAllowed(url) && !directMedia(url) && !supportedDirectEmbed(url) && !dailymotionId(url)) return;
    seen[url] = true;
    targets.push({ url: url, referer: pageUrl, label: "Main" });
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("#Playerholder a[href], .getEmbed a[href]").each(function (_, element) {
    var value = absUrl(wrap($, element).attr("href"), pageUrl);
    if (extraWrapperAllowed(value)) add(value);
  });
  $(".series-watch-alternatives [data-hhs]").each(function (_, element) {
    var url = absUrl(wrap($, element).attr("data-hhs"), pageUrl);
    if (originOf(url) === originOf(pageUrl)) add(url);
  });
  $("video[src], video source[src]").each(function (_, element) { add(wrap($, element).attr("src")); });
  return targets.slice(0, 8);
}

function extraResolveOwnedPlayer(target, request, depth) {
  if (anaPlayerAllowed(target.url)) return resolveAnaPlayer(target.url, target.referer, request.season, request.episode, request.identities);
  var streams = [], seen = {};
  if (directMedia(target.url) || supportedDirectEmbed(target.url) || dailymotionId(target.url)) {
    return resolveEmbedTarget(target, request, streams, seen).then(function () { return streams; });
  }
  if (depth >= 2) return Promise.resolve([]);
  return fetchTextInfo(target.url, target.referer, "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    var number = extraEpisodeNumber(identity);
    if (number && !extraRequestMatch(identity, request.identities || [request])) return [];
    var nested = extraOwnedPlayerTargets(page.html, page.url);
    var $ = cheerio.load(page.html);
    var mediaReferer = $("meta[name=referrer]").first().attr("content") === "no-referrer" ? "" : page.url;
    var entries = mediaEntriesFromHtml(page.html), mediaStreams = [], mediaSeen = {};
    var mediaJobs = entries.map(function (entry) { return addMediaEntry(entry, mediaReferer, target.label, mediaStreams, mediaSeen); });
    return Promise.all(nested.map(function (child) { return extraResolveOwnedPlayer(child, request, depth + 1); }).concat(mediaJobs)).then(function (parts) {
      var result = mediaStreams.slice(0);
      for (var i = 0; i < parts.length; i++) if (Array.isArray(parts[i])) result = result.concat(parts[i]);
      return result;
    });
  }).catch(function () { return []; });
}

function extraResolveEpisode(candidate, metadata, requests, referer) {
  return fetchTextInfo(candidate.url, referer, "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    var request = extraRequestMatch(identity, requests);
    if (!request || fieldMatchScore(identity, metadata.titles) < 80) {
      logFailure("extra_episode_identity_mismatch", page.url);
      return [];
    }
    var targets = extraOwnedPlayerTargets(page.html, page.url);
    return Promise.all(targets.map(function (target) { return extraResolveOwnedPlayer(target, request, 0); })).then(function (parts) {
      var result = [];
      for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
      return result;
    });
  }).catch(function (error) { logFailure("extra_episode_failed", errorMessage(error)); return []; });
}

function resolveExtraSource(metadata, source, requests) {
  if (source.official === "now") return resolveNowSource(metadata, source, requests);
  var bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++], pending = [base + "/"], seenPages = {}, seenEpisodes = {}, checked = 0;
    // Search is bounded per source; the latest page handles current episodes if
    // a WordPress search endpoint is unavailable. No guessed episode URL is used.
    for (var t = 0; t < metadata.titles.length && t < 3; t++) pending.push(base + (source.search === "php" ? "/search.php?keywords=" : "/?s=") + encodeURIComponent(metadata.titles[t]));
    function nextPage() {
      if (!pending.length || checked >= 7) return Promise.resolve([]);
      var url = pending.shift();
      if (seenPages[extraUrlKey(url)]) return nextPage();
      seenPages[extraUrlKey(url)] = true; checked++;
      return fetchTextInfo(url, base + "/", "").then(function (page) {
        var seriesVerified = fieldMatchScore(extraPageIdentity(page.html), metadata.titles) >= 80 && !extraEpisodeNumber(extraPageIdentity(page.html));
        var links = extraCatalogLinks(page.html, page.url, metadata, requests, seriesVerified), episodes = [];
        for (var i = 0; i < links.length; i++) {
          if (links[i].request && !seenEpisodes[extraUrlKey(links[i].url)]) { seenEpisodes[extraUrlKey(links[i].url)] = true; episodes.push(links[i]); }
          else if (!links[i].request && pending.length < 6) pending.unshift(links[i].url);
        }
        return Promise.all(episodes.slice(0, 3).map(function (candidate) { return extraResolveEpisode(candidate, metadata, requests, page.url); })).then(function (parts) {
          var result = [];
          for (var p = 0; p < parts.length; p++) result = result.concat(parts[p]);
          return result.length ? result : nextPage();
        });
      }).catch(function (error) {
        logFailure("extra_catalog_failed", source.name + " " + errorMessage(error));
        return nextPage();
      });
    }
    return nextPage().then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase().then(function (streams) {
    var deduped = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      if (source.language) streams[i].language = source.language;
      deduped.push(streams[i]);
    }
    return deduped;
  });
}


// NOW exposes full public episodes through its own page's documented AJAX call.
// Request the page-discovered video ID only; trailers and snippets are excluded.
function nowOwnedLinks(html, pageUrl, metadata, requests) {
  var $ = cheerio.load(html), series = [], episodes = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (originOf(url) !== "https://www.nowtv.com.tr" || seen[extraUrlKey(url)]) return;
    var path = url.split("?")[0], identity = extraAnchorIdentity(a) + " " + path;
    if (fieldMatchScore(identity, metadata.titles) < 80) return;
    var match = path.match(/\/bolum\/(\d+)\/?$/i);
    if (match) {
      for (var r = 0; r < requests.length; r++) {
        if (requests[r].season === 1 && requests[r].episode === parseInt(match[1], 10)) {
          episodes.push({ url: url, request: requests[r] }); seen[extraUrlKey(url)] = true; break;
        }
      }
    } else if (/\/[^/]+\/izle\/?$/i.test(path)) {
      series.push(url); seen[extraUrlKey(url)] = true;
    }
  });
  return { series: series.slice(0, 2), episodes: episodes.slice(0, 2) };
}

function nowResolveEpisode(candidate, metadata) {
  return fetchTextInfo(candidate.url, "https://www.nowtv.com.tr/", "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    if (fieldMatchScore(identity, metadata.titles) < 80 || extraEpisodeNumber(identity) !== candidate.request.episode) return [];
    var $ = cheerio.load(page.html);
    var id = $(".vod-player[data-video-id]").first().attr("data-video-id");
    if (!/^\d+$/.test(String(id || ""))) return [];
    var headers = requestHeaders(page.url, "https://www.nowtv.com.tr", "application/json,text/plain,*/*");
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
    headers["X-Requested-With"] = "XMLHttpRequest";
    return fetch("https://www.nowtv.com.tr/ajax/stream", {
      method: "POST", headers: headers, body: "video_id=" + encodeURIComponent(id), skipSizeCheck: true
    }).then(function (response) {
      if (!response || !response.ok) return null;
      return response.text().then(function (text) {
        if (isChallenge(text)) return null;
        try { return JSON.parse(text); } catch (_) { return null; }
      });
    }).then(function (data) {
      if (!data || data.code !== 200 || !directMedia(data.video_url)) return [];
      var streams = [];
      return addMediaEntry({url:data.video_url,quality:""}, page.url, "Official • Türkçe", streams, {}).then(function () {
        for (var i = 0; i < streams.length; i++) {
          streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, "NOW");
          streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, "NOW");
          streams[i].provider = "NOW"; streams[i].language = "tr";
        }
        return streams;
      });
    });
  }).catch(function (error) { logFailure("official_episode_failed", "NOW " + errorMessage(error)); return []; });
}

function resolveNowSource(metadata, source, requests) {
  return fetchTextInfo("https://www.nowtv.com.tr/", "", "").then(function (home) {
    var links = nowOwnedLinks(home.html, home.url, metadata, requests);
    var jobs = links.episodes.map(function (candidate) { return nowResolveEpisode(candidate, metadata); });
    var seriesJobs = (links.episodes.length ? [] : links.series).map(function (url) {
      return fetchTextInfo(url, home.url, "").then(function (series) {
        var own = nowOwnedLinks(series.html, series.url, metadata, requests);
        return Promise.all(own.episodes.map(function (candidate) { return nowResolveEpisode(candidate, metadata); })).then(function (parts) {
          var result = []; for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]); return result;
        });
      }).catch(function () { return []; });
    });
    return Promise.all(jobs.concat(seriesJobs)).then(function (parts) {
      var result = [], seen = {};
      for (var i = 0; i < parts.length; i++) for (var p = 0; p < parts[i].length; p++) {
        if (!seen[parts[i][p].url]) { seen[parts[i][p].url] = true; result.push(parts[i][p]); }
      }
      return result;
    });
  }).catch(function (error) { logFailure("official_source_failed", "NOW " + errorMessage(error)); return []; });
}
