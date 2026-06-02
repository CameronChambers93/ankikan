"""
Lemma server for the Anki Furigana extension.

Receives paragraph text + a list of surface words, tokenizes with full sentence
context, and returns a mapping of {surface: lemma} for words whose dictionary
form differs from the surface.

Endpoint: POST http://127.0.0.1:7654
Request:  {"paragraphs": [{"text": "...", "surfaces": ["伝え", "考え"]}]}
Response: {"伝え": "伝える", "考え": "考える"}

Usage:
    python lemma_server.py [--backend sudachi|fugashi] [--port 7654]
                           [--log-level DEBUG|INFO|WARNING]
"""
import argparse
import json
import logging
import os
import pathlib
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ.setdefault("PYTHONUTF8", "1")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

logger = logging.getLogger("lemma")


def make_handler(tok):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            t0 = time.perf_counter()
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length))
            except Exception as e:
                logger.warning("Bad JSON in request: %s", e)
                self._respond(400, {})
                return

            paragraphs = body.get("paragraphs", [])
            all_surfaces = {s for p in paragraphs for s in p.get("surfaces", [])}
            logger.info(
                "POST / — %d paragraph(s), %d unique surface(s)",
                len(paragraphs),
                len(all_surfaces),
            )

            result = {}
            for i, para in enumerate(paragraphs):
                text = para.get("text", "")
                surfaces = set(para.get("surfaces", []))
                if not text or not surfaces:
                    continue
                logger.debug(
                    "  Para %d: %d chars, surfaces=%s",
                    i,
                    len(text),
                    sorted(surfaces),
                )
                try:
                    for token in tok.tokenize(text):
                        if (
                            token.surface in surfaces
                            and token.lemma
                            and token.lemma != token.surface
                        ):
                            result[token.surface] = token.lemma
                            logger.debug(
                                "    %r -> %r  (%s)",
                                token.surface,
                                token.lemma,
                                token.pos,
                            )
                except Exception as e:
                    logger.warning("Tokenization failed for paragraph %d: %s", i, e)

            elapsed = (time.perf_counter() - t0) * 1000
            logger.info(
                "Response 200 — %d lemma(s) mapped in %.1fms", len(result), elapsed
            )
            self._respond(200, result)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def _respond(self, code, data):
            payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self._cors()
            self.end_headers()
            self.wfile.write(payload)

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def log_message(self, *args):
            pass  # replaced by structured logging in do_POST

    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--backend",
        choices=("sudachi", "fugashi"),
        default="fugashi",
        help="Tokenizer backend (default: fugashi)",
    )
    parser.add_argument("--port", type=int, default=7654)
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

    from tokenizer import get_tokenizer

    logger.info("Loading %s tokenizer...", args.backend)
    t0 = time.perf_counter()
    tok = (
        get_tokenizer("sudachi", mode="C")
        if args.backend == "sudachi"
        else get_tokenizer("fugashi")
    )
    logger.info("Tokenizer ready in %.1fs", time.perf_counter() - t0)

    server = HTTPServer(("127.0.0.1", args.port), make_handler(tok))
    logger.info("Lemma server listening on http://127.0.0.1:%d  (Ctrl-C to stop)", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down.")
