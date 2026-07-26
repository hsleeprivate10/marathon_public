# Marathon Calendar Design System

## 1. Atmosphere & Identity

Marathon Calendar is a calm public timetable: neutral and precise like a well-made schedule, with race details carrying the color. The signature is a dense but breathable monthly grid that expands into readable event cards on small screens.

## 2. Color

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Surface primary | `--surface-primary` | `#f8f8f6` | `#161615` | Page canvas |
| Surface elevated | `--surface-elevated` | `#ffffff` | `#222220` | Calendar and controls |
| Surface muted | `--surface-muted` | `#efefeb` | `#2b2b28` | Weekends and metadata |
| Text primary | `--text-primary` | `#242424` | `#f5f5f2` | Headings and body |
| Text secondary | `--text-secondary` | `#686863` | `#b8b8b0` | Supporting information |
| Accent | `--accent` | `#0b7a53` | `#4ccc98` | Links, focus, open registration |
| Warning | `--warning` | `#a2580d` | `#f0ad55` | Closing registration |
| Quiet | `--quiet` | `#777772` | `#a0a09a` | Closed/unknown status |
| Danger | `--danger` | `#b43a35` | `#ff8c86` | Partial collection notice |

Use color only with text or icons that state the same meaning. There are no decorative gradients.

## 3. Typography

Primary UI font: locally served `"Noto Sans KR"`, then `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`. The Korean 400 and 700 WOFF2 faces are vendored under `public/fonts/` with their SIL OFL-1.1 license; no third-party font request is allowed at runtime.

Korean prose, freshness text, and mobile race text keep words and particles intact. Safe overflow wrapping may break only otherwise uncontainable text; grid-width race titles remain single-line ellipses.

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| Display | 36–56px responsive | 700 | Page title |
| H2 | 24px | 700 | Month heading |
| Event title | 13px grid, 14px mobile | 700 | Race card title |
| Body | 16px | 400 | Default copy |
| Small | 14px | 400 count, 600 labels | Result count and filter labels |
| Event metadata | 11px | 400 | Mobile race venue and status |
| Caption | 12px | 700 | Eyebrow, weekday, and date labels |

## 4. Spacing & Layout

The base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px.

Content is constrained to 1200px. At 375px the calendar becomes an event-only list that hides dates without races; at 768px it becomes a full-width seven-column grid; at 1024px filters sit beside the schedule.

## 5. Components

### Month Navigation
- Structure: previous button, month heading, next button.
- Surface: previous uses shared navy and next uses shared orange so direction remains legible without relying on iconography; both use the pill radius.
- States: default/hover/active/focus-visible; buttons remain at least 44px tall and use the shared navy/orange ramps.
- Accessibility: buttons have Korean aria labels and keyboard activation.

### Filter Bar
- Structure: labeled selects for region, distance, and registration state, plus a reset action.
- Course order: `전체 코스`, `풀`, `하프`, `10K`, `5K` only.
- Containment: controls use `min-width: 0` and fill their grid track so long Korean labels cannot overlap the calendar.
- States: default/focus/disabled.
- Accessibility: every control has a visible label; filtering never relies on color.

### Calendar Cell and Event Card
- Structure: date number, event links with status text, optional overflow count. At grid widths, event cards show only the title; venue and status stay in the accessible link label and remain visible in the mobile list. All grid-width titles use a single-line ellipsis to prevent narrow cells from breaking Korean words vertically.
- States: default/focus/hover. Links retain visible focus outlines.
- Accessibility: date cells use labelled sections; event links include name, date, venue, and status.

### Freshness Notice
- Structure: generated timestamp; when collection is partial, the text also names each failed source ID.
- Homepage placement: visually follows the year/month selector controls on its own line at every supported viewport.
- States: normal and partial-collection warning.
- Accessibility: partial failures use `role="status"` and name failed sources in text.
- Public naming: adapter IDs never appear in UI. Known IDs map to stable Korean source names; unknown IDs collapse to `기타 일정 출처`.

### Homepage Header
- Structure: a full-width `--hero-navy-deep` header containing a home-link wordmark, primary navigation, and a visible read-only race-search preview, all aligned to `--homepage-content-max` with `--homepage-gutter`. Header controls use text or SVG icons, never icon-only meaning without an accessible name.
- States: default, hover, active/current-page, focus-visible, read-only-search, and menu-open. Current navigation uses `aria-current="page"` plus a visible underline or weight change; hover alone never carries selection meaning.
- Responsive behavior: desktop keeps the wordmark, navigation, and search in one row with 44px minimum targets. Below 768px, retain the wordmark and essential controls, move navigation into one labelled menu control, and open the menu in document flow or an accessible overlay without horizontal overflow or covering the hero CTA.
- Accessibility: include a first-focus skip link to main content, a labelled primary `nav`, a labelled search field, logical DOM/tab order, Escape-to-close for an open menu, focus return to its trigger, and WCAG AA contrast for every header state.

