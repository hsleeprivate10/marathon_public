import type { WeatherCondition } from "./home-weather-model.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NAMESPACE, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function weatherIcon(condition: WeatherCondition): SVGSVGElement {
  const svg = svgElement("svg", {
    class: "home-weather-icon",
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  switch (condition) {
    case "clear":
      svg.append(
        svgElement("circle", { cx: "24", cy: "24", r: "8" }),
        svgElement("path", {
          d: "M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M36.7 11.3l-3.5 3.5M14.8 33.2l-3.5 3.5",
        }),
      );
      return svg;
    case "cloudy":
      svg.append(
        svgElement("path", { d: "M12 34h23a8 8 0 0 0 0-16 12 12 0 0 0-23-1A8.5 8.5 0 0 0 12 34Z" }),
      );
      return svg;
    case "fog":
      svg.append(
        svgElement("path", { d: "M14 26h20M10 32h28M15 38h18" }),
        svgElement("path", { d: "M14 21h21a7 7 0 0 0-13-4 9 9 0 0 0-16 5" }),
      );
      return svg;
    case "rain":
      svg.append(
        svgElement("path", { d: "M12 28h23a8 8 0 0 0 0-16 12 12 0 0 0-23-1A8.5 8.5 0 0 0 12 28Z" }),
        svgElement("path", { d: "m17 34-2 5M26 34l-2 5M35 34l-2 5" }),
      );
      return svg;
    case "snow":
      svg.append(
        svgElement("path", { d: "M12 27h23a8 8 0 0 0 0-16 12 12 0 0 0-23-1A8.5 8.5 0 0 0 12 27Z" }),
        svgElement("path", { d: "M17 34v7M14 36l6 3M20 36l-6 3M32 34v7M29 36l6 3M35 36l-6 3" }),
      );
      return svg;
    case "storm":
      svg.append(
        svgElement("path", { d: "M12 27h23a8 8 0 0 0 0-16 12 12 0 0 0-23-1A8.5 8.5 0 0 0 12 27Z" }),
        svgElement("path", { d: "m27 30-6 9h6l-3 7 10-11h-6l3-5" }),
      );
      return svg;
    case "unknown":
      svg.append(
        svgElement("circle", { cx: "24", cy: "24", r: "18" }),
        svgElement("path", { d: "M19 18a5 5 0 1 1 8 4c-2 1-3 2-3 5M24 34h.01" }),
      );
      return svg;
  }
}
