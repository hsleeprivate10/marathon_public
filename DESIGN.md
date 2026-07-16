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

Primary UI font: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`.

| Level | Size | Weight | Usage |
| --- | --- | --- | --- |
| Display | 36px | 700 | Month heading |
| H2 | 24px | 650 | Race card title |
| Body | 16px | 400 | Default copy |
| Small | 14px | 500 | Event metadata and controls |
| Caption | 12px | 600 | Weekday and status labels |

## 4. Spacing & Layout

The base unit is 4px. Tokens: `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 20px, `--space-6` 24px, `--space-8` 32px, `--space-10` 40px, `--space-12` 48px.

Content is constrained to 1200px. At 375px the calendar becomes an event-list layout; at 768px it becomes a full-width seven-column grid; at 1024px filters sit beside the schedule.

## 5. Components

### Month Navigation
- Structure: previous button, month heading, next button.
- States: hover/active/focus-visible; buttons remain at least 44px tall.
- Accessibility: buttons have Korean aria labels and keyboard activation.

### Filter Bar
- Structure: labeled selects for region, distance, and registration state, plus a reset action.
- Course order: `전체 코스`, `풀`, `하프`, `10K`, `5K` only.
- Containment: controls use `min-width: 0` and fill their grid track so long Korean labels cannot overlap the calendar.
- States: default/focus/disabled.
- Accessibility: every control has a visible label; filtering never relies on color.

### Calendar Cell and Event Card
- Structure: date number, event links with status text, optional overflow count. At grid widths, event cards show only the title; venue and status stay in the accessible link label and remain visible in the mobile list. Tablet grid titles use a single-line ellipsis to prevent narrow cells from breaking Korean words vertically.
- States: default/focus/hover. Links retain visible focus outlines.
- Accessibility: date cells use labelled sections; event links include name, date, venue, and status.

### Freshness Notice
- Structure: generated timestamp and source count.
- States: normal and partial-collection warning.
- Accessibility: partial failures use `role="status"` and name failed sources in text.

## 6. Motion & Interaction

Interactive state changes use 150ms `ease-out` transitions on color, background, opacity, or transform only. Under `prefers-reduced-motion: reduce`, transitions are disabled. No decorative animation is used.

The production page must not create horizontal overflow at the 375px, 768px, or 1280px verification widths.

## 7. Depth & Surface

The depth strategy is tonal surfaces with a single hairline border. Elevated surfaces use `--surface-elevated`; controls and calendar cells use a subtle border, not heavy shadows.
