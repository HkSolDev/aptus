"""Offline HTML reader: preserve content in DOM order, without interpreting jobs."""

import re
import unicodedata
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Comment, NavigableString, Tag


BOUNDARIES = {"p", "div", "section", "article", "header", "footer", "aside",
              "li", "ul", "ol", "table", "tr", "td", "th", "blockquote",
              "h1", "h2", "h3", "h4", "h5", "h6", "pre", "hr"}


def clean_text(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    # Only explicit structure creates newlines; source indentation is whitespace.
    return "\n".join(re.sub(r"[^\S\n]+", " ", line).strip()
                     for line in value.split("\n")).strip()


def node_text(node) -> str:
    if isinstance(node, NavigableString):
        return re.sub(r"\s+", " ", str(node))
    if node.name == "br":
        return "\n"
    value = "".join(node_text(child) for child in node.children)
    return "\n" + value + "\n" if node.name in BOUNDARIES else value


def http_url(href: str, base: str) -> str | None:
    try:
        url = urljoin(base, href.strip())
        parsed = urlsplit(url)
        return url if parsed.scheme in {"http", "https"} and parsed.hostname else None
    except ValueError:
        return None


def normalize_html(html: bytes, final_url: str, *, include_link_context=False) -> dict:
    """Read bounded captured bytes; returns format/title/blocks/links/warnings."""
    if not isinstance(html, bytes):
        raise TypeError("html must be captured bytes")
    if len(html) > 5 * 1024 * 1024:
        raise ValueError("HTML exceeds the 5 MiB normalization limit")
    if not isinstance(final_url, str) or not http_url(final_url, ""):
        raise ValueError("final_url must be an absolute HTTP(S) URL")
    if not html.strip():
        return {"format": "html", "title": None, "blocks": [], "links": [],
                "warnings": ["empty_content"]}
    # Prefer valid UTF-8 over heuristic guesses on short Hindi fragments.
    try:
        html.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        encoding = None
    soup = BeautifulSoup(html, "html.parser", from_encoding=encoding)
    title = clean_text(node_text(soup.title)) if soup.title else None
    base = final_url
    for element in soup.find_all("base", href=True):
        resolved = http_url(element["href"], final_url)
        if resolved:
            base = resolved
            break
    for element in list(soup.find_all(["script", "style", "nav", "head", "title", "meta", "base", "link"])):
        if element.parent is not None:
            element.decompose()
    for element in list(soup.find_all(attrs={"role": "navigation"})):
        if element.parent is not None:
            element.decompose()
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()
    root = soup.body or soup
    links, link_nodes = [], {}
    for anchor in root.find_all("a", href=True):
        url = http_url(anchor["href"], base)
        if url:
            links.append({"text": clean_text(node_text(anchor)), "url": url})
            link_nodes[id(anchor)] = len(links) - 1
    blocks, warnings = [], []
    heading = None

    def attach_links(nodes, owner, context):
        if not include_link_context:
            return
        for node in nodes:
            if not isinstance(node, Tag):
                continue
            anchors = ([node] if node.name == "a" else []) + node.find_all("a", href=True)
            for anchor in anchors:
                index = link_nodes.get(id(anchor))
                if index is not None:
                    links[index].update(owner=owner, context=context)

    def warn(reason):
        if reason not in warnings:
            warnings.append(reason)

    if soup.contains_replacement_characters:
        warn("encoding_replacement_characters")

    def paragraph(value, nodes=()):
        text = clean_text(value)
        if text or (include_link_context and any(isinstance(n, Tag) and
                    (n.name == "a" or n.find("a", href=True)) for n in nodes)):
            attach_links(nodes, {"block": len(blocks)},
                         {"heading": heading, "text": text})
            blocks.append({"type": "paragraph", "text": text})

    def walk(container):
        nonlocal heading
        pending, pending_nodes = [], []
        for child in container.children:
            if isinstance(child, NavigableString):
                pending.append(node_text(child))
                continue
            if not isinstance(child, Tag):
                continue
            if child.name not in BOUNDARIES:
                # Inline wrappers may contain block elements in malformed HTML.
                if not child.find(list(BOUNDARIES)):
                    pending.append(node_text(child))
                    pending_nodes.append(child)
                    continue
            paragraph("".join(pending), pending_nodes)
            pending.clear()
            pending_nodes.clear()
            name = child.name
            if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                heading = clean_text(node_text(child))
                if heading:
                    attach_links([child], {"block": len(blocks)},
                                 {"heading": heading, "text": heading})
                    blocks.append({"type": "heading", "level": int(name[1]),
                                   "text": heading})
            elif name in {"ul", "ol"}:
                items = [clean_text(node_text(item))
                         for item in child.find_all("li", recursive=False)]
                if items:
                    for index, item in enumerate(child.find_all("li", recursive=False)):
                        attach_links([item], {"block": len(blocks), "item": index},
                                     {"heading": heading, "text": items[index]})
                    blocks.append({"type": "list", "ordered": name == "ol",
                                   "items": items})
                if child.find(["ul", "ol"]):
                    warn("nested_list_flattened")
            elif name == "table":
                if child.find(attrs={"rowspan": True}) or child.find(attrs={"colspan": True}):
                    warn("table_spans_present")
                if child.find("table"):
                    warn("nested_table_flattened")
                caption = child.find("caption", recursive=False)
                rows, cell_nodes = [], []
                for row in child.find_all("tr"):
                    if row.find_parent("table") is child:
                        cells = row.find_all(["td", "th"], recursive=False)
                        cell_nodes.append(cells)
                        rows.append([clean_text(node_text(cell)) for cell in cells])
                if rows:
                    if caption:
                        paragraph(node_text(caption), [caption])
                    for row_index, cells in enumerate(cell_nodes):
                        for cell_index, cell in enumerate(cells):
                            attach_links([cell], {"block": len(blocks), "row": row_index,
                                                 "cell": cell_index},
                                         {"heading": heading, "row": rows[row_index],
                                          "text": rows[row_index][cell_index]})
                    blocks.append({"type": "table", "heading_context": heading, "rows": rows})
                else:
                    warn("table_structure_uncertain")
                    paragraph(node_text(child), [child])
            else:
                walk(child)
        paragraph("".join(pending), pending_nodes)

    walk(root)
    if not blocks:
        warn("empty_content")
    if include_link_context and any("owner" not in link for link in links):
        warn("unattached_link")
    return {"format": "html", "title": title or None, "blocks": blocks,
            "links": links, "warnings": warnings}