### Homepage Navy Hero
- Structure: full-width navy field with a left-aligned eyebrow, the Homepage Current Weather panel as the primary information and page heading, a primary orange CTA, and right-weighted decorative `public/logo2.png` artwork. The former `달릴 날을 정하는 선명한 방법` headline and supporting race-guide sentence are not rendered.
- Layout: use `--homepage-content-max` and `--homepage-gutter`; desktop weather/CTA content occupies no more than 52% of the hero and the focal logo image remains fully visible on the right. The weather panel stays in the left copy column at every width and never overlays the header logo or hero logo image. At narrow widths, weather and actions precede the contained artwork without horizontal overflow.
- Surface: the outer hero remains `--hero-navy` with `--hero-scrim`, while the inner hero canvas is transparent so `public/logo2.png` blends directly over the navy field. The logo is a transparent RGBA cutout, so the hero art shadow follows the visible alpha silhouette rather than a rectangular white canvas.
- States: the hero itself is static; only its actions receive hover, active, focus-visible, and disabled states.
- Accessibility: the hero image is decorative `public/logo2.png` with `alt=""` and `aria-hidden="true"`. Text and controls meet WCAG AA against every part of the image treatment.

### Homepage Current Weather
- Structure: a prominent `오늘의 달리기 날씨` region in the hero copy column. Its title is the page `h1`; it shows the resolved city and district, condition, current and apparent temperatures, humidity, cloud cover, precipitation, wind direction and speed, US AQI, PM2.5, PM10, observation time, and visible `Open-Meteo`/`OpenStreetMap` source links without replacing the hero logo artwork or primary CTA.
- Location policy: after an in-panel disclosure is rendered, request low-accuracy browser geolocation once per application session with a bounded timeout and a ten-minute cache allowance. Permission denial, timeout, unavailable position, or unsupported geolocation falls back to fixed Seoul City Hall coordinates and the known label `서울특별시 중구 · 서울 기준`. Successful coordinates are rounded to two decimal places before weather, air-quality, and city lookup requests and are never rendered, persisted, or logged. The current-position city and district come from one Korean-language OpenStreetMap Nominatim reverse lookup at city/borough detail; a city lookup failure leaves the panel at `현재 위치` without blocking weather.
- External-service policy: Open-Meteo forecast is required for the ready state. Open-Meteo air quality and OpenStreetMap Nominatim city lookup fail independently and degrade only their own measurements. Nominatim is called at most once per application session, only after a user-triggered page load and successful browser location, with a valid browser Referer and visible OpenStreetMap attribution; the fixed Seoul fallback does not call Nominatim. If traffic can no longer remain well below the public service limit, move the endpoint behind a cache/proxy or replace the provider.
- Surface: use glass `--hero-control-surface` with `backdrop-filter: blur(12px)`, `--hero-control-border`, `--hero-text`, `--hero-text-muted`, `--hero-accent`, `--radius-card`, and `--hero-art-shadow` preserving the translucent navy card material, readable text hierarchy, border, radius, and panel shadow. Weather condition icons are inline semantic SVG line art; emoji and third-party icon fonts are not allowed.
- States: loading reserves the final panel footprint, ready exposes every available measurement, missing air quality renders `정보 없음` in its measurement slot, and unavailable replaces the required forecast measurements with an honest short message. City lookup and air-quality failures never change a valid forecast into unavailable; location fallback is a ready state, not an error state.
- Responsive behavior: desktop and tablet keep the panel in the left copy column with the complete hero logo artwork in the right visual column. At 375px the copy column, CTA, and then artwork stack in document order. The panel width is `min(100%, calc(var(--space-10) * 11))`, so narrow widths remain contained and no header or artwork overlap is allowed.
- Accessibility: the region has the label `현재 날씨`, uses `aria-live="polite"` for asynchronous updates, includes visible units, and states whether values use current position or Seoul fallback. Weather condition and location never rely on icon or color alone.

