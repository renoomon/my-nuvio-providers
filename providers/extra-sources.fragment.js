/* Additional catalog adapters. Concatenate into krmizi.js: no extra runtime require.
 * These are separately searched catalogs, not a claim of independent ownership.
 * A source contributes only episode-owned, identity-checked, validated media.
 */
// Arabic-translated catalogs only. Original-Turkish catalogs (NOW, DDizi,
// TVDiziler) were removed in 0.15.0 because they cannot provide Arabic
// translation; this provider returns Arabic-tagged streams only.
var EXTRA_SOURCES = [
  { name: "3skNews", bases: ["https://q.3sk.news", "https://f1.q3sk.monster"], strategy: "extra", language: "ar" },
  { name: "Qeseh", bases: ["https://wwv.qeseh.com"], strategy: "extra", search: "qeseh", language: "ar" },
  { name: "Qesset", bases: ["https://qesset.com", "https://www.qesset.com"], strategy: "extra", search: "qeseh", language: "ar" },
  { name: "FaselHD", bases: ["https://faselhd.watch", "https://faselhd.channel"], strategy: "extra", search: "faselhd", language: "ar" },
  { name: "Dailymotion", bases: ["https://www.dailymotion.com"], strategy: "extra", search: "dailymotion", language: "ar" },
  { name: "Shahid4U", bases: ["https://sh4u.buzz"], strategy: "extra", search: "php", language: "ar" },
  { name: "3ick", bases: ["https://ww4.3ick.club", "https://3iskk.xyz"], strategy: "extra", search: "3ick", language: "ar" }
];

function threeickCatalogAllowed(url) {
  return /^https:\/\/ww\d+\.3ick\.club$/i.test(originOf(url));
}

function threeickOwnedUrl(value, pageUrl) {
  var url = absUrl(value, pageUrl);
  if (!url || !threeickCatalogAllowed(url) || !threeickCatalogAllowed(pageUrl)) return "";
  // The live catalog prints episode links under its next numbered mirror.
  // Keep only its page-owned path, on the currently reachable catalog mirror.
  return originOf(pageUrl) + url.substring(originOf(url).length);
}

function threeickSession() {
  var cookies = {};
  function get(url, referer, redirects) {
    var origin = originOf(url), seed = origin === "https://3iskk.xyz";
    if (!threeickCatalogAllowed(url) && !seed) return Promise.reject(new Error("3ick_unowned_catalog"));
    var headers = requestHeaders(referer, "");
    if (cookies[origin]) headers.Cookie = cookies[origin];
    var work = fetch(url,{headers:headers,redirect:"manual",skipSizeCheck:true}).then(function(response) {
      if (!response) throw new Error("3ick_no_response");
      var location = response.headers && response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        var next = absUrl(location,url);
        if (!threeickCatalogAllowed(next) || (redirects || 0) >= 3) throw new Error("3ick_unowned_redirect");
        return get(next,referer,(redirects || 0) + 1);
      }
      var finalUrl = response.url || url;
      if (!response.ok || !threeickCatalogAllowed(finalUrl)) throw new Error("3ick_http_or_origin");
      var setCookie = response.headers && response.headers.get("set-cookie");
      // An ordinary catalog session, never copied to media/player hosts or a
      // different numbered mirror; missing cookies simply fail the watch page.
      var match = String(setCookie || "").match(/(?:^|[,;]\s*)PHPSESSID=([A-Za-z0-9,-]{1,128})(?:;|$)/);
      if (match) cookies[originOf(finalUrl)] = "PHPSESSID=" + match[1];
      return response.text().then(function(html) {
        if (isChallenge(html)) throw new Error("3ick_challenge");
        return {html:String(html || ""),url:finalUrl,status:response.status};
      });
    });
    return withDeadline(work,6000,"3ick_catalog_timeout");
  }
  return {get:get};
}

function threeickTitleMatches(html, metadata) {
  var $ = cheerio.load(html), heading = $("h1").first().text() || "";
  if (!heading || /مدبلج|mudblij/i.test(heading)) return false;
  // This catalog's own suffix is structural branding, not a title alias.
  heading = heading.replace(/\s+(?:الاصلي|الأصلي|الاصلية|الأصلية)\s*(?:HD)?\s*$/i,"");
  return typeof catalogTitleMatches === "function" && catalogTitleMatches(heading,metadata.titles);
}

function threeickLinks(page, metadata, requests, verifiedSeries) {
  var $ = cheerio.load(page.html), series = [], episodes = [], seen = {};
  $("a[href]").each(function(_,element) {
    var a = wrap($,element), url = threeickOwnedUrl(a.attr("href"),page.url), identity = extraAnchorIdentity(a);
    if (!url || seen[url] || /mudblij|مدبلج|اعلان|إعلان|trailer|fragman/i.test(url + " " + identity)) return;
    if (/\/watch\/tvshows\//i.test(url) && fieldMatchScore(identity + " " + url,metadata.titles) >= 80) {
      seen[url] = true; series.push(url); return;
    }
    if (!/\/watch\/episodes\/[^/?]+\/?$/i.test(url)) return;
    var request = extraRequestMatch(identity + " " + url,requests);
    if (!request || (!verifiedSeries && fieldMatchScore(identity,metadata.titles) < 80)) return;
    seen[url] = true; episodes.push({url:url,request:request});
  });
  return {series:series.slice(0,3),episodes:episodes.slice(0,4)};
}

