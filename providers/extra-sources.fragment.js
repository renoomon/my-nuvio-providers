/* Additional catalog adapters. Concatenate into krmizi.js: no extra runtime require.
 * These are separately searched catalogs, not a claim of independent ownership.
 * A source contributes only episode-owned, identity-checked, validated media.
 */
var EXTRA_SOURCES = [
  { name: "3skNews", bases: ["https://q.3sk.news", "https://f1.q3sk.monster"], strategy: "extra" },
  { name: "DDizi", bases: ["https://www.ddizi.im", "https://www.ddizi.tel"], strategy: "extra", language: "tr", search: "ddizi" },
  { name: "TVDiziler", bases: ["https://tvdiziler.tv"], strategy: "extra", language: "tr", search: "tvajax" },
  { name: "NOW", bases: ["https://www.nowtv.com.tr"], strategy: "extra", official: "now", language: "tr" },
  { name: "Shahid4U", bases: ["https://sh4u.buzz"], strategy: "extra", search: "php" },
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
  heading = heading.replace(/\s+الاصلي\s+(?:HD)?\s*$/i,"");
  return typeof catalogTitleMatches === "function" && catalogTitleMatches(heading,metadata.titles);
}

function threeickLinks(page, metadata, requests, verifiedSeries) {
  var $ = cheerio.load(page.html), series = [], episodes = [], seen = {};
  $("a[href]").each(function(_,element) {
    var a = wrap($,element), url = threeickOwnedUrl(a.attr("href"),page.url), identity = extraAnchorIdentity(a);
    if (!url || seen[url] || /mudblij|مدبلج|اعلان|إعلان|trailer|fragman/i.test(url + " " + identity)) return;
    if (/\/watch\/tvshows\//i.test(url) && fieldMatchScore(identity,metadata.titles) >= 80) {
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
      var titles = typeof catalogSearchTitles === "function" ? catalogSearchTitles(metadata) : metadata.titles;
      function scan(page, verified) {
        var links = threeickLinks(page,metadata,requests,verified);
        var jobs = links.episodes.filter(function(candidate){if(seenEpisodes[candidate.url])return false;seenEpisodes[candidate.url]=true;return true;}).map(function(candidate){return threeickResolveEpisode(candidate,metadata,requests,session,page.url);});
        if (!verified) jobs = jobs.concat(links.series.map(function(url) {
          return session.get(url,page.url).then(function(series) {return threeickTitleMatches(series.html,metadata) ? scan(series,true) : [];}).catch(function(){return [];});
        }));
        return Promise.all(jobs).then(function(parts) {var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;});
      }
      return Promise.all(titles.slice(0,6).map(function(title) {
        return session.get(originOf(home.url) + "/?s=" + encodeURIComponent(title),home.url).then(function(page){return scan(page,false);}).catch(function(){return [];});
      })).then(function(parts) {var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;});
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
  var titles = typeof catalogSearchTitles === "function" ? catalogSearchTitles(metadata) : metadata.titles || [];
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
    if (source.search === "ddizi") return {url:base + "/arama/",method:"POST",body:"arama=" + encodeURIComponent(title)};
    if (source.search === "tvajax") return {url:base + "/search?qr=" + encodeURIComponent(title),method:"POST",body:"",jsonHtml:true};
    return {url:base + (source.search === "php" ? "/search.php?keywords=" : "/?s=") + encodeURIComponent(title)};
  });
}

function extraFetchCatalog(request, referer) {
  if (!request.method || request.method === "GET") return fetchTextInfo(request.url, referer, "");
  var headers = requestHeaders(referer, originOf(referer), request.jsonHtml ? "application/json,text/plain,*/*" : "text/html,*/*");
  headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
  if (request.jsonHtml) headers["X-Requested-With"] = "XMLHttpRequest";
  var job = fetch(request.url,{method:request.method,headers:headers,body:request.body,skipSizeCheck:true}).then(function (response) {
    if (!response || !response.ok) throw new Error("http_" + (response ? response.status : "no_response"));
    return response.text().then(function (body) {
      if (isChallenge(body)) throw new Error("cloudflare_challenge");
      if (request.jsonHtml) {
        try { var data = JSON.parse(body); body = data.success && typeof data.data === "string" ? data.data : ""; }
        catch (_) { body = ""; }
      }
      return {html:String(body || ""),url:response.url || request.url,status:response.status};
    });
  });
  return typeof withDeadline === "function" ? withDeadline(job,8000,"catalog_search_timeout") : job;
}

function extraNextCatalogPage(html, pageUrl) {
  var $ = cheerio.load(html), current = String(pageUrl).match(/(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
  var currentNumber = current ? parseInt(current[1],10) : 1, next = "";
  var ddizi = /\/sayfa-\d+/i.test(html), ddCurrent = String(pageUrl).match(/\/sayfa-(\d+)/i);
  if (ddizi) currentNumber = ddCurrent ? parseInt(ddCurrent[1],10) : 0;
  $("a[rel=next], .pagination a[href], .wp-pagenavi a[href], .page-numbers[href]").each(function (_,element) {
    var a = wrap($,element), url = absUrl(a.attr("href"),pageUrl);
    if (originOf(url) !== originOf(pageUrl)) return;
    var number = url.match(ddizi ? /\/sayfa-(\d+)/i : /(?:[?&](?:page|paged)=|\/page\/)(\d+)/i);
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
    var url = absUrl(wrap($,element).attr("href"),pageUrl), number = url.match(/(?:[?&](?:page|paged)=|\/page\/|\/sayfa-)(\d+)/i);
    if (originOf(url) === originOf(pageUrl) && number && parseInt(number[1],10) > highest) {highest=parseInt(number[1],10);last=url;}
  });
  return last;
}

function resolveExtraSource(metadata, source, requests) {
  if (source.official === "now") return resolveNowSource(metadata, source, requests);
  if (source.search === "3ick") return resolve3ickSource(metadata, source, requests);
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
    } else if (/\/[^/]+\/izle\/?$/i.test(path) || /^https:\/\/www\.nowtv\.com\.tr\/[^/?]+\/?$/i.test(path)) {
      series.push(url); seen[extraUrlKey(url)] = true;
    }
  });
  return { series: series.slice(0, 2), episodes: episodes.slice(0, 2) };
}

