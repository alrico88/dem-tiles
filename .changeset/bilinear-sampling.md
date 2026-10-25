---
"dem-tiles": minor
---

Adds `sampling: "bilinear"`, which interpolates the four nearest pixel heights across tile boundaries and the antimeridian. Median sampling is about 3x faster and no longer depends on `math-helper-functions`.