### Orange Primary CTA
- Structure: short action label with an optional leading SVG icon; minimum height `--control-height`, horizontal padding `--cta-padding-inline`, and radius `--radius-pill`.
- Color: `--cta-orange` fill with `--cta-text`; hover uses the visibly deeper `--cta-orange-hover` (`#8f2708`) and a 2px lift, active uses `--cta-orange-active`, and focus-visible uses the existing `--accent` outline outside the button edge. White on every orange state remains above 4.5:1.
- States: default, hover, active, focus-visible, disabled, and loading. Loading preserves the label width and exposes a textual accessible name.
- Accessibility: never use orange as the only indication of state; touch target remains at least 44px square.

### Homepage Visual Filters
- Structure: one elevated white surface containing visibly labeled region, course, and registration previews plus reset. All four controls are visible and disabled until later product approval. Compact trigger styling may visually resemble the reference's rounded filter controls without implying active filtering.
- Course order remains `전체 코스`, `풀`, `하프`, `10K`, `5K` only. The selected trigger uses `--filter-selected` and `--filter-selected-text`; unselected triggers use `--filter-surface`, `--filter-text`, and `--filter-border`.
- Layout: the surface may overlap the bottom of the hero by `--filter-overlap` on desktop. At 375px it returns to document flow, stacks without clipping, and every control keeps `min-width: 0` and fills its track.
- States: disabled and reset-unavailable only in the approved homepage scope. Disabled controls remain legible and are not focusable.
- Accessibility: retain visible labels and honest preview copy. These controls do not filter, update counts, or move focus.

### Visual Filter Chip
- Structure: a compact disabled preview with one persistent text label and current placeholder value. It is the visual treatment of the labelled disabled select, not an active homepage filter.
- States: disabled only until filtering receives later approval. It uses `--filter-surface`, `--filter-text`, and `--filter-border` without selected/open behavior.
- Responsive behavior: chips keep `--control-height`, `min-width: 0`, and a readable label at every width. Their group may wrap between controls below 768px, but labels do not overlap, clip, or force page-level horizontal scrolling; at 375px each select may fill its grid track.
- Accessibility: each preview has a persistent visible label and programmatic name. Disabled controls remain legible and are not focusable.

### Month Section
- Structure: a labelled section containing a month heading, result count, optional month-level status, and one list of Monthly Race Rows. The heading precedes the count and rows in DOM order; empty months show an explicit empty-state sentence rather than an empty container.
- States: populated, loading, empty, and partial-data. Loading preserves the section heading and exposes status text; partial-data uses the existing danger/freshness language and names failed sources rather than silently omitting races.
- Responsive behavior: align the section to `--homepage-content-max`; heading and count share one row when space permits and stack at 375px. Race rows follow their existing desktop/mobile contract, and the section never changes the calendar's 768px seven-column grid or event-only 375px calendar list behavior.
- Accessibility: use a unique heading and `aria-labelledby` on the section, semantic list markup for rows, `aria-live="polite"` on result-count changes, and `role="status"` for loading or partial-data text. Heading levels remain sequential across the page.

### Homepage Year and Month Selectors
- Structure: two native selects with persistent visible labels, `대회 연도 선택` and `대회 월 선택`. Their first populated options are `전체 연도` and `전체 월`; the freshness notice renders below the complete control row rather than beside either select.
- States: populated and empty-disabled. Empty data keeps both controls visible and disabled with the honest options `선택할 대회 연도가 없습니다` and `선택할 대회 월이 없습니다`.
- Responsive behavior: the controls share the intro's trailing tools row when space permits and remain a two-column row at 375px; freshness stays visually below them without clipping or horizontal overflow.
- Options: year options contain each rendered section year. Month options contain all known month numbers when year is `전체 연도`, or only month numbers available in the selected year. Changing year resets month to `전체 월`.
- Filtering: `전체 연도` plus `전체 월` shows every Month Section. A specific year shows its sections; a specific month shows that month within the selected year or across years when year is `전체 연도`. Hidden Month Sections remain in the DOM, and either all option restores its corresponding dimension.
- Accessibility: selecting a specific year or month moves focus to the first visible month heading when a result exists. Headings retain the visible page focus treatment, and filtering has no motion dependency.