function threeickResolveEpisode(candidate, metadata, requests, session, referer) {
  return session.get(candidate.url,referer).then(function(page) {
    var request = extraRequestMatch(extraPageIdentity(page.html) + " " + page.url,requests);
    if (!request || !threeickTitleMatches(page.html,metadata)) return [];
    var $ = cheerio.load(page.html), watch = "";
    $("a[href]").each(function(_,element) {
      var url = threeickOwnedUrl(wrap($,element).attr("href"),page.url);
      if (/\/see\/$/.test(url) && url.replace(/see\/$/,"") === page.url.replace(/\/?$/,"/")) watch = url;
    });
    if (!watch) return [];
    return session.get(watch,page.url).then(function(player) {
      if (!/\/see\/$/.test(player.url) || !threeickTitleMatches(player.html,metadata) || !extraRequestMatch(extraPageIdentity(player.html) + " " + player.url,requests)) return [];
      var $ = cheerio.load(player.html), targets = [], seen = {};
      function add(url) {if(url && !seen[url]){seen[url]=true;targets.push({url:url,referer:player.url,label:"Arabic"});}}
      var iframe = threeickOwnedUrl($("#iframe_player").first().attr("src"),player.url);
      if (!/\/embed\/\d+\/\d+\/2\/$/.test(iframe)) return [];
      add(iframe);
      $("#player_servers [data-post][data-nume][data-type]").each(function(_,element) {
        var item = wrap($,element), post = item.attr("data-post"), num = item.attr("data-nume");
        if (item.attr("data-type") === "tv" && /^\d+$/.test(post) && /^\d+$/.test(num)) add(originOf(player.url) + "/embed/" + num + "/" + post + "/2/");
      });
      return Promise.all(targets.slice(0,4).map(function(target) {
        return session.get(target.url,target.referer).then(function(wrapper) {
          var owned = extraOwnedPlayerTargets(wrapper.html,wrapper.url).filter(function(child) {return supportedDirectEmbed(child.url);});
          return Promise.all(owned.map(function(child) {return extraResolveOwnedPlayer(child,request,0);})).then(function(parts) {
            var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;
          });
        }).catch(function(){return [];});
      })).then(function(parts) {var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;});
    });
  }).catch(function(error) {logFailure("3ick_episode_failed",errorMessage(error));return [];});
}

