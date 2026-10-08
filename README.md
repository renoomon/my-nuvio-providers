# My Nuvio Providers

Custom provider list for Nuvio, with **Krmizi | قرمزي** for Turkish TV series.

## Install the fixed version

Release **1.6.0**, provider **0.9.0**, is available on a separate branch. In **Nuvio → Settings → Plugins**, replace the existing repository URL with:

```text
https://raw.githubusercontent.com/renoomon/my-nuvio-providers/refs/heads/fix/latest-episodes-quality-2026-10-08/manifest.json
```

Refresh plugins and enable **Krmizi | قرمزي**. Use one version of this provider at a time because both versions have the same provider ID.

## What changed

- Converts TMDB season/episode requests to Krmizi's continuous episode numbering using the complete episode counts of previous seasons. For example, **Yeraltı / تحت الأرض S02E01 → episode 17** after season one's 16 episodes.
- Checks further pages of the series index and the selected series' episode list.
- Supports the current `cdnplus.sbs` player and server links with additional query parameters.
- Reads actual HLS playlist resolutions and puts the highest available quality first. Unknown quality remains unlabeled; no rendition URLs or 4K labels are fabricated.
- Preserves a primary-player fallback when listed servers fail.

The episode page must still link to the verified series, and conflicting episode identities are rejected. If previous-season metadata is unavailable, explicit season/episode links can still work; the provider does not substitute a season-one episode.

## Backup and rollback

The original **1.5.0 / provider 0.8.0** was preserved before editing at commit:

```text
880c07797b66fa3ee511737537feb08306060b6e
```

Backup branch: [backup/before-episode-fix-2026-10-08](https://github.com/renoomon/my-nuvio-providers/tree/backup/before-episode-fix-2026-10-08).

To return to the backed-up version, replace the Nuvio plugin URL with:

```text
https://raw.githubusercontent.com/renoomon/my-nuvio-providers/refs/heads/backup/before-episode-fix-2026-10-08/manifest.json
```

Then refresh plugins. The fixed version is isolated from `main` so the existing installation URL continues to serve the previous version until the changes are merged.

## Validation

```sh
npm ci --ignore-scripts
npm test
```

Tests cover season offsets, first-season compatibility, missing metadata, pagination, incorrect episode/series/player identities, current player hosts, actual HLS resolutions, signed relative URLs, and primary-player fallback.

Live verification on **2026-10-08** for **Yeraltı S02E01**, TMDB `309328`, found six streams, including **1080p** and **720p**. The 1080p playlist returned HTTP 200 and a 1,024-byte video segment probe returned HTTP 206 with MPEG-TS sync bytes. This was a provider/network check; playback in the user's Nuvio app has not been tested.

Availability and maximum quality depend on the source. New episodes become accessible once Krmizi publishes them; source HTML changes or Cloudflare challenges may require a later update. No signed media URLs are stored in the repository.