### Monthly Race Rows
- Structure: a month heading and result count followed by repeated rows containing one fixed-aspect media slot with an accepted event-specific remote logo or, when that logo is missing, rejected before rendering, or fails to load, `public/logo1.png` exactly once. The media retains its overlaid semantic date beside the race title, venue, registration status, course metadata, and favorite button. Rows link to race details, but the favorite button is a separate control and must not be nested inside the link. The former generated athletic/city inline SVG is not a Monthly Race Row media source or fallback.
- Layout: use `--race-row-gap`, `--race-row-padding`, and `--radius-card`. Desktop metadata reads in one horizontal rhythm; at narrow widths it wraps beneath the title without truncating the date, venue, or status. Long titles use a single-line ellipsis only where the existing grid-width rule requires it.
- Surface: rows use `--surface-elevated`, `--row-border`, and `--row-shadow`; the media slot uses `--radius-media` and the fixed `--race-thumbnail-ratio` 4:3 transparent frame. The contained logo image box, not the full slot, uses the always-white `--logo-surface` in light and dark modes.
- States: row link default, hover, active, and focus-visible; unavailable metadata uses the existing `--quiet` treatment and remains explicit in text.
- Calendar relationship: monthly rows are the homepage browse presentation and do not remove or weaken Month Navigation, calendar cells, the seven-column grid at 768px, or the event-only mobile calendar list requirements.

### Favorite Button
- Structure: a permanently visible disabled outline-heart preview at the trailing edge of every monthly race row; it is never hidden behind hover, overflow menus, or swipe gestures.
- Persistence: no favorite state or persistence is approved. The control must not toggle or write to memory, cookies, local storage, a database, or an account.
- States: disabled only until later product approval.
- Accessibility: minimum 44px square target, an honest Korean accessible label ending in `기능 준비 중`, and a disabled attribute so it is not focusable or presented as saved state.

### Calendar Brand Header
- Structure: a full-width `--hero-navy-deep` header containing the shared home/wordmark anchor with `public/logo2.png` and one prominent `메인으로 돌아가기` anchor targeting `#`. The shared image is the complete visual brand treatment; do not add generated marks or adjacent wordmark text.
- Layout: content aligns to `--homepage-content-max` with `--homepage-gutter`; wordmark and return action remain visible in one row from 375px upward.
- States: the return action uses the Orange Primary CTA default, stronger hover, active, and `--accent` focus-visible states.
- Accessibility: the wordmark and return action are distinct links with descriptive Korean names and at least 44px targets.

### Calendar Navy Hero
- Structure: a `--hero-navy` field below the brand header containing the calendar eyebrow, title, and concise Korean lede.
- Layout: copy aligns to the shared content width and remains left weighted; Korean phrases use balanced wrapping without one-character final lines.
- Surface: use the solid shared navy field rather than the homepage image scrim because the calendar hero has no artwork.
- Accessibility: heading order starts with one `h1`; hero text uses `--hero-text` and `--hero-text-muted` for stable AA contrast.

### Calendar Elevated Surface
- Structure: filters and month calendar are separate white surfaces over `--homepage-canvas`.
- Surface: use `--filter-surface`, `--row-border`, `--row-shadow`, and `--radius-card`; elevation is restrained and shares the homepage row material.
- Responsive behavior: the filter surface stacks above the calendar through tablet widths and becomes the existing sidebar at 1024px without changing calendar content.

### Calendar Pill Control
- Structure: every labelled filter select and reset action keeps its visible label and uses `--control-height` with `--radius-pill`.
- Surface: selects use `--filter-surface`, `--filter-border`, and `--filter-text`; reset uses the same family with a navy text accent.
- States: default, hover where actionable, focus-visible, and reset active. Focus uses the shared semantic `--accent` ring with sufficient separation from the control edge.
- Accessibility: native select behavior and exact filter/reset semantics remain unchanged.

