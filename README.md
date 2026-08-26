# My Nuvio Providers

Private/custom provider list for Nuvio.

## Included providers

- **Krmizi | قرمزي** — TV series provider for `https://krmizi.onl/`

## Install in Nuvio

After uploading these files to the `main` branch of:

`renoomon/my-nuvio-providers`

add this URL in **Nuvio → Settings → Plugins**:

`https://raw.githubusercontent.com/renoomon/my-nuvio-providers/refs/heads/main/manifest.json`

Then refresh plugins and enable **Krmizi | قرمزي**.

## Files

- `manifest.json`
- `providers/krmizi.js`

## Notes

This is an initial provider version. Krmizi may change HTML selectors or its player/server layout at any time. If Nuvio shows no streams, capture the Nuvio plugin log/error and update the provider selectors.