function nowResolveEpisode(candidate, metadata) {
  return fetchTextInfo(candidate.url, "https://www.nowtv.com.tr/", "").then(function (page) {
    var identity = extraPageIdentity(page.html);
    if (!extraPageTitleMatches(page.html, metadata) || extraEpisodeNumber(identity) !== candidate.request.episode) return [];
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

function nowArchiveLinks(html, pageUrl) {
  var $ = cheerio.load(html), links = [], seen = {};
  $("a[href]").each(function (_,element) {
    var url = absUrl(wrap($,element).attr("href"),pageUrl);
    if (originOf(url) !== "https://www.nowtv.com.tr" || !/\/(?:dizi-izle|dizi-arsivi|arsiv)\/?$/i.test(url) || seen[url]) return;
    seen[url]=true;links.push(url);
  });
  return links.slice(0,3);
}

function resolveNowSource(metadata, source, requests) {
  function resolveCatalog(page) {
    var links = nowOwnedLinks(page.html,page.url,metadata,requests);
    var jobs = links.episodes.map(function (candidate) {return nowResolveEpisode(candidate,metadata);});
    var seriesJobs = (links.episodes.length ? [] : links.series).map(function (url) {
      return fetchTextInfo(url,page.url,"").then(function (series) {
        if (!extraPageTitleMatches(series.html,metadata)) return [];
        var own = nowOwnedLinks(series.html,series.url,metadata,requests);
        return Promise.all(own.episodes.map(function (candidate) {return nowResolveEpisode(candidate,metadata);})).then(function (parts) {
          var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;
        });
      }).catch(function(){return [];});
    });
    return Promise.all(jobs.concat(seriesJobs)).then(function(parts){
      var result=[],seen={};
      for(var i=0;i<parts.length;i++)for(var p=0;p<parts[i].length;p++)if(!seen[parts[i][p].url]){seen[parts[i][p].url]=true;result.push(parts[i][p]);}
      return result;
    });
  }
  return fetchTextInfo("https://www.nowtv.com.tr/","","").then(function(home){
    return resolveCatalog(home).then(function(streams){
      if(streams.length)return streams;
      return Promise.all(nowArchiveLinks(home.html,home.url).map(function(url){
        return fetchTextInfo(url,home.url,"").then(resolveCatalog).catch(function(){return [];});
      })).then(function(parts){var result=[];for(var i=0;i<parts.length;i++)result=result.concat(parts[i]);return result;});
    });
  }).catch(function(error){logFailure("official_source_failed","NOW "+errorMessage(error));return [];});
}
