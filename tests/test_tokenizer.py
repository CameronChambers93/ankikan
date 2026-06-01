"""
Tests for tokenizer.py.

Backends load large dictionaries, so tokenizer instances are session-scoped
fixtures — created once and shared across all tests.
"""
import pytest
from tokenizer import (
    Token, FugashiToken, SudachiToken, Tokenizer,
    FugashiTokenizer, SudachiTokenizer,
    get_tokenizer, _clean,
)

TEXT = "日本語の文章を分割する"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def fugashi():
    return get_tokenizer("fugashi")


@pytest.fixture(scope="session")
def sudachi_c():
    return get_tokenizer("sudachi", mode="C")


@pytest.fixture(scope="session")
def sudachi_a():
    return get_tokenizer("sudachi", mode="A")


# ---------------------------------------------------------------------------
# _clean
# ---------------------------------------------------------------------------

class TestClean:
    def test_wildcard_returns_none(self):
        """MeCab/UniDic uses '*' for absent fields — _clean() must convert it to None."""
        assert _clean("*") is None

    def test_empty_returns_none(self):
        """An empty string is treated the same as a missing field."""
        assert _clean("") is None

    def test_none_returns_none(self):
        """Passing None through _clean() is a no-op."""
        assert _clean(None) is None

    def test_valid_string_passes_through(self):
        """A real value must be returned unchanged."""
        assert _clean("名詞") == "名詞"


# ---------------------------------------------------------------------------
# get_tokenizer factory
# ---------------------------------------------------------------------------

class TestFactory:
    def test_returns_fugashi_tokenizer(self):
        """get_tokenizer('fugashi') must return a FugashiTokenizer instance."""
        t = get_tokenizer("fugashi")
        assert isinstance(t, FugashiTokenizer)

    def test_returns_sudachi_tokenizer(self):
        """get_tokenizer('sudachi') must return a SudachiTokenizer instance."""
        t = get_tokenizer("sudachi")
        assert isinstance(t, SudachiTokenizer)

    def test_unknown_backend_raises(self):
        """An unrecognised backend name must raise ValueError with a helpful message."""
        with pytest.raises(ValueError, match="Unknown backend"):
            get_tokenizer("janome")

    def test_invalid_sudachi_mode_raises(self):
        """Sudachi only accepts modes A, B, C — anything else must raise ValueError."""
        with pytest.raises(ValueError):
            get_tokenizer("sudachi", mode="Z")

    def test_satisfies_protocol(self):
        """Both tokenizers must satisfy the Tokenizer Protocol at runtime."""
        assert isinstance(get_tokenizer("fugashi"), Tokenizer)
        assert isinstance(get_tokenizer("sudachi"), Tokenizer)


# ---------------------------------------------------------------------------
# Shared base-Token contract (both backends)
# ---------------------------------------------------------------------------

class TestBaseContract:
    @pytest.mark.parametrize("fixture_name", ["fugashi", "sudachi_c"])
    def test_returns_list(self, request, fixture_name):
        """tokenize() must return a list for both backends."""
        t = request.getfixturevalue(fixture_name)
        assert isinstance(t.tokenize(TEXT), list)

    @pytest.mark.parametrize("fixture_name", ["fugashi", "sudachi_c"])
    def test_all_tokens_are_token_subclass(self, request, fixture_name):
        """Every item in the result must be a Token (or subclass) instance."""
        t = request.getfixturevalue(fixture_name)
        for tok in t.tokenize(TEXT):
            assert isinstance(tok, Token)

    @pytest.mark.parametrize("fixture_name", ["fugashi", "sudachi_c"])
    def test_base_fields_are_strings(self, request, fixture_name):
        """surface, reading, pos, and lemma must all be non-empty strings."""
        t = request.getfixturevalue(fixture_name)
        for tok in t.tokenize(TEXT):
            assert isinstance(tok.surface, str) and tok.surface
            assert isinstance(tok.reading, str) and tok.reading
            assert isinstance(tok.pos, str) and tok.pos
            assert isinstance(tok.lemma, str) and tok.lemma

    @pytest.mark.parametrize("fixture_name", ["fugashi", "sudachi_c"])
    def test_surfaces_reconstruct_input(self, request, fixture_name):
        """Joining all token surfaces must exactly reproduce the original input string."""
        t = request.getfixturevalue(fixture_name)
        assert "".join(tok.surface for tok in t.tokenize(TEXT)) == TEXT

    @pytest.mark.parametrize("fixture_name", ["fugashi", "sudachi_c"])
    def test_empty_string(self, request, fixture_name):
        """Tokenizing an empty string must return an empty list without errors."""
        t = request.getfixturevalue(fixture_name)
        assert t.tokenize("") == []


