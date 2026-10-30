import pytest

from handlers.youtube import _duration
from services import youtube_search


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
    assert _duration(seconds) == expected


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
