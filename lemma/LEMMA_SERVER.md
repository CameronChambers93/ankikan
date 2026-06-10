# Lemma Server

Local HTTP server that maps conjugated Japanese surface forms to their dictionary (lemma) form. Used by the Anki Furigana browser extension to look up verb stems like 伝え against Anki cards stored as 伝える.

## Why it exists

NHK Easy Japanese marks up each morpheme as a separate `<span>`. Conjugated verbs are split into stem + auxiliary, so the extension sees 伝え but the Anki card is 伝える. Tokenizing the full sentence provides enough context to resolve the correct lemma — something that fails when tokenizing isolated fragments.

## Usage

```
python ankikan/lemma_server.py
```

Must be running before clicking **Scan page** in the extension with **Use dictionary forms** enabled.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--backend` | `fugashi` | Tokenizer: `fugashi` (fast) or `sudachi` (slower, may hang on Windows) |
| `--port` | `7654` | Port to listen on |
| `--log-level` | `INFO` | `DEBUG`, `INFO`, or `WARNING` |

## API

**Endpoint:** `POST http://127.0.0.1:7654`

**Request**
```json
{
  "paragraphs": [
    {
      "text": "計画を伝えたと考えています",
      "surfaces": ["伝え", "考え", "計画"]
    }
  ]
}
```

Each `text` is the full concatenated text of a block element (paragraph, list item, etc.) giving the tokenizer sentence context. `surfaces` is the list of surface words from ruby-bearing spans within that block that need lemma resolution.

**Response**
```json
{
  "伝え": "伝える",
  "考え": "考える"
}
```

Only entries where `lemma ≠ surface` are included. Words whose lemma equals their surface (e.g. nouns like 計画) are omitted. Returns `{}` on any error.

## Logging

**INFO** (default) — one line per request in, one per response out:
```
11:46:54 [INFO] lemma: POST / — 1 paragraph(s), 3 unique surface(s)
11:46:54 [INFO] lemma: Response 200 — 2 lemma(s) mapped in 0.7ms
```

**DEBUG** — per-paragraph detail and each individual mapping:
```
11:46:54 [DEBUG] lemma:   Para 0: 13 chars, surfaces=['伝え', '考え', '計画']
11:46:54 [DEBUG] lemma.tokenizer: fugashi: 9 tokens from 13-char input
11:46:54 [DEBUG] lemma:     '伝え' -> '伝える'  (動詞)
11:46:54 [DEBUG] lemma:     '考え' -> '考える'  (動詞)
11:46:54 [INFO] lemma: Response 200 — 2 lemma(s) mapped in 0.7ms
```

## Backend comparison

| | fugashi | sudachi |
|---|---|---|
| Startup time | ~200ms | 30–60s (Windows) |
| Dictionary | UniDic (unidic-lite) | SudachiDict |
| Split mode | — | Mode C (longest match) |
| Accuracy | Good | Slightly better for edge cases |

Fugashi is the default and recommended for interactive use. Sudachi can hang on Windows during dictionary initialisation; if using it, wait up to 60 seconds for the "Tokenizer ready" log line.

## Graceful degradation

If the server is not running when the extension scans a page, the extension falls back to surface-form lookup silently — no error is shown. Spans with a pre-annotated `data-lemma` attribute (from `annotate_lemmas.py`) continue to work regardless.
