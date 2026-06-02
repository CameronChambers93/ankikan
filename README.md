# AnkiKan

> Annotate Japanese web pages and local files with furigana, highlighted by Anki card status.

AnkiKan is a browser extension that reads the furigana already present on a page and colour-codes each word based on whether you have an Anki card for it — and how well you know it. It communicates with Anki locally via the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on.

## Features

- Highlights words as **unlearned**, **learning**, or **learned** based on your Anki deck
- Shows or hides furigana per card status
- Works on any website and on local HTML files (`file://`)
- Allowlist and blocklist for fine-grained site control
- Optional **dictionary-form lookup** via a local lemma server — maps conjugated verb stems (e.g. 伝え) to their Anki card form (伝える)

## Installation

### Prerequisites

- [Anki](https://apps.ankiweb.net/) with the [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on installed (code `2055492159`)
- Chrome/Chromium or Firefox

### Chrome / Chromium

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `furigana-extension` folder
4. To use on local files, find the extension in the list and enable **Allow access to file URLs**

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on** and select any file inside the `furigana-extension` folder

> **Note:** Temporary add-ons are removed when Firefox closes. For a persistent install, sign the extension via [Mozilla Add-on Hub](https://addons.mozilla.org/developers/) or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false` in `about:config`.

Anki must be running whenever you want the extension to scan a page.

## Usage

Click the extension icon to open the popup.

| Setting | Description |
|---|---|
| **Anki field name** | The note field that holds the word (default: `Expression`) |
| **Allowed URLs** | Hostnames to run on (one per line). Empty = all sites |
| **Blocked URLs** | Hostnames to always skip (takes priority over allowed) |
| **Show furigana** | Master toggle for furigana display |
| **Unlearned / Learning / Learned** | Show furigana per card status |

Press **Scan page** to annotate the current page. The status bar shows how many words were matched against your deck.

### Colour reference

| Colour | Meaning |
|---|---|
| Red | Unlearned (new card) |
| Amber | Learning (in progress) |
| Green | Learned (mature card) |
| ✦ | Duplicate — multiple cards matched this word |

## Lemma server (optional)

The **Use dictionary forms** popup toggle enables context-aware conjugation matching. It requires the local lemma server to be running:

```bash
# Windows
$env:PYTHONUTF8=1; .venv\Scripts\python lemma_server.py

# macOS/Linux
PYTHONUTF8=1 .venv/bin/python lemma_server.py
```

The server listens on `http://127.0.0.1:7654`. If it is not running the extension falls back to surface-form matching silently. See [LEMMA_SERVER.md](LEMMA_SERVER.md) for the full API reference and options.

## Tokenizer (Python)

`tokenizer.py` provides a swappable Japanese morphological analysis layer used for development and testing. Requires a Python virtual environment.

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # macOS/Linux

pip install fugashi[unidic-lite] sudachipy sudachidict-core
```

```python
from tokenizer import get_tokenizer

# SudachiPy — best compound handling, three granularity modes
t = get_tokenizer("sudachi", mode="C")

# fugashi (MeCab/UniDic) — fastest, exposes etymology field
t = get_tokenizer("fugashi")

for tok in t.tokenize("日本語の文章を分割する"):
    print(tok.surface, tok.reading, tok.pos)
```

See [TOKENIZER.md](TOKENIZER.md) for the full field reference and backend comparison.

### Run tests

```bash
# Windows
$env:PYTHONUTF8=1; .venv\Scripts\pytest tests/ -v

# macOS/Linux
PYTHONUTF8=1 .venv/bin/pytest tests/ -v
```