function resolve3ickSource(metadata, source, requests) {
  var session = threeickSession(), index = 0, seenEpisodes = {};
  function nextBase() {
    if (index >= source.bases.length) return Promise.resolve([]);
    return session.get(source.bases[index++] + "/","").then(function(home) {
      var titles = extraQueryTitles(metadata);
      function scan(page, verified, scanMeta) {
        var effective = scanMeta || metadata;
        var links = threeickLinks(page,effective,requests,verified);
        var jobs = links.episodes.filter(function(candidate){if(seenEpisodes[candidate.url])return false;seenEpisodes[candidate.url]=true;return true;}).map(function(candidate){return threeickResolveEpisode(candidate,effective,requests,session,page.url);});
        if (!verified) jobs = jobs.concat(links.series.map(function(url) {
          return session.get(url,page.url).then(function(series) {return threeickTitleMatches(series.html,effective) ? scan(series,true,effective) : [];}).catch(function(){return [];});
        }));
        return Promise.all(jobs).then(function(parts) {var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;});
      }
      function flatten(parts){var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;}
      // Queries containing apostrophes are rejected by the site (HTTP 403).
      function searchUrl(title){return originOf(home.url) + "/?s=" + encodeURIComponent(String(title).replace(/['\u2019]/g," "));}
      function catalogFallback() {
        var origin = originOf(home.url), jobs = [], page;
        for (page = 1; page <= 4; page++) {
          var pageUrl = page === 1 ? origin + "/w-srs/" : origin + "/w-srs/page/" + page + "/";
          jobs.push(session.get(pageUrl, home.url).catch(function () { return null; }));
        }
        return Promise.all(jobs).then(function (pages) {
          var strong = [], weak = [], seen = {};
          for (var p = 0; p < pages.length; p++) {
            if (!pages[p]) continue;
            var $ = cheerio.load(pages[p].html);
            $("a[href]").each(function (_, element) {
              var a = wrap($, element), url = threeickOwnedUrl(a.attr("href"), pages[p].url);
              if (!url || !/\/watch\/tvshows\//i.test(url)) return;
              var identity = extraAnchorIdentity(a);
              if (/mudblij|\u0645\u062f\u0628\u0644\u062c/i.test(url + " " + identity)) return;
              var key = extraUrlKey(url);
              if (seen[key]) return;
              if (fieldMatchScore(identity + " " + url, metadata.titles) >= 80) {
                seen[key] = true; strong.push({ url: url, weak: false });
              } else if (extraSlugAlias(url, metadata.titles)) {
                seen[key] = true; weak.push({ url: url, weak: true });
              }
            });
          }
          var candidates = strong.slice(0, 2).concat(weak.slice(0, 2));
          return Promise.all(candidates.map(function (candidate) {
            return session.get(candidate.url, home.url).then(function (seriesPage) {
              var heading = cheerio.load(seriesPage.html)("h1").first().text() || "";
              if (candidate.weak) {
                if (!heading) return [];
                return scan(seriesPage, true, { titles: metadata.titles.concat([heading]), seasons: metadata.seasons });
              }
              if (!threeickTitleMatches(seriesPage.html, metadata)) return [];
              return scan(seriesPage, true, metadata);
            }).catch(function () { return []; });
          })).then(flatten);
        });
      }
      return Promise.all(titles.slice(0,8).map(function(title) {
        return session.get(searchUrl(title),home.url).then(function(page){return scan(page,false);}).catch(function(){return [];});
      })).then(function(parts) {
        var result=flatten(parts);
        if (result.length) return result;
        return catalogFallback();
      });
    }).catch(function(error){logFailure("3ick_catalog_failed",errorMessage(error));return [];}).then(function(streams){return streams.length ? streams : nextBase();});
  }
  return nextBase().then(function(streams) {
    var result=[],seen={};
    for(var i=0;i<streams.length;i++)if(!seen[streams[i].url]) {
      seen[streams[i].url]=true;streams[i].name=String(streams[i].name || "Krmizi").replace(/^Krmizi/,"3ick");
      streams[i].title=String(streams[i].title || "Krmizi").replace(/^Krmizi/,"3ick");streams[i].provider="3ick";streams[i].language="ar";result.push(streams[i]);
    }
    return result;
  });
}

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
    if (!request && !/\/(?:series|tvshows|dizi|diziler)\/|\/category\.php\?cat=/i.test(url)) return;
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

function extraPageTitleMatches(html, metadata) {
  var $ = cheerio.load(html), heading = $("h1").first().text() || "";
  var fields = heading.trim() ? [heading] : [$("meta[property='og:title']").first().attr("content") || "",$("title").first().text() || ""];
  function clean(value) {
    return normalize(value).split(/\s[|]\s/)[0]
      .replace(/^(?:مسلسل|المسلسل)\s+/g,"")
      .replace(/\s+(?:الحلقه|حلقه)\s*(?:رقم\s*)?\d+[\s\S]*$/i,"")
      .replace(/\s+\d+\s+bolum[\s\S]*$/i,"")
      .replace(/\s+(?:izle|مترجم|مترجمه|مدبلج|مدبلجه|hd\d?|full|online|son bolum)[\s\S]*$/i,"").trim();
  }
  for (var f = 0; f < fields.length; f++) {
    if (!fields[f]) continue;
    if (typeof catalogTitleMatches === "function") {
      if (catalogTitleMatches(fields[f],metadata.titles)) return true;
    } else {
      for (var t = 0; t < metadata.titles.length; t++) if (clean(fields[f]) === clean(metadata.titles[t])) return true;
    }
  }
  return false;
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
  $(".embeding a[data-src], .embeding [data-src]").each(function (_, element) {
    add(wrap($, element).attr("data-src"));
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
    if (!request || !extraPageTitleMatches(page.html, metadata)) {
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

function extraSearchRequests(metadata, source, base, requests) {
  var titles = typeof extraQueryTitles === "function" ? extraQueryTitles(metadata) : metadata.titles || [];
  var queries = [], seen = {};
  function add(title) {
    if (!title || seen[title]) return;
    seen[title] = true; queries.push(title);
  }
  for (var i = 0; i < titles.length; i++) {
    // The site's own PHP search has no series index API. A narrow episode
    // query avoids losing early episodes behind many search-result pages.
    if (source.search === "php" && /[\u0600-\u06ff]/.test(titles[i]) && requests.length) {
      add(titles[i] + " الحلقة " + requests[0].episode);
    }
    add(titles[i]);
  }
  return queries.slice(0, 8).map(function (title) {
    return {url:base + (source.search === "php" ? "/search.php?keywords=" : "/?s=") + encodeURIComponent(title)};
  });
}

function extraFetchCatalog(request, referer) {
  if (!request.method || request.method === "GET") return fetchTextInfo(request.url, referer, "");
  var headers = requestHeaders(referer, originOf(referer), "text/html,*/*");
  headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  var job = fetch(request.url,{method:request.method,headers:headers,body:request.body,skipSizeCheck:true}).then(function (response) {
    if (!response || !response.ok) throw new Error("http_" + (response ? response.status : "no_response"));
    return response.text().then(function (body) {
      if (isChallenge(body)) throw new Error("cloudflare_challenge");
      return {html:String(body || ""),url:response.url || request.url,status:response.status};
    });
  });
  return typeof withDeadline === "function" ? withDeadline(job,8000,"catalog_search_timeout") : job;
}

function extraNextCatalogPage(html, pageUrl) {
  var $ = cheerio.load(html), current = String(pageUrl).match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
  var currentNumber = current ? parseInt(current[1],10) : 1, next = "";
  $("a[rel=next], .pagination a[href], .wp-pagenavi a[href], .page-numbers[href]").each(function (_,element) {
    var a = wrap($,element), url = absUrl(a.attr("href"),pageUrl);
    if (originOf(url) !== originOf(pageUrl)) return;
    var number = url.match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
    if (number && parseInt(number[1],10) === currentNumber + 1) next = url;
  });
  return next;
}

function extraLastCatalogPage(html, pageUrl, requests) {
  var $ = cheerio.load(html), target = 0, minimum = Infinity, last = "", highest = -1;
  for (var r = 0; r < requests.length; r++) if (requests[r].season === 1 && (!target || requests[r].episode < target)) target = requests[r].episode;
  if (!target) return "";
  $("a[href]").each(function (_,element) {
    var a = wrap($,element), url = absUrl(a.attr("href"),pageUrl);
    if (originOf(url) !== originOf(pageUrl)) return;
    var number = extraEpisodeNumber(extraAnchorIdentity(a));
    if (number && number < minimum) minimum = number;
  });
  if (!(minimum > target && minimum < Infinity)) return "";
  $(".pagination a[href], .wp-pagenavi a[href], .page-numbers[href]").each(function (_,element) {
    var url = absUrl(wrap($,element).attr("href"),pageUrl), number = url.match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
    if (originOf(url) === originOf(pageUrl) && number && parseInt(number[1],10) > highest) {highest=parseInt(number[1],10);last=url;}
  });
  return last;
}

function phpCategorySeason(url) {
  var match = String(url || "").match(/[?&]cat=[^&]*-s(\d{1,2})(?:[&#]|$)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function phpCategoryPageUrl(url, pageNumber) {
  var clean = String(url || "").replace(/([?&])page=\d+/i, "$1").replace(/[?&#]+$/, "");
  if (!clean || pageNumber <= 1) return clean;
  return clean + (clean.indexOf("?") >= 0 ? "&" : "?") + "page=" + pageNumber;
}

function phpWatchLinks(html, pageUrl, metadata, requests) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/watch\.php\?vid=/i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    if (fieldMatchScore(identity, metadata.titles) < 80) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, request: extraRequestMatch(identity, requests), referer: pageUrl });
  });
  return links;
}

function phpCategoryLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/category\.php\?cat=/i.test(url)) return;
    if (fieldMatchScore(extraAnchorIdentity(a), metadata.titles) < 80) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, label: extraAnchorIdentity(a) });
  });
  return links;
}

// PHP catalogs only print matching episodes in their search results, and those
// results never include every old episode. Their season category pages do keep
// the full archive (with pagination), so a family episode page is used only to
// discover the page-owned category URLs. No URL is guessed from a title.
function resolvePhpCategoryArchive(metadata, source, requests) {
  var MAX_SEARCH_QUERIES = 4, MAX_CATEGORY_PAGES = 6, bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var queries = extraSearchRequests(metadata, source, base, requests).slice(0, MAX_SEARCH_QUERIES);
    return Promise.all(queries.map(function (request) {
      return extraFetchCatalog(request, base + "/").catch(function (error) {
        logFailure("php_search_failed", source.name + " " + errorMessage(error)); return null;
      });
    })).then(function (pages) {
      pages = pages.filter(Boolean);
      var families = [], seenFamily = {};
      for (var p = 0; p < pages.length; p++) {
        var links = phpWatchLinks(pages[p].html, pages[p].url, metadata, requests);
        for (var l = 0; l < links.length && families.length < 2; l++) {
          if (seenFamily[links[l].url]) continue;
          seenFamily[links[l].url] = true;
          families.push(links[l]);
        }
      }
      return Promise.all(families.map(function (family) {
        return fetchTextInfo(family.url, base + "/", "").catch(function () { return null; });
      }));
    }).then(function (familyPages) {
      familyPages = familyPages.filter(Boolean);
      var categories = [], seenCategory = {};
      for (var p = 0; p < familyPages.length; p++) {
        var found = phpCategoryLinks(familyPages[p].html, familyPages[p].url, metadata);
        for (var c = 0; c < found.length; c++) {
          var key = extraUrlKey(found[c].url);
          if (seenCategory[key]) continue;
          seenCategory[key] = true;
          categories.push(found[c]);
        }
      }
      if (!categories.length) return [];
      var seasons = {}, i;
      for (i = 0; i < requests.length; i++) seasons[requests[i].season] = true;
      categories.sort(function (left, right) {
        var leftSeason = phpCategorySeason(left.url), rightSeason = phpCategorySeason(right.url);
        var leftRank = leftSeason ? (seasons[leftSeason] ? 3 : 0) : 1;
        var rightRank = rightSeason ? (seasons[rightSeason] ? 3 : 0) : 1;
        return rightRank - leftRank;
      });
      categories = categories.slice(0, 4);
      var categoryIndex = 0;
      function nextCategory() {
        if (categoryIndex >= categories.length) return Promise.resolve([]);
        var category = categories[categoryIndex++], pageNumber = 1, seenPages = {};
        function nextPage() {
          if (pageNumber > MAX_CATEGORY_PAGES) return nextCategory();
          var pageUrl = phpCategoryPageUrl(category.url, pageNumber++);
          if (!pageUrl || seenPages[pageUrl]) return nextCategory();
          seenPages[pageUrl] = true;
          return fetchTextInfo(pageUrl, category.url, "").catch(function () { return null; }).then(function (page) {
            if (!page) return nextCategory();
            var matching = phpWatchLinks(page.html, page.url, metadata, requests).filter(function (link) {
              return !!link.request;
            });
            if (!matching.length) return nextPage();
            var candidateIndex = 0;
            function nextCandidate() {
              if (candidateIndex >= matching.length) return nextPage();
              var candidate = matching[candidateIndex++];
              return extraResolveEpisode({ url: candidate.url }, metadata, requests, page.url).then(function (streams) {
                return streams.length ? streams : nextCandidate();
              });
            }
            return nextCandidate();
          });
        }
        return nextPage().then(function (streams) { return streams.length ? streams : nextCategory(); });
      }
      return nextCategory();
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase();
}



// Metadata titles are TMDB names; some catalogs list another Arabic broadcast
// name ("ما ذنب فاطمة جول" vs "ما هو ذنب فاطمة جول"). Distinctive Arabic words
// from the known titles are searched too, then the normal identity checks apply.
var EXTRA_QUERY_STOPWORDS = {
  "ما": 1, "هو": 1, "هي": 1, "هم": 1, "في": 1, "من": 1, "على": 1, "عن": 1,
  "الى": 1, "مع": 1, "او": 1, "و": 1, "يا": 1, "كل": 1, "هذا": 1, "هذه": 1,
  "التي": 1, "التى": 1, "ذلك": 1, "قصة": 1, "قصه": 1, "عشق": 1, "مسلسل": 1,
  "المسلسل": 1, "الحلقة": 1, "الحلقه": 1, "حلقة": 1, "حلقه": 1, "مترجم": 1,
  "مترجمة": 1, "مترجمه": 1, "مدبلج": 1, "مدبلجة": 1, "مدبلجه": 1, "كامل": 1,
  "كاملة": 1, "كامله": 1, "جميع": 1, "الحلقات": 1, "الاول": 1, "الاولى": 1,
  "الثاني": 1, "الثانية": 1, "الثالث": 1, "الرابع": 1, "الخامس": 1
};

function extraQueryTitles(metadata) {
  var base = typeof catalogSearchTitles === "function" ? catalogSearchTitles(metadata) : metadata.titles || [];
  var result = [], seen = {};
  function add(title) {
    var value = String(title || "").replace(/\s+/g, " ").trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    result.push(value);
  }
  var i;
  for (i = 0; i < base.length && i < 8; i++) add(base[i]);
  // Sites differ on the Arabic article ("طائر الرفراف" vs "الطائر الرفراف").
  var variants = 0;
  for (i = 0; i < base.length && variants < 4; i++) {
    var original = String(base[i] || "");
    if (!/^[\u0600-\u06ff]/.test(original)) continue;
    var words = original.split(" ");
    if (!words[0]) continue;
    var variant = words.slice(0);
    if (words[0].indexOf("\u0627\u0644") === 0 && words[0].length > 3) variant[0] = words[0].slice(2);
    else if (words[0].length >= 3) variant[0] = "\u0627\u0644" + words[0];
    else continue;
    add(variant.join(" "));
    variants++;
  }
  var added = 0;
  for (i = 0; i < base.length && added < 6; i++) {
    var title = String(base[i] || "");
    if (!/[\u0600-\u06ff]/.test(title)) continue;
    // Keep the original Arabic spelling (ة/أ) for the site's literal search;
    // normalization is only used to recognize structural stopwords.
    var words = title.replace(/[^\u0600-\u06ff\s]/g, " ").split(" ");
    for (var w = 0; w < words.length && added < 6; w++) {
      var word = words[w];
      if (!/^[\u0600-\u06ff]{3,}$/.test(word) || EXTRA_QUERY_STOPWORDS[normalize(word)] || seen[word]) continue;
      seen[word] = true;
      result.push(word);
      added++;
    }
  }
  return result.slice(0, 12);
}

function qesehSearchQueries(metadata) {
  return extraQueryTitles(metadata).slice(0, 10);
}

function qesehSeriesLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/yeni-show\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    // The Turkish original slug is printed in the URL even when the catalog
    // lists a different Arabic broadcast title (e.g. Kara Para Aşk / العشق المشبوه).
    if (fieldMatchScore(identity + " " + url, metadata.titles) < 80 &&
        !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, title: identity.replace(/\s+/g, " ").trim() });
  });
  return links.slice(0, 3);
}

function qesehEpisodeLinks(html, pageUrl, requests, seriesTitle) {
  var $ = cheerio.load(html), found = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/clarus\/[^\/?]+-episode-(\d+)\/?$/i.test(url)) return;
    var match = url.match(/-episode-(\d+)\/?$/i), number = parseInt(match[1], 10);
    if (!number) return;
    var request = null;
    for (var r = 0; r < requests.length; r++) {
      if (requests[r].episode === number) {
        request = { season: requests[r].season, episode: number, identities: requests[r].identities || requests };
        break;
      }
    }
    if (!request) return;
    var identity = extraAnchorIdentity(a) + " " + url;
    var explicit = explicitSeasonEpisode(identity);
    if (explicit && explicit.season !== request.season) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    found.push({ url: url, request: request, referer: pageUrl, seriesTitle: seriesTitle });
  });
  return found.slice(0, 3);
}

