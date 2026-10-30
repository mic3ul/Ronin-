import importlib.util
from pathlib import Path

import pytest

# Load the service module directly so unit tests do not import the bot-wide
# services package (which initializes unrelated configuration and ML modules).
MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "youtube_search.py"
SPEC = importlib.util.spec_from_file_location("ronin_youtube_search", MODULE_PATH)
youtube_search = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(youtube_search)

format_duration = youtube_search.format_duration


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0, "0:00"),
        (65, "1:05"),
        (3600, "1:00:00"),
        (3661, "1:01:01"),
        (None, "المدة غير معروفة"),
        (-1, "المدة غير معروفة"),
        ("unknown", "المدة غير معروفة"),
    ],
)
def test_duration_formatting(seconds, expected):
    assert format_duration(seconds) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=abc",
        "https://youtube.com/watch?v=abc",
    ],
)
def test_accepts_real_youtube_hosts(url):
    assert youtube_search.is_youtube_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://www.youtube.com/watch?v=abc",
        "https://www.youtube.com.evil.example/watch?v=abc",
        "https://youtube.com.evil.example/watch?v=abc",
        "https://notyoutube.com/watch?v=abc",
        "https://www.youtube.com@evil.example/watch?v=abc",
        "https://www.youtube.com:443/watch?v=abc",
        "javascript://youtube.com/watch?v=abc",
    ],
)
def test_rejects_untrusted_youtube_urls(url):
    assert not youtube_search.is_youtube_url(url)


def test_search_youtube_normalizes_results(monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, query, download=False):
            assert query == "ytsearch2:test song"
            assert download is False
            return {
                "entries": [
                    {
                        "id": "abc123",
                        "title": "Test song",
                        "channel": "Test channel",
                        "duration": 123,
                    },
                    None,
                ]
            }

    monkeypatch.setattr(youtube_search, "YoutubeDL", FakeYoutubeDL)
    results = youtube_search._search_sync("test song", 2)

    assert results == [
        {
            "title": "Test song",
            "url": "https://www.youtube.com/watch?v=abc123",
            "duration": 123,
            "channel": "Test channel",
        }
    ]


def test_search_youtube_rejects_non_youtube_url(monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, options):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, query, download=False):
            return {
                "entries": [
                    {
                        "id": "bad",
                        "title": "Bad URL",
                        "webpage_url": "https://www.youtube.com.evil.example/watch?v=bad",
                    }
                ]
            }

    monkeypatch.setattr(youtube_search, "YoutubeDL", FakeYoutubeDL)
    assert youtube_search._search_sync("test", 1) == []
