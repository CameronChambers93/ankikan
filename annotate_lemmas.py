"""
Add data-lemma attributes to ruby-bearing spans in an NHK HTML file.

Tokenizes each <p> element's full text (preserving sentence context) so that
conjugated verb stems like 考え are correctly resolved to 考える rather than
being mis-analysed as nouns. Only spans whose surface exactly matches a token
boundary are annotated; misaligned spans are skipped safely.

Usage:
    python annotate_lemmas.py [path/to/file.html] [--backend sudachi|fugashi]

Modifies the file in-place.
"""
import argparse
import logging
import os
import pathlib
import sys

os.environ.setdefault("PYTHONUTF8", "1")

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from bs4 import BeautifulSoup, NavigableString, Tag

logger = logging.getLogger("lemma.annotate")


def extract_surface(span: Tag) -> str:
    """Mirror JS extractWord: span text excluding <rt>/<rp> content."""
    word = ""
    for node in span.children:
        if isinstance(node, NavigableString):
            word += str(node)
        elif isinstance(node, Tag) and node.name == "ruby":
            for child in node.children:
                if isinstance(child, NavigableString):
                    word += str(child)
                elif isinstance(child, Tag) and child.name not in ("rt", "rp"):
                    word += child.get_text()
    return word.strip()


def annotate_paragraph(container: Tag, tok) -> int:
    """Tokenize a paragraph's full text and annotate spans with data-lemma."""
    spans = container.find_all("span", recursive=False)
    if not spans:
        return 0

    span_infos = []
    pos = 0
    full_text = ""
    for span in spans:
        surface = extract_surface(span)
        has_ruby = bool(span.find("ruby"))
        span_infos.append((span, has_ruby, surface, pos))
        full_text += surface
        pos += len(surface)

    if not full_text.strip():
        return 0

    ruby_count = sum(1 for _, has_ruby, _, _ in span_infos if has_ruby)
    logger.debug(
        "Paragraph: %d chars, %d span(s), %d with ruby",
        len(full_text),
        len(span_infos),
        ruby_count,
    )

    try:
        tokens = tok.tokenize(full_text)
    except Exception as e:
        logger.warning("Tokenization failed for paragraph: %s", e)
        return 0

    # Map character position → token
    token_at_pos: dict = {}
    tpos = 0
    for token in tokens:
        tlen = len(token.surface)
        for i in range(tlen):
            token_at_pos[tpos + i] = token
        tpos += tlen

    count = 0
    for span, has_ruby, surface, start in span_infos:
        if not has_ruby or not surface:
            continue
        token = token_at_pos.get(start)
        if token is None:
            continue
        # Only annotate when span boundary exactly matches a token boundary
        if token.surface == surface and token.lemma and token.lemma != surface:
            span["data-lemma"] = token.lemma
            count += 1
        elif token.surface != surface:
            logger.debug("  Skipped %r — token boundary mismatch (token=%r)", surface, token.surface)

    return count


def annotate(html_path: str, backend: str = "sudachi") -> None:
    from tokenizer import get_tokenizer

    if backend == "sudachi":
        tok = get_tokenizer("sudachi", mode="C")
    else:
        tok = get_tokenizer("fugashi")

    path = pathlib.Path(html_path)
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")

    total = 0
    for p in soup.find_all("p"):
        total += annotate_paragraph(p, tok)

    path.write_text(str(soup), encoding="utf-8")
    logger.info("Annotated %d span(s) in %s", total, path.name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "html",
        nargs="?",
        default=str(pathlib.Path(__file__).parent / "nhk.html"),
        help="HTML file to annotate (default: nhk.html)",
    )
    parser.add_argument(
        "--backend",
        choices=("sudachi", "fugashi"),
        default="sudachi",
        help="Tokenizer backend (default: sudachi)",
    )
    parser.add_argument(
        "--log-level",
        choices=("DEBUG", "INFO", "WARNING"),
        default="INFO",
        help="Log verbosity (default: INFO)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    annotate(args.html, args.backend)