function qesehPlayerUrl(html, pageUrl) {
  var $ = cheerio.load(html), player = "";
  $("a[href]").each(function (_, element) {
    var url = absUrl(wrap($, element).attr("href"), pageUrl);
    if (!player && /^https:\/\/qesen\.net\/watch\/?\?post=/i.test(url)) player = url;
  });
  if (!player) {
    $("iframe[src]").each(function (_, element) {
      var url = absUrl(wrap($, element).attr("src"), pageUrl);
      if (!player && /^https:\/\/qesen\.net\//i.test(url)) player = url;
    });
  }
  return player;
}

function qesehEmbedUrls(html, pageUrl) {
  var $ = cheerio.load(html), urls = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url] || !/^https:\/\/arabhd\.onl\/embed-[a-z0-9]+\.html/i.test(url)) return;
    seen[url] = true;
    urls.push(url);
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("li[data-server]").each(function (_, element) { add(wrap($, element).attr("data-server")); });
  return urls.slice(0, 2);
}

// Qeseh (قصة عشق) keeps the complete archive on its series page. The episode
// page owns a qesen.net player wrapper whose Arab HD iframe unpacks to HLS.
// No guessed episode URLs and no stored tokens: the signed media URL is always
// resolved at request time.

// A catalog can list a different Arabic name than TMDB ("السلطانة كوسم" vs
// "السلطانة قسم") while the URL keeps the Turkish original slug. One distinctive
// slug token is enough to probe the page; the page's own title then becomes an
// alias for the episode checks. Full identity is still enforced by the episode
// number and the owned URLs.
function extraSlugAlias(url, titles) {
  var tokens = String(url || "").toLowerCase().split(/[^a-z0-9]+/).filter(function (token) {
    return token.length >= 5;
  });
  if (!tokens.length) return false;
  for (var i = 0; i < titles.length; i++) {
    var words = normalize(titles[i]).split(" ").filter(function (word) {
      return /^[a-z0-9]{5,}$/.test(word);
    });
    for (var w = 0; w < words.length; w++) if (tokens.indexOf(words[w]) >= 0) return true;
  }
  return false;
}

