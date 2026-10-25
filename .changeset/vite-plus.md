---
"dem-tiles": patch
---

Builds with Vite+ (`vp pack`). `require("dem-tiles")` now loads a real CommonJS build instead of a UMD file Node treated as ESM. The UMD build stays available for CDNs as `dist/index.umd.js`, and type declarations keep their JSDoc.