# ---------------------------------------------------------------------------
# Fugashi-specific
# ---------------------------------------------------------------------------

class TestFugashi:
    def test_returns_fugashi_tokens(self, fugashi):
        """Every token from FugashiTokenizer must be a FugashiToken instance."""
        for tok in fugashi.tokenize(TEXT):
            assert isinstance(tok, FugashiToken)

    def test_known_segmentation(self, fugashi):
        """unidic-lite splits 日本語 into 日本+語 (unlike Sudachi mode C)."""
        surfaces = [t.surface for t in fugashi.tokenize(TEXT)]
        assert "日本" in surfaces
        assert "語" in surfaces
        assert "文章" in surfaces
        assert "分割" in surfaces

    def test_etymology_field_populated(self, fugashi):
        """
        goshu (語種) encodes word origin:
          固 = proper noun, 漢 = Chinese-origin, 和 = native Japanese.
        """
        tokens = {t.surface: t for t in fugashi.tokenize(TEXT)}
        assert tokens["日本"].etymology == "固"
        assert tokens["語"].etymology == "漢"
        assert tokens["の"].etymology == "和"

    def test_kanji_token_has_reading(self, fugashi):
        """Kanji tokens must carry a katakana reading from the UniDic dictionary."""
        tokens = {t.surface: t for t in fugashi.tokenize(TEXT)}
        assert tokens["文章"].reading == "ブンショウ"

    def test_wildcard_fields_are_none(self, fugashi):
        """_clean() must strip '*' from all extra fields — none should survive as the literal string '*'."""
        for tok in fugashi.tokenize(TEXT):
            for val in [tok.pos2, tok.pos3, tok.pos4,
                        tok.conjugation_type, tok.conjugation_form,
                        tok.etymology]:
                assert val != "*"


# ---------------------------------------------------------------------------
# Sudachi-specific
# ---------------------------------------------------------------------------

class TestSudachi:
    def test_returns_sudachi_tokens(self, sudachi_c):
        """Every token from SudachiTokenizer must be a SudachiToken instance."""
        for tok in sudachi_c.tokenize(TEXT):
            assert isinstance(tok, SudachiToken)

    def test_mode_c_keeps_compound(self, sudachi_c):
        """Mode C (longest units) must keep 日本語 as a single token."""
        surfaces = [t.surface for t in sudachi_c.tokenize(TEXT)]
        assert "日本語" in surfaces

    def test_mode_a_splits_compound(self, sudachi_a):
        """Mode A (shortest units) must split 日本語 into 日本 and 語."""
        surfaces = [t.surface for t in sudachi_a.tokenize(TEXT)]
        assert "日本" in surfaces
        assert "語" in surfaces
        assert "日本語" not in surfaces

    def test_mode_c_reading(self, sudachi_c):
        """Sudachi must return the correct reading ニホンゴ for 日本語 (not ニッポン)."""
        tokens = {t.surface: t for t in sudachi_c.tokenize(TEXT)}
        assert tokens["日本語"].reading == "ニホンゴ"

    def test_normalized_form_populated(self, sudachi_c):
        """normalized_form must resolve orthographic variants — する normalizes to 為る."""
        tokens = {t.surface: t for t in sudachi_c.tokenize(TEXT)}
        assert tokens["する"].normalized_form == "為る"

    def test_wildcard_fields_are_none(self, sudachi_c):
        """_clean() must strip '*' from all extra fields — none should survive as the literal string '*'."""
        for tok in sudachi_c.tokenize(TEXT):
            for val in [tok.pos2, tok.pos3, tok.pos4,
                        tok.conjugation_type, tok.conjugation_form]:
                assert val != "*"
