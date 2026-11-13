"""Search the bound executive directive as a versioned source of requirements."""

import re

from apps.aurora.runtime.pilot_corpus import MAX_QUOTE_CHARS, digest, terms

SOURCE = "directive"
TITLE = "Diretiva executiva vinculada (requisitos e planejamento)"


class DirectiveSource:
    def __init__(self, sha256, text):
        self.passages = []
        headings = {}
        block = ""
        first_line = 0

        def save_block():
            if block:
                self.passages.append(
                    {
                        "id": digest(f"{sha256}:{SOURCE}:{first_line}".encode()),
                        "source": SOURCE,
                        "version": 1,
                        "sha256": sha256,
                        "line": first_line,
                        "section": " / ".join(headings.values()),
                        "quote": block,
                    }
                )

        for line_number, line in enumerate(text.splitlines(), 1):
            quote = line.strip()
            heading = re.match(r"^(#{1,6})\s+(.+)", quote)
            if not quote or heading or len(block) + 1 + len(quote) > MAX_QUOTE_CHARS:
                save_block()
                block = ""
            if heading:
                depth = len(heading[1])
                headings = {
                    key: value for key, value in headings.items() if key < depth
                }
                headings[depth] = heading[2]
            elif quote:
                if not block:
                    first_line = line_number
                block = (f"{block}\n{quote}" if block else quote)[:MAX_QUOTE_CHARS]
        save_block()

    def retrieve(self, query):
        keywords = terms(query) - {"diretiva", "executiva", "previsto", "previstas"}
        section_ref = re.search(r"(?:§\s*|se[cç][aã]o\s+)(\d+(?:\.\d+)*)", query, re.I)
        section = (
            re.compile(rf"(?:^| / ){re.escape(section_ref[1])}\.\s")
            if section_ref
            else None
        )
        asks_for_steps = bool(keywords & {"etapas", "passos"})
        ranked = []
        for passage in self.passages:
            if section and not section.search(passage["section"]):
                continue
            heading_matches = keywords & terms(passage["section"])
            text_matches = keywords & terms(passage["quote"])
            if section or len(heading_matches | text_matches) >= 2:
                list_bonus = (
                    3 if asks_for_steps and re.match(r"\d+\. ", passage["quote"]) else 0
                )
                ranked.append(
                    (2 * len(heading_matches) + len(text_matches) + list_bonus, passage)
                )
        ranked.sort(key=lambda entry: -entry[0])
        return [passage for _, passage in ranked[:2]]
