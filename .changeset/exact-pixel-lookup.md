---
"dem-tiles": major
---

Constructors now take `(url, options)`: `tileSize` is removed (the decoded image size is used) and `minzoom`, `maxzoom` and `tms` move into options. `tileCache` values are now `DecodedTile`, and undecodable tiles reject instead of resolving to `undefined`. Adds a pluggable `decode` option.

Fixes TMS lookups, low-zoom and tile-edge pixel errors, rejected `.pngraw`/extensionless URLs, color-managed decoding altering RGB values, uncached 404s and mismatched tile sizes.
