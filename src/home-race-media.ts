import type { Race } from "./contract.js";

const fallbackLogoUrl = new URL(
  "logo1.png",
  new URL(import.meta.env.BASE_URL ?? "./", window.location.href),
).href;

export function createRaceMedia(race: Pick<Race, "eventDate" | "logoUrl">): HTMLSpanElement {
  const media = document.createElement("span");
  media.className = "home-race-media";
  const image = document.createElement("img");
  image.className = "home-race-logo";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.width = 120;
  image.height = 90;
  image.loading = "lazy";
  image.decoding = "async";
  image.fetchPriority = "low";
  image.referrerPolicy = "no-referrer";
  image.src = race.logoUrl ?? fallbackLogoUrl;
  if (race.logoUrl !== undefined) {
    image.onerror = (): void => {
      image.onerror = null;
      image.dataset.logoFallback = "true";
      image.src = fallbackLogoUrl;
    };
  }
  const date = document.createElement("time");
  date.className = "home-race-date";
  date.dateTime = race.eventDate;
  date.textContent = `${race.eventDate.slice(5, 7)}.${race.eventDate.slice(8, 10)}`;
  media.append(image, date);
  return media;
}