### Shared Brand and Race Images
- Shared header brand: the home-link anchor in Homepage Header and the wordmark anchor in Calendar Brand Header both render `public/logo2.png`. The image does not replace either anchor's existing accessible Korean name, 44px target, focus-visible treatment, destination, or current-page semantics; use `alt=""` when that name is supplied by the anchor. The image is bounded by `--brand-image-max-block`, keeps its intrinsic aspect ratio, and may shrink without overlapping navigation, search, menu, return action, hero content, or the viewport at 375px, 768px, or 1280px.
- Homepage hero artwork: `.home-hero-visual > img.home-hero-art` renders `public/logo2.png` as a decorative contained image with `alt=""` and `aria-hidden="true"`. It is centered in the visual column, uses contain sizing, and never creates horizontal overflow at 375px, 768px, or 1280px.
- Supplied-asset generation: generate `public/logo1.png` as the opaque-white PNG fallback from its supplied source file without modifying that source. Generate `public/logo2.png` from the supplied `로고 2-3.png` source by using the effective visible-alpha crop with proportional breathing room, aspect-preserving contain into an exactly 237×256 RGBA cutout, preserving the blue emblem, enclosed white runner/head/speed-streak details, black MARATHON text, cyan RUN text, intentional semitransparent glow, colors, geometry, and transparency while dropping the near-invisible alpha tail. Do not stretch, recolor, mutate, or overwrite either supplied source file.
- Monthly-row scope: an event-specific remote logo is allowed only in the Monthly Race Row media slot. It must not appear in either header, the hero, calendar cells, navigation, filters, metadata, or any other shared surface. Generic site logos, source-site branding, and favicons are prohibited, including as inferred substitutes for an event logo.
- Fallback policy: each Monthly Race Row renders `public/logo1.png` exactly once in its single media slot when the event logo URL is missing, rejected by the approved URL policy, or fails to load. Error replacement removes or replaces the failed remote image rather than appending a second image; success never renders the fallback alongside the remote logo.
- Media geometry: the row media slot remains the fixed `--race-thumbnail-ratio` 4:3 transparent frame. The accepted remote event logo or required `public/logo1.png` fallback keeps its intrinsic aspect ratio, is centered and contained inside that slot, paints `--logo-surface` only on the rendered image box, and never crops, stretches, or inherits a dark background; `--logo-surface` remains white in light and dark modes. Generated athletic/city SVG artwork is not a Monthly Race Row fallback.
- Date and semantics: the existing semantic date overlay and `--thumbnail-date-surface` remain above every row media variant, including remote-logo success and fallback. All race media in this slot is decorative beside the race title and date, so image `alt` is exactly empty (`alt=""`); the row link's existing accessible name continues to carry race name, date, venue, and status.
- States: `success` shows one accepted remote event logo; `missing` immediately shows one fallback; `loading` reserves the final 4:3 transparent slot without layout shift and does not expose broken-image text; `error-fallback` replaces one rejected or failed remote logo with one fallback. These states preserve the centered white image box, row geometry, date legibility, focus behavior, and no-overlap/no-horizontal-overflow requirements at 375px, 768px, and 1280px.

## 6. Motion & Interaction

Interactive state changes use 150ms `ease-out` transitions on color, background, opacity, or transform only. Under `prefers-reduced-motion: reduce`, transitions are disabled. No decorative animation is used.

The production page must not create horizontal overflow at the 375px, 768px, or 1280px verification widths.

## 7. Depth & Surface

The depth strategy is tonal surfaces with a single hairline border. Elevated surfaces use `--surface-elevated`; controls and calendar cells use a subtle border, not heavy shadows.

## 8. Shared Brand Tokens

