import type { Race } from "./contract.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function icon(kind: "calendar" | "heart"): SVGSVGElement {
  const svg = svgElement("svg", {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  if (kind === "calendar") {
    svg.append(
      svgElement("rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }),
      svgElement("path", { d: "M16 3v4M8 3v4M3 10h18" }),
      svgElement("path", { d: "M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" }),
    );
  } else {
    svg.append(
      svgElement("path", {
        d: "M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z",
      }),
    );
  }
  return svg;
}

export function heroArtwork(): SVGSVGElement {
  const svg = svgElement("svg", {
    class: "home-hero-art",
    viewBox: "0 0 760 420",
    preserveAspectRatio: "xMidYMid slice",
    "aria-hidden": "true",
  });
  const skyline = svgElement("g", { class: "home-skyline" });
  skyline.append(
    svgElement("path", {
      d: "M0 322h92v-88h50v88h54V182h66v140h48V218h44v104h58V136h30v186h70V202h62v120h58V166h74v156h54v98H0Z",
    }),
    svgElement("path", { d: "M0 358c126-38 210-32 310 8 112 45 244 45 450-10v64H0Z" }),
  );
  const runner = svgElement("g", { class: "home-runner" });
  runner.append(
    svgElement("circle", { cx: "525", cy: "118", r: "22" }),
    svgElement("path", { d: "m510 151-35 70 55 42 24-74 50 38" }),
    svgElement("path", { d: "m489 185-62 30-42-14M530 263l-54 90-68 35M530 263l73 53 54 8" }),
  );
  svg.append(skyline, runner);
  return svg;
}

export function raceThumbnail(race: Pick<Race, "eventDate" | "name">): HTMLSpanElement {
  const media = document.createElement("span");
  const variant =
    [...race.name].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0) % 3;
  media.className = `home-race-media home-race-media-${variant + 1}`;
  const svg = svgElement("svg", {
    class: "home-race-thumbnail",
    viewBox: "0 0 120 90",
    preserveAspectRatio: "xMidYMid slice",
    "aria-hidden": "true",
  });
  svg.append(
    svgElement("rect", { class: "home-thumbnail-sky", width: "120", height: "90" }),
    svgElement("path", {
      class: "home-thumbnail-city",
      d: "M0 58h15V31h14v27h13V20h18v38h12V37h14v21h16V27h18v63H0Z",
    }),
    svgElement("path", {
      class: "home-thumbnail-track",
      d: "M-8 88c34-30 70-30 136 0M7 88c30-19 58-19 106 0",
    }),
    svgElement("circle", { class: "home-thumbnail-runner", cx: "76", cy: "38", r: "5" }),
    svgElement("path", {
      class: "home-thumbnail-runner-line",
      d: "m73 45-10 15 14 9 8-16 11 8M67 51l-14 7M77 69l-12 14M77 69l16 12",
    }),
  );
  const date = document.createElement("time");
  date.className = "home-race-date";
  date.dateTime = race.eventDate;
  date.textContent = `${race.eventDate.slice(5, 7)}.${race.eventDate.slice(8, 10)}`;
  media.append(svg, date);
  return media;
}
