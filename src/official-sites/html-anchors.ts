import { parseFragment } from "parse5";

export interface HtmlAnchor {
  readonly href: string;
  readonly text: string;
}

type AstNode = {
  readonly nodeName?: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: readonly Attribute[];
  readonly childNodes?: readonly AstNode[];
  readonly content?: AstNode;
};

type Attribute = {
  readonly name: string;
  readonly value: string;
};

const inertTextTags = new Set([
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

export function scanHtmlAnchors(html: string): readonly HtmlAnchor[] {
  let parseError = false;
  const fragment = parseFragment(html, {
    onParseError: () => {
      parseError = true;
    },
  }) as AstNode;
  if (parseError) return [];
  const anchors: HtmlAnchor[] = [];
  collectAnchors(fragment.childNodes ?? [], anchors);
  return anchors;
}

function collectAnchors(nodes: readonly AstNode[], anchors: HtmlAnchor[]): void {
  for (const node of nodes) {
    if (node.tagName === "template") continue;
    if (node.tagName !== undefined && inertTextTags.has(node.tagName)) continue;
    if (node.tagName === "a") {
      const href = attr(node, "href");
      if (href !== undefined && href !== "") {
        anchors.push({ href, text: visibleText(node.childNodes ?? []) });
      }
    }
    collectAnchors(node.childNodes ?? [], anchors);
  }
}

function visibleText(nodes: readonly AstNode[]): string {
  let text = "";
  for (const node of nodes) {
    if (node.nodeName === "#text") text += node.value ?? "";
    if (node.tagName === "template") continue;
    if (node.tagName !== undefined && inertTextTags.has(node.tagName)) continue;
    text += visibleText(node.childNodes ?? []);
  }
  return text;
}

function attr(node: AstNode, name: string): string | undefined {
  return node.attrs?.find((item) => item.name === name)?.value;
}
