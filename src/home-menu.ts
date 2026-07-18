export function bindHomepageMenu(
  page: HTMLElement,
  toggle: HTMLButtonElement,
  panel: HTMLElement,
): void {
  const setOpen = (open: boolean): void => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "주요 메뉴 닫기" : "주요 메뉴 열기");
    panel.classList.toggle("is-open", open);
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
  panel.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a") !== null) setOpen(false);
  });
  page.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || toggle.getAttribute("aria-expanded") !== "true") return;
    setOpen(false);
    toggle.focus();
  });
}
