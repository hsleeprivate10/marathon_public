import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";

export type ContextualFieldLink = {
  readonly href: string;
  readonly text: string;
};

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlChildNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlParentNode = DefaultTreeAdapterTypes.ParentNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type HtmlTextNode = DefaultTreeAdapterTypes.TextNode;

const FIELD_LABEL_PATTERN = /(?:홈페이지|웹사이트)(?:\s*\/\s*(?:이메일|연락처))*/u;
const FIELD_CONTAINER_TAGS = new Set<string>(["tr", "dl"]);
const INERT_TAGS = new Set<string>(["script", "style", "template", "textarea", "title"]);
const BLOCKED_CONTEXT_TAGS = new Set<string>(["aside", "footer", "nav"]);
const BLOCKED_CONTEXT_PATTERN =
  /(?:related|footer|navigation|recommend|list|card|연관|관련|목록)/iu;

export function scanContextualFieldLinks(html: string): readonly ContextualFieldLink[] {
  let parseError = false;
  const fragment = parseFragment(html, {
    onParseError: () => {
      parseError = true;
    },
  });
  if (parseError) return [];
  const links: ContextualFieldLink[] = [];
  collectFieldLinks(fragment.childNodes, links);
  return links;
}

export function scanDetailAnchors(html: string): readonly ContextualFieldLink[] {
  let parseError = false;
  const fragment = parseFragment(html, {
    onParseError: () => {
      parseError = true;
    },
  });
  if (parseError) return [];
  return anchorsIn(fragment);
}

function collectFieldLinks(nodes: readonly HtmlChildNode[], links: ContextualFieldLink[]): void {
  for (const node of nodes) {
    if (isElement(node) && INERT_TAGS.has(node.tagName)) continue;
    if (isElement(node) && FIELD_CONTAINER_TAGS.has(node.tagName)) {
      collectContainerLinks(node, links);
      continue;
    }
    if (isParentNode(node)) collectFieldLinks(node.childNodes, links);
  }
}

function collectContainerLinks(node: HtmlElement, links: ContextualFieldLink[]): void {
  if (!hasHomepageFieldLabel(node)) return;
  for (const anchor of anchorsIn(node)) {
    if (looksLikeUrlText(anchor.text)) links.push(anchor);
  }
}

function hasHomepageFieldLabel(node: HtmlParentNode): boolean {
  const labelText = visibleText(node.childNodes);
  return FIELD_LABEL_PATTERN.test(labelText.replace(/\s+/g, " "));
}

function anchorsIn(node: HtmlParentNode): readonly ContextualFieldLink[] {
  const links: ContextualFieldLink[] = [];
  collectAnchors(node.childNodes, links);
  return links;
}

function collectAnchors(nodes: readonly HtmlChildNode[], links: ContextualFieldLink[]): void {
  for (const node of nodes) {
    if (isElement(node) && INERT_TAGS.has(node.tagName)) continue;
    if (isElement(node) && BLOCKED_CONTEXT_TAGS.has(node.tagName)) continue;
    if (isElement(node) && hasBlockedContextName(node)) continue;
    if (isElement(node) && node.tagName === "a") {
      const href = attr(node, "href");
      if (href !== undefined && href !== "") {
        links.push({ href, text: visibleText(node.childNodes) });
      }
    }
    if (isParentNode(node)) collectAnchors(node.childNodes, links);
  }
}

function hasBlockedContextName(node: HtmlElement): boolean {
  const contextName = [attr(node, "class"), attr(node, "id"), attr(node, "role")]
    .flatMap((value) => (value === undefined ? [] : [value]))
    .join(" ");
  return BLOCKED_CONTEXT_PATTERN.test(contextName);
}

function visibleText(nodes: readonly HtmlChildNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (isTextNode(node)) text += node.value;
    if (isElement(node) && INERT_TAGS.has(node.tagName)) continue;
    if (isParentNode(node)) text += visibleText(node.childNodes);
  }
  return text;
}

function looksLikeUrlText(value: string): boolean {
  const text = value.trim();
  return URL.canParse(text) && /^https?:\/\//iu.test(text);
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function isParentNode(node: HtmlNode): node is HtmlParentNode {
  return "childNodes" in node;
}

function isTextNode(node: HtmlNode): node is HtmlTextNode {
  return node.nodeName === "#text";
}

function attr(node: HtmlElement, name: string): string | undefined {
  return node.attrs?.find((item) => item.name === name)?.value;
}
