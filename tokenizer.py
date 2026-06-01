from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


def _clean(val: str | None) -> str | None:
    """Return None for MeCab/UniDic wildcard values."""
    return val if val and val != '*' else None


@dataclass
class Token:
    surface: str       # text as it appears in the sentence
    reading: str       # katakana/hiragana pronunciation
    pos: str           # primary part of speech (名詞, 動詞, …)
    lemma: str         # dictionary base form


@dataclass
class FugashiToken(Token):
    """Token with full UniDic feature fields from fugashi/MeCab."""
    pos2: str | None = None              # 品詞細分類1
    pos3: str | None = None              # 品詞細分類2
    pos4: str | None = None              # 品詞細分類3
    conjugation_type: str | None = None  # 活用型 (cType)
    conjugation_form: str | None = None  # 活用形 (cForm)
    written_form: str | None = None      # 書字形 (orth) — surface as written
    pronunciation: str | None = None     # 発音形 (pron)
    lemma_reading: str | None = None     # 語彙素読み (lForm)
    etymology: str | None = None         # 語種 (goshu): 和/漢/外/固/混


@dataclass
class SudachiToken(Token):
    """Token with Sudachi morpheme fields."""
    pos2: str | None = None
    pos3: str | None = None
    pos4: str | None = None
    conjugation_type: str | None = None
    conjugation_form: str | None = None
    normalized_form: str | None = None   # orthographically normalized form
    reading_form: str | None = None      # katakana reading from dictionary


@runtime_checkable
class Tokenizer(Protocol):
    def tokenize(self, text: str) -> list[Token]: ...


class FugashiTokenizer:
    def __init__(self, dictionary: str = "unidic-lite"):
        import fugashi
        self._tagger = (
            fugashi.Tagger()
            if dictionary == "unidic-lite"
            else fugashi.Tagger(f"-d {dictionary}")
        )

    def tokenize(self, text: str) -> list[FugashiToken]:
        tokens = []
        for word in self._tagger(text):
            f = word.feature
            reading = (
                _clean(getattr(f, "kana", None))
                or _clean(getattr(f, "pron", None))
                or word.surface
            )
            tokens.append(FugashiToken(
                surface=word.surface,
                reading=reading,
                pos=_clean(getattr(f, "pos1", None)) or "",
                lemma=_clean(getattr(f, "lemma", None)) or word.surface,
                pos2=_clean(getattr(f, "pos2", None)),
                pos3=_clean(getattr(f, "pos3", None)),
                pos4=_clean(getattr(f, "pos4", None)),
                conjugation_type=_clean(getattr(f, "cType", None)),
                conjugation_form=_clean(getattr(f, "cForm", None)),
                written_form=_clean(getattr(f, "orth", None)),
                pronunciation=_clean(getattr(f, "pron", None)),
                lemma_reading=_clean(getattr(f, "lForm", None)),
                etymology=_clean(getattr(f, "goshu", None)),
            ))
        return tokens


class SudachiTokenizer:
    _MODES = {"A", "B", "C"}

    def __init__(self, mode: str = "C"):
        import sudachipy
        if mode.upper() not in self._MODES:
            raise ValueError(f"mode must be one of {self._MODES}")
        d = sudachipy.Dictionary()
        self._tokenizer = d.create()
        self._split_mode = getattr(sudachipy.SplitMode, mode.upper())

    def tokenize(self, text: str) -> list[SudachiToken]:
        tokens = []
        for m in self._tokenizer.tokenize(text, self._split_mode):
            ps = m.part_of_speech()  # (pos1, pos2, pos3, pos4, cType, cForm)
            tokens.append(SudachiToken(
                surface=m.surface(),
                reading=m.reading_form(),
                pos=ps[0],
                lemma=m.dictionary_form(),
                pos2=_clean(ps[1]) if len(ps) > 1 else None,
                pos3=_clean(ps[2]) if len(ps) > 2 else None,
                pos4=_clean(ps[3]) if len(ps) > 3 else None,
                conjugation_type=_clean(ps[4]) if len(ps) > 4 else None,
                conjugation_form=_clean(ps[5]) if len(ps) > 5 else None,
                normalized_form=m.normalized_form(),
                reading_form=m.reading_form(),
            ))
        return tokens


def get_tokenizer(backend: str, **kwargs) -> Tokenizer:
    """
    backend: "fugashi" or "sudachi"
    kwargs for fugashi: dictionary="unidic-lite" | "<path>"
    kwargs for sudachi: mode="A" | "B" | "C"
    """
    if backend == "fugashi":
        return FugashiTokenizer(**kwargs)
    elif backend == "sudachi":
        return SudachiTokenizer(**kwargs)
    else:
        raise ValueError(f"Unknown backend: {backend!r}. Choose from: fugashi, sudachi")