function qesehCatalogFallback(base, metadata, requests) {
  var pageUrls = [], page;
  for (page = 1; page <= 8; page++) {
    pageUrls.push(page === 1 ? base + "/discover/" : base + "/discover/page/" + page + "/");
  }
  return Promise.all(pageUrls.map(function (url) {
    return fetchTextInfo(url, base + "/", "").catch(function () { return null; });
  })).then(function (pages) {
    var candidates = [], seen = {};
    for (var p = 0; p < pages.length; p++) {
      if (!pages[p]) continue;
      var $ = cheerio.load(pages[p].html);
      $("a[href]").each(function (_, element) {
        var a = wrap($, element), url = absUrl(a.attr("href"), pages[p].url);
        if (!url || originOf(url) !== originOf(pages[p].url) || !/\/yeni-show\//i.test(url)) return;
        var key = extraUrlKey(url);
        if (seen[key]) return;
        var identity = extraAnchorIdentity(a);
        var strong = fieldMatchScore(identity, metadata.titles) >= 80 ||
          (typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles));
        if (!strong && !extraSlugAlias(url, metadata.titles)) return;
        seen[key] = true;
        candidates.push({ url: url, title: identity.replace(/\s+/g, " ").trim(), weak: !strong });
      });
    }
    if (!candidates.length) return [];
    candidates.sort(function (left, right) { return (left.weak ? 1 : 0) - (right.weak ? 1 : 0); });
    return Promise.all(candidates.slice(0, 3).map(function (entry) {
      return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (result) {
        if (!result) return null;
        var heading = cheerio.load(result.html)("h1").first().text() || entry.title;
        return { html: result.html, url: result.url, title: heading };
      });
    })).then(function (seriesPages) {
      seriesPages = seriesPages.filter(Boolean);
      var episodes = [], seenEpisodes = {};
      for (var sp = 0; sp < seriesPages.length; sp++) {
        var list = qesehEpisodeLinks(seriesPages[sp].html, seriesPages[sp].url, requests, seriesPages[sp].title);
        for (var e = 0; e < list.length; e++) {
          var episodeKey = extraUrlKey(list[e].url);
          if (seenEpisodes[episodeKey]) continue;
          seenEpisodes[episodeKey] = true;
          list[e].seriesTitle = seriesPages[sp].title;
          episodes.push(list[e]);
        }
      }
      return Promise.all(episodes.slice(0, 3).map(function (episode) {
        return fetchTextInfo(episode.url, episode.referer, "").catch(function () { return null; }).then(function (result) {
          if (!result) return [];
          var identity = extraPageIdentity(result.html);
          if (extraEpisodeNumber(identity + " " + result.url) !== episode.request.episode) return [];
          var titleOk = extraPageTitleMatches(result.html, metadata);
          if (!titleOk && episode.seriesTitle) titleOk = catalogTitleMatches(identity, [episode.seriesTitle]);
          if (!titleOk) return [];
          var playerUrl = qesehPlayerUrl(result.html, result.url);
          if (!playerUrl) return [];
          return fetchTextInfo(playerUrl, result.url, "").catch(function () { return null; }).then(function (player) {
            if (!player) return [];
            var embeds = qesehEmbedUrls(player.html, player.url);
            if (!embeds.length) return [];
            var streams = [], seenStreams = {};
            return Promise.all(embeds.map(function (embedUrl) {
              return fetchTextInfo(embedUrl, player.url, "").catch(function () { return null; }).then(function (embed) {
                if (!embed) return;
                var entries = mediaEntriesFromHtml(embed.html);
                return Promise.all(entries.map(function (entry) {
                  return addMediaEntry(entry, embed.url, "Arab HD", streams, seenStreams);
                }));
              });
            })).then(function () { return streams; });
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    });
  });
}

function resolveQesehSource(metadata, source, requests) {
  var bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var queries = qesehSearchQueries(metadata);
    return Promise.all(queries.map(function (title) {
      return fetchTextInfo(base + "/?s=" + encodeURIComponent(title), base + "/", "").catch(function () { return null; });
    })).then(function (pages) {
      var series = [], seen = {};
      for (var p = 0; p < pages.length; p++) {
        if (!pages[p]) continue;
        var links = qesehSeriesLinks(pages[p].html, pages[p].url, metadata);
        for (var i = 0; i < links.length; i++) {
          var key = extraUrlKey(links[i].url);
          if (seen[key]) continue;
          seen[key] = true;
          series.push(links[i]);
        }
      }
      return Promise.all(series.slice(0, 2).map(function (entry) {
        return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (page) {
          if (!page) return null;
          var heading = cheerio.load(page.html)("h1").first().text() || entry.title;
          return { html: page.html, url: page.url, title: heading };
        });
      }));
    }).then(function (seriesPages) {
      seriesPages = seriesPages.filter(Boolean);
      var episodes = [], seenEpisodes = {};
      for (var p = 0; p < seriesPages.length; p++) {
        var list = qesehEpisodeLinks(seriesPages[p].html, seriesPages[p].url, requests, seriesPages[p].title);
        for (var i = 0; i < list.length; i++) {
          var key = extraUrlKey(list[i].url);
          if (seenEpisodes[key]) continue;
          seenEpisodes[key] = true;
          list[i].seriesTitle = seriesPages[p].title;
          episodes.push(list[i]);
        }
      }
      return Promise.all(episodes.slice(0, 3).map(function (episode) {
        return fetchTextInfo(episode.url, episode.referer, "").catch(function () { return null; }).then(function (page) {
          if (!page) return [];
          var identity = extraPageIdentity(page.html);
          if (extraEpisodeNumber(identity + " " + page.url) !== episode.request.episode) return [];
          var titleOk = extraPageTitleMatches(page.html, metadata);
          if (!titleOk && episode.seriesTitle) titleOk = catalogTitleMatches(identity, [episode.seriesTitle]);
          if (!titleOk) return [];
          var playerUrl = qesehPlayerUrl(page.html, page.url);
          if (!playerUrl) return [];
          return fetchTextInfo(playerUrl, page.url, "").catch(function () { return null; }).then(function (player) {
            if (!player) return [];
            var embeds = qesehEmbedUrls(player.html, player.url);
            if (!embeds.length) return [];
            var streams = [], seenStreams = {};
            return Promise.all(embeds.map(function (embedUrl) {
              return fetchTextInfo(embedUrl, player.url, "").catch(function () { return null; }).then(function (embed) {
                if (!embed) return;
                var entries = mediaEntriesFromHtml(embed.html);
                return Promise.all(entries.map(function (entry) {
                  return addMediaEntry(entry, embed.url, "Arab HD", streams, seenStreams);
                }));
              });
            })).then(function () { return streams; });
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    }).then(function (streams) {
      if (streams.length) return streams;
      return qesehCatalogFallback(base, metadata, requests);
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase().then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  });
}


function faselhdEpisodeNumber(url, identity) {
  var decoded = String(url || "");
  try { decoded = decodeURIComponent(decoded); } catch (_) {}
  var match = decoded.match(/الحلقة[\s\-_]*(\d{1,4})/i) || decoded.match(/الحلقه[\s\-_]*(\d{1,4})/i);
  if (match) return parseInt(match[1], 10);
  match = String(identity || "").match(/^\s*(\d{1,4})\b/);
  return match ? parseInt(match[1], 10) : NaN;
}

function faselhdSeriesLinks(html, pageUrl, metadata) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/series\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    if (fieldMatchScore(identity, metadata.titles) < 80 &&
        !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    links.push({ url: url, identity: identity.replace(/\s+/g, " ").trim() });
  });
  return links.slice(0, 4);
}

function faselhdEpisodeLinks(html, pageUrl, requests) {
  var $ = cheerio.load(html), episodes = [], seen = {};
  $("a[href]").each(function (_, element) {
    var a = wrap($, element), url = absUrl(a.attr("href"), pageUrl);
    if (!url || originOf(url) !== originOf(pageUrl) || !/\/episode\//i.test(url)) return;
    var identity = extraAnchorIdentity(a);
    var number = faselhdEpisodeNumber(url, identity);
    if (!number) return;
    var request = null;
    for (var r = 0; r < requests.length; r++) {
      if (requests[r].episode === number) {
        request = { season: requests[r].season, episode: number, identities: requests[r].identities || requests };
        break;
      }
    }
    if (!request) return;
    var explicit = explicitSeasonEpisode(identity + " " + url);
    if (explicit && explicit.season !== request.season) return;
    var key = extraUrlKey(url);
    if (seen[key]) return;
    seen[key] = true;
    episodes.push({ url: url, request: request, referer: pageUrl });
  });
  return episodes.slice(0, 3);
}

function faselhdPlayerTargets(html, pageUrl) {
  var $ = cheerio.load(html), targets = [], seen = {};
  function add(value) {
    var url = absUrl(value, pageUrl);
    if (!url || seen[url]) return;
    if (!supportedDirectEmbed(url) && !directMedia(url) && !anaPlayerAllowed(url) && !dailymotionId(url)) return;
    seen[url] = true;
    targets.push(url);
  }
  $("iframe[src], iframe[data-src]").each(function (_, element) {
    var frame = wrap($, element);
    add(frame.attr("src") || frame.attr("data-src"));
  });
  $("video[src], video source[src]").each(function (_, element) {
    add(wrap($, element).attr("src"));
  });
  return targets.slice(0, 4);
}

// FaselHD exposes a small modern Turkish catalog (search is server-side broken),
// so the resolver walks the site's own paginated category and then the series
// episode list. Playback iframes are cdnplus/mp4plus, already supported.
function resolveFaselhdSource(metadata, source, requests) {
  var bases = source.bases || [], baseIndex = 0;
  function nextBase() {
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];
    var catalogUrls = [
      base + "/?fho_cat=turkish-series",
      base + "/?fho_cat=turkish-series&fho_page=2",
      base + "/?fho_cat=turkish-series&fho_page=3"
    ];
    return Promise.all(catalogUrls.map(function (url) {
      return fetchTextInfo(url, base + "/", "").catch(function () { return null; });
    })).then(function (pages) {
      var series = [], seen = {};
      for (var p = 0; p < pages.length; p++) {
        if (!pages[p]) continue;
        var links = faselhdSeriesLinks(pages[p].html, pages[p].url, metadata);
        for (var i = 0; i < links.length; i++) {
          var key = extraUrlKey(links[i].url);
          if (seen[key]) continue;
          seen[key] = true;
          series.push(links[i]);
        }
      }
      return Promise.all(series.slice(0, 3).map(function (entry) {
        return fetchTextInfo(entry.url, base + "/", "").catch(function () { return null; }).then(function (page) {
          if (!page) return [];
          var identity = extraPageIdentity(page.html);
          if (!extraPageTitleMatches(page.html, metadata) &&
              !(typeof catalogTitleMatches === "function" && catalogTitleMatches(identity, metadata.titles))) return [];
          var episodes = faselhdEpisodeLinks(page.html, page.url, requests);
          return Promise.all(episodes.slice(0, 2).map(function (episode) {
            return fetchTextInfo(episode.url, page.url, "").catch(function () { return null; }).then(function (episodePage) {
              if (!episodePage) return [];
              var episodeIdentity = extraPageIdentity(episodePage.html);
              if (extraEpisodeNumber(episodeIdentity + " " + episodePage.url) !== episode.request.episode) return [];
              var targets = faselhdPlayerTargets(episodePage.html, episodePage.url);
              var streams = [], seenStreams = {};
              return Promise.all(targets.map(function (target) {
                return resolveEmbedTarget({ url: target, referer: episodePage.url, label: "Main" }, episode.request, streams, seenStreams);
              })).then(function () { return streams; });
            });
          })).then(function (parts) {
            var result = [];
            for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
            return result;
          });
        });
      })).then(function (parts) {
        var result = [];
        for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
        return result;
      });
    }).then(function (streams) { return streams.length ? streams : nextBase(); });
  }
  return nextBase().then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  });
}


// Dailymotion's public search API needs no key and the player metadata exposes
// the real HLS variants (up to 4K). Arabic-subtitled Turkish episodes are
// matched by the video title itself, so no catalog markup is involved.
function dailymotionSearchQuery(title, episode) {
  var clean = String(title || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (/[\u0600-\u06ff]/.test(clean)) return clean + " الحلقة " + episode + " مترجم";
  return clean + " episode " + episode + " arabic sub";
}

function dailymotionVideoId(url) {
  var match = String(url || "").match(/dailymotion\.com\/video\/([A-Za-z0-9]+)/i);
  return match ? match[1] : "";
}

function resolveDailymotionSource(metadata, source, requests) {
  var titles = extraQueryTitles(metadata).slice(0, 6);
  var queries = [], seenQuery = {};
  for (var r = 0; r < requests.length; r++) {
    for (var t = 0; t < titles.length; t++) {
      var query = dailymotionSearchQuery(titles[t], requests[r].episode);
      if (!query || seenQuery[query]) continue;
      seenQuery[query] = true;
      queries.push({ query: query, request: requests[r] });
      if (queries.length >= 6) break;
    }
    if (queries.length >= 6) break;
  }
  if (!queries.length) return Promise.resolve([]);
  return Promise.all(queries.map(function (entry) {
    var url = "https://api.dailymotion.com/videos?search=" + encodeURIComponent(entry.query) +
      "&limit=20&sort=relevance&fields=id,title,duration,url";
    return fetchJson(url, "https://www.dailymotion.com/", "https://www.dailymotion.com")
      .catch(function () { return null; })
      .then(function (data) { return { videos: data && data.list || [], request: entry.request }; });
  })).then(function (groups) {
    var candidates = [], seen = {};
    for (var g = 0; g < groups.length; g++) {
      var videos = groups[g].videos, request = groups[g].request;
      for (var v = 0; v < videos.length; v++) {
        var video = videos[v];
        if (!video || !video.id || seen[video.id]) continue;
        var title = String(video.title || "");
        if (!title) continue;
        if (fieldMatchScore(title, metadata.titles) < 80 && !catalogTitleMatches(title, metadata.titles)) continue;
        if (/مدبلج|dublaj|dubbed/i.test(title)) continue;
        var explicit = explicitSeasonEpisode(title);
        if (explicit && explicit.season !== request.season) continue;
        var number = extraEpisodeNumber(title);
        if (number !== request.episode) continue;
        seen[video.id] = true;
        candidates.push({ id: video.id, title: title, request: request });
      }
    }
    candidates = candidates.slice(0, 3);
    var streams = [], seenStreams = {};
    return Promise.all(candidates.map(function (candidate) {
      var url = "https://www.dailymotion.com/video/" + candidate.id;
      return resolveDailymotion(url, "https://www.dailymotion.com/", "Main", streams, seenStreams).catch(function () {});
    })).then(function () { return streams; });
  }).then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  }).catch(function () { return []; });
}


function okruHtmlDecode(value) {
  return String(value || "")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*34;/gi, "\"")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#0*39;|&apos;/gi, "'");
}

function okruEpisodeNumber(title) {
  var number = extraEpisodeNumber(title);
  if (number) return number;
  var match = String(title || "").match(/(\d{1,3})\s*[-–—]\s*(\d{1,3})\b/);
  if (match) return parseInt(match[2], 10);
  match = String(title || "").match(/(?:^|\s)(\d{1,3})\s*(?:\.|$)/);
  return match ? parseInt(match[1], 10) : NaN;
}

function okruMediaUrl(html) {
  var decoded = okruHtmlDecode(html);
  var match = decoded.match(/"hlsManifestUrl":"(https?:\/\/[^"]+)"/);
  var url = match ? match[1] : "";
  if (!url) match = decoded.match(/"metadataMp4Url":"(https?:\/\/[^"]+)"/);
  if (!url && match) url = match[1];
  return url ? url.replace(/\\u0026/gi, "&").replace(/\\\//g, "/") : "";
}

function resolveOkruSource(metadata, source, requests) {
  var titles = extraQueryTitles(metadata).slice(0, 5);
  var queries = [], seenQuery = {};
  for (var r = 0; r < requests.length && queries.length < 4; r++) {
    for (var t = 0; t < titles.length && queries.length < 4; t++) {
      var title = String(titles[t] || "").trim();
      if (!title) continue;
      var query = /[\u0600-\u06ff]/.test(title) ? title + " الحلقة " + requests[r].episode + " مترجم" : title + " " + requests[r].episode + " arabic";
      if (seenQuery[query]) continue;
      seenQuery[query] = true;
      queries.push({ query: query, request: requests[r] });
    }
  }
  if (!queries.length) return Promise.resolve([]);
  return Promise.all(queries.map(function (entry) {
    var url = "https://ok.ru/video/search?st.v.sq=" + encodeURIComponent(entry.query);
    return fetchTextInfo(url, "https://ok.ru/", "").catch(function () { return null; }).then(function (page) {
      if (!page) return { ids: [], request: entry.request };
      var ids = [], seen = {};
      var re = /\/video\/(\d{8,})/g, match;
      while ((match = re.exec(page.html)) !== null && ids.length < 6) {
        if (seen[match[1]]) continue;
        seen[match[1]] = true;
        ids.push(match[1]);
      }
      return { ids: ids, request: entry.request };
    });
  })).then(function (groups) {
    var candidates = [], seenIds = {};
    for (var g = 0; g < groups.length; g++) {
      for (var i = 0; i < groups[g].ids.length && candidates.length < 6; i++) {
        var id = groups[g].ids[i];
        if (seenIds[id]) continue;
        seenIds[id] = true;
        candidates.push({ id: id, request: groups[g].request });
      }
    }
    return Promise.all(candidates.slice(0, 6).map(function (candidate) {
      var pageUrl = "https://ok.ru/video/" + candidate.id;
      return fetchTextInfo(pageUrl, "https://ok.ru/", "").catch(function () { return null; }).then(function (page) {
        if (!page) return [];
        var title = (page.html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
        title = okruHtmlDecode(title).replace(/\s+/g, " ").trim();
        if (!title) return [];
        if (fieldMatchScore(title, metadata.titles) < 80 && !catalogTitleMatches(title, metadata.titles)) return [];
        if (/مدبلج|dublaj|dubbed/i.test(title)) return [];
        var explicit = explicitSeasonEpisode(title);
        if (explicit && explicit.season !== candidate.request.season) return [];
        var number = okruEpisodeNumber(title);
        if (number !== candidate.request.episode) return [];
        var mediaUrl = okruMediaUrl(page.html);
        if (!mediaUrl) return [];
        var streams = [], seenStreams = {};
        return addMediaEntry({ url: mediaUrl, quality: "" }, pageUrl, "Main", streams, seenStreams).then(function () { return streams; });
      });
    })).then(function (parts) {
      var result = [];
      for (var i = 0; i < parts.length; i++) result = result.concat(parts[i]);
      return result;
    });
  }).then(function (streams) {
    var result = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/, source.name);
      streams[i].provider = source.name;
      streams[i].language = "ar";
      result.push(streams[i]);
    }
    return result;
  }).catch(function () { return []; });
}

function resolveExtraSource(metadata, source, requests) {
  if (source.search === "3ick") return resolve3ickSource(metadata, source, requests);
  if (source.search === "qeseh") return resolveQesehSource(metadata, source, requests);
  if (source.search === "faselhd") return resolveFaselhdSource(metadata, source, requests);
  if (source.search === "dailymotion") return resolveDailymotionSource(metadata, source, requests);
  if (source.search === "okru") return resolveOkruSource(metadata, source, requests);
  var bases = source.bases || [], baseIndex = 0, triedBases = {};
  function nextBase() {
    while (baseIndex < bases.length && triedBases[bases[baseIndex]]) baseIndex++;
    if (baseIndex >= bases.length) return Promise.resolve([]);
    var base = bases[baseIndex++];triedBases[base] = true;
    var seenPages = {}, seenEpisodes = {};
    function fetchPages(requestsToFetch) {
      return Promise.all(requestsToFetch.map(function (request) {
        var key = request.url + " " + (request.body || "");
        if (seenPages[key]) return Promise.resolve(null);
        seenPages[key] = true;
        return extraFetchCatalog(request,base + "/").catch(function (error) {
          logFailure("extra_catalog_failed",source.name + " " + errorMessage(error));return null;
        });
      }));
    }
    function scan(pages, depth) {
      var episodes = [], series = [], pagination = [], seenSeries = {};
      for (var p = 0; p < pages.length; p++) {
        var page = pages[p]; if (!page) continue;
        var self = extraPageIdentity(page.html);
        var seriesVerified = extraPageTitleMatches(page.html,metadata) && !extraEpisodeNumber(self);
        var links = extraCatalogLinks(page.html,page.url,metadata,requests,seriesVerified);
        for (var i = 0; i < links.length; i++) {
          if (links[i].request && !seenEpisodes[extraUrlKey(links[i].url)]) {
            seenEpisodes[extraUrlKey(links[i].url)] = true;
            episodes.push({candidate:links[i],referer:page.url});
          } else if (!links[i].request && !seenSeries[extraUrlKey(links[i].url)]) {
            seenSeries[extraUrlKey(links[i].url)] = true;series.push({url:links[i].url});
          }
        }
        var last = extraLastCatalogPage(page.html,page.url,requests);
        if (last && extraUrlKey(last) !== extraUrlKey(page.url)) pagination.push({url:last});
        var next = extraNextCatalogPage(page.html,page.url);
        if (next && next !== last) pagination.push({url:next});
      }
      return Promise.all(episodes.slice(0,4).map(function (item) {
        return extraResolveEpisode(item.candidate,metadata,requests,item.referer);
      })).then(function (parts) {
        var result = [];for (var n = 0; n < parts.length; n++) result = result.concat(parts[n]);
        if (result.length || depth >= 3) return result;
        // Series links are owned by the catalog and must still match the show.
        // Search pagination follows only a page-owned next-page link.
        var nextRequests = series.slice(0,3).concat(pagination.slice(0,2));
        if (!nextRequests.length) return [];
        return fetchPages(nextRequests).then(function (nextPages) {return scan(nextPages,depth + 1);});
      });
    }
    // Current episodes stay cheap. Archive searches use the source's actual
    // public form/API with Arabic, Turkish, English and accentless aliases.
    return fetchPages([{url:base + "/"}]).then(function (pages) {
      if (pages[0] && originOf(pages[0].url)) {base=originOf(pages[0].url);triedBases[base]=true;}
      return scan(pages,0);
    }).then(function (streams) {
      if (streams.length) return streams;
      return fetchPages(extraSearchRequests(metadata,source,base,requests)).then(function (pages) {return scan(pages,0);});
    }).then(function (streams) {return streams.length ? streams : nextBase();});
  }
  return nextBase().then(function (streams) {
    if (streams.length || source.search !== "php") return streams;
    return resolvePhpCategoryArchive(metadata, source, requests);
  }).then(function (streams) {
    var deduped = [], seen = {};
    for (var i = 0; i < streams.length; i++) {
      if (seen[streams[i].url]) continue;
      seen[streams[i].url] = true;
      streams[i].name = String(streams[i].name || "Krmizi").replace(/^Krmizi/,source.name);
      streams[i].title = String(streams[i].title || "Krmizi").replace(/^Krmizi/,source.name);
      streams[i].provider = source.name;
      if (source.language) streams[i].language = source.language;
      deduped.push(streams[i]);
    }
    return deduped;
  });
}

