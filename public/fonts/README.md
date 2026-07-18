# Noto Sans KR Font Assets

These files are vendored from `@fontsource/noto-sans-kr` version 5.2.9:

- Package: https://www.npmjs.com/package/@fontsource/noto-sans-kr/v/5.2.9
- Upstream font: Noto Sans KR, Google Inc.
- License: SIL Open Font License 1.1, reproduced in `OFL-1.1.txt`
- Distribution source: jsDelivr's immutable npm package URL

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `noto-sans-kr-korean-400-normal.woff2` | 541864 | `3aa0d1d63f3b5b2a33053a41a34512eac63abfb1dc2112aeda04733656a1a6d9` |
| `noto-sans-kr-korean-700-normal.woff2` | 559192 | `dab3d492daa687386292cff1499225db580f931f800ee0d124eb0636378c6020` |

The application serves these files locally. It makes no runtime request to Google Fonts, Fontsource, jsDelivr, or another font CDN.

`fonts.css` uses project-relative `./noto-sans-kr-…` URLs. Together with the relative HTML stylesheet/preload URLs, this keeps the built site deployable under a GitHub Pages repository subpath when Vite uses `base: "./"`.
