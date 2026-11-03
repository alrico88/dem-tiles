---
"dem-tiles": patch
---

`dem-tiles/decoder` now imports `fast-png` lazily on the first PNG tile, like `@jsquash/webp` for WebP. Previously the static import meant WebP-only users still had to install `fast-png` or their bundler failed.