These tokens originated in the homepage composition extracted from `프론트 컨셉 이미지_1.png` and now define the shared visual language for both public routes. Calendar status semantics remain authoritative, while calendar brand surfaces consume this shared navy/orange/elevation system.

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Hero navy | `--hero-navy` | `#0b3a67` | Main hero field and selected dark controls |
| Hero deep navy | `--hero-navy-deep` | `#072b50` | Header edge and image-side depth |
| Hero scrim | `--hero-scrim` | `linear-gradient(90deg, rgba(7, 43, 80, 0.98) 0%, rgba(7, 43, 80, 0.82) 44%, rgba(7, 43, 80, 0.18) 76%, rgba(7, 43, 80, 0) 100%)` | Text-safe overlay on hero photography only |
| Hero text | `--hero-text` | `#ffffff` | Hero headline and primary copy |
| Hero text muted | `--hero-text-muted` | `#d8e5ef` | Hero supporting copy |
| Hero accent | `--hero-accent` | `#ffb08a` | Small orange text and line icons on navy; 4.8:1 against the weather panel composite |
| Hero control border | `--hero-control-border` | `rgba(255, 255, 255, 0.42)` | Header menu/search outlines |
| Hero control surface | `--hero-control-surface` | `rgba(255, 255, 255, 0.12)` | Read-only header search fill |
| Hero art shadow | `--hero-art-shadow` | `0 16px 24px rgba(7, 43, 80, 0.36)` | Weather panel depth and alpha-aware `logo2.png` silhouette shadow |
| CTA orange | `--cta-orange` | `#c2410c` | Primary homepage action; white contrast 5.18:1 |
| CTA orange hover | `--cta-orange-hover` | `#8f2708` | Primary action hover; white contrast remains above AA and uses a 2px lift |
| CTA orange active | `--cta-orange-active` | `#762006` | Primary action pressed; white contrast remains above AA |
| CTA text | `--cta-text` | `#ffffff` | Text and icon on orange CTA |
| Shared canvas | `--homepage-canvas` | `#f2f5f7` | Area behind homepage rows and calendar surfaces |
| Filter surface | `--filter-surface` | `#ffffff` | Filter panel and unselected controls |
| Filter border | `--filter-border` | `#dce3e8` | Filter control outlines |
| Filter text | `--filter-text` | `#3f4a53` | Unselected filter labels and values |
| Filter selected | `--filter-selected` | `#123f70` | Selected filter fill |
| Filter selected text | `--filter-selected-text` | `#ffffff` | Selected filter text |
| Row border | `--row-border` | `#e3e8ec` | Monthly race row hairline |
| Row shadow | `--row-shadow` | `0 8px 22px rgba(17, 43, 67, 0.08)` | Quiet row and filter elevation |
| Thumbnail date surface | `--thumbnail-date-surface` | `rgba(7, 43, 80, 0.9)` | Readable date overlay |
| Shared content max | `--homepage-content-max` | `1200px` | Homepage and calendar brand/schedule alignment |
| Shared gutter | `--homepage-gutter` | `clamp(16px, 5vw, 56px)` | Responsive horizontal breathing room |
| Filter overlap | `--filter-overlap` | `28px` | Desktop overlap between hero and filter surface |
| Control height | `--control-height` | `44px` | CTA and filter minimum height |
| CTA inline padding | `--cta-padding-inline` | `24px` | Primary action width rhythm |
| Pill radius | `--radius-pill` | `999px` | CTA and compact filter triggers |
| Card radius | `--radius-card` | `12px` | Filter surface and race rows |
| Media radius | `--radius-media` | `9px` | Race thumbnails |
| Shared brand image max block | `--brand-image-max-block` | `32px` | Eight base units; maximum rendered block size for `public/logo2.png` in both shared header anchors |
| Logo surface | `--logo-surface` | `#ffffff` | Always-white rendered image-box surface for monthly-row remote and fallback logos in light and dark modes; the surrounding 4:3 media slot and homepage hero inner stay transparent |
| Race row gap | `--race-row-gap` | `16px` | Thumbnail, content, and actions |
| Race row padding | `--race-row-padding` | `14px` | Race row internal spacing |
| Race thumbnail ratio | `--race-thumbnail-ratio` | `4 / 3` | Stable Monthly Race Row logo frame |

### Shared Dark Mode

Under `prefers-color-scheme: dark`, both homepage and calendar replace every shared light material rather than combining light cards with light global text. Hero navy surfaces remain unchanged; semantic status colors continue to use the global dark values.

| Role | Token | Dark value |
| --- | --- | --- |
| Canvas / primary surface | `--homepage-canvas`, `--surface-primary` | `#101b27` |
| Elevated / filter / control surface | `--surface-elevated`, `--filter-surface`, `--control-surface` | `#182838` |
| Muted surface | `--surface-muted` | `#223548` |
| Primary text | `--text-primary` | `#f5f7fa` |
| Secondary text | `--text-secondary` | `#b9c7d3` |
| Filter text | `--filter-text` | `#e6edf3` |
| Brand heading | `--brand-heading` | `#e6edf3` |
| Brand link | `--brand-link` | `#8fc4ed` |
| Filter and row border | `--filter-border`, `--row-border`, `--line` | `#38506a` |
| Selected control | `--filter-selected` | `#285b88` |
| Selected control text | `--filter-selected-text` | `#ffffff` |
| Elevated shadow | `--row-shadow` | `0 12px 28px rgba(0, 0, 0, 0.32)` |
| Thumbnail date surface | `--thumbnail-date-surface` | `rgba(6, 29, 51, 0.94)` |

Dark-mode body text, race links, native controls, and homepage rows must each retain at least 4.5:1 computed contrast at 375px and 1280px. Focus outlines use dark `--accent` (`#4ccc98`) and remain visually distinct from orange actions.

## 9. Shared Surface Tokens

Raw component colors are declared only as tokens. Component rules consume these variables rather than embedding color literals.

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Control surface | `--control-surface` | `#ffffff` | `#2b2b28` | Calendar buttons and selects |
| Text on dark | `--text-on-dark` | `#ffffff` | `#ffffff` | Skip links and dark fills |
