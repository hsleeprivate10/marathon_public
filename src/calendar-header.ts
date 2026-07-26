type CalendarBranding = {
  readonly header: HTMLElement;
  readonly hero: HTMLElement;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createCalendarBranding(): CalendarBranding {
  const header = element("header", "calendar-header");
  const headerInner = element("div", "calendar-header-inner");
  const brand = element("a", "calendar-brand");
  brand.href = "#";
  brand.setAttribute("aria-label", "마라톤 캘린더 홈");
  const brandImage = element("img", "calendar-brand-image");
  brandImage.alt = "";
  brandImage.setAttribute("aria-hidden", "true");
  brandImage.width = 237;
  brandImage.height = 256;
  brandImage.src = new URL(
    "logo2.png",
    new URL(import.meta.env.BASE_URL ?? "./", window.location.href),
  ).href;
  brand.append(brandImage);
  const home = element("a", "calendar-home-link", "메인으로 돌아가기");
  home.href = "#";
  headerInner.append(brand, home);
  header.append(headerInner);

  const hero = element("section", "calendar-hero");
  const heroInner = element("div", "calendar-hero-inner");
  const lede = element("p", "calendar-lede");
  lede.append(
    element("span", undefined, "국내 대회 일정을"),
    document.createTextNode(" "),
    element("span", undefined, "출처와 함께 확인하세요."),
  );
  heroInner.append(
    element("p", "calendar-eyebrow", "DOMESTIC RACE SCHEDULE"),
    element("h1", undefined, "Marathon Calendar"),
    lede,
  );
  hero.append(heroInner);
  return { header, hero };
}
