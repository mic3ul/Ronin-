import asyncio
import importlib.util
import threading
import time
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
        (float("nan"), "المدة غير معروفة"),
        (float("inf"), "المدة غير معروفة"),
        (True, "المدة غير معروفة"),
    ],
)
def test_duration_formatting(seconds, expected):
    assert format_duration(seconds) == expected


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=abc",
        "https://youtube.com/watch?v=abc",
        "https://www.youtube.com:443/watch?v=abc",
    ],
)
def test_accepts_real_youtube_hosts(url):
    assert youtube_search.is_youtube_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://www.youtube.com/watch?v=abc",
        "https://www.youtube.com:444/watch?v=abc",
        "https://www.youtube.com.evil.example/watch?v=abc",
        "https://youtube.com.evil.example/watch?v=abc",
        "https://notyoutube.com/watch?v=abc",
        "https://www.youtube.com@evil.example/watch?v=abc",
        "javascript://youtube.com/watch?v=abc",
    ],
)
def test_rejects_untrusted_youtube_urls(url):
    assert not youtube_search.is_youtube_url(url)


def test_search_youtube_normalizes_results(monkeypatch):
    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options
            assert options["skip_download"] is True

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


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (123.9, 123),
        (0, 0),
        (None, None),
        ("123", None),
        (True, None),
        (-1, None),
        (float("nan"), None),
        (float("inf"), None),
        (10**1000, 10**1000),
    ],
)
def test_duration_normalization(value, expected):
    assert youtube_search.normalize_duration(value) == expected


@pytest.mark.asyncio
async def test_search_youtube_caps_result_count(monkeypatch):
    calls = {}

    def fake_search(query, limit):
        calls["query"] = query
        calls["limit"] = limit
        return []

    monkeypatch.setattr(youtube_search, "_search_sync", fake_search)
    assert await youtube_search.search_youtube("test", limit=50) == []
    assert calls == {"query": "test", "limit": 5}


@pytest.mark.asyncio
async def test_search_youtube_bounds_parallel_extractions(monkeypatch):
    slots = threading.BoundedSemaphore(youtube_search.MAX_CONCURRENT_SEARCHES)
    monkeypatch.setattr(youtube_search, "_SEARCH_SLOTS", slots)
    active = 0
    peak = 0
    lock = threading.Lock()

    def fake_search(query, limit):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return []

    monkeypatch.setattr(youtube_search, "_search_sync", fake_search)
    results = await asyncio.gather(
        *(youtube_search.search_youtube(f"query {index}") for index in range(8)),
        return_exceptions=True,
    )

    assert peak == youtube_search.MAX_CONCURRENT_SEARCHES
    assert sum(isinstance(item, youtube_search.YouTubeSearchBusyError) for item in results) == 5
    assert sum(item == [] for item in results) == youtube_search.MAX_CONCURRENT_SEARCHES


@pytest.mark.asyncio
async def test_timed_out_search_keeps_slot_until_thread_finishes(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(youtube_search, "_SEARCH_SLOTS", slots)
    monkeypatch.setattr(youtube_search, "_SEARCH_TIMEOUT_SECONDS", 0.01)
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    calls = 0
    lock = threading.Lock()

    def slow_search(query, limit):
        nonlocal calls
        with lock:
            calls += 1
        started.set()
        release.wait(timeout=1)
        finished.set()
        return []

    monkeypatch.setattr(youtube_search, "_search_sync", slow_search)
    first = asyncio.create_task(youtube_search.search_youtube("slow query"))

    try:
        assert await asyncio.to_thread(started.wait, 1)
        with pytest.raises(youtube_search.YouTubeSearchError) as error:
            await first
        assert not isinstance(error.value, youtube_search.YouTubeSearchBusyError)

        with pytest.raises(youtube_search.YouTubeSearchBusyError):
            await youtube_search.search_youtube("queued query")
        assert calls == 1
    finally:
        release.set()

    assert await asyncio.to_thread(finished.wait, 1)
    await asyncio.sleep(0)
    assert slots.acquire(blocking=False)


@pytest.mark.asyncio
async def test_cancelled_search_keeps_slot_until_thread_finishes(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(youtube_search, "_SEARCH_SLOTS", slots)
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def slow_search(query, limit):
        started.set()
        release.wait(timeout=1)
        finished.set()
        return []

    monkeypatch.setattr(youtube_search, "_search_sync", slow_search)
    first = asyncio.create_task(youtube_search.search_youtube("cancelled query"))

    try:
        assert await asyncio.to_thread(started.wait, 1)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first

        with pytest.raises(youtube_search.YouTubeSearchBusyError):
            await youtube_search.search_youtube("replacement query")
    finally:
        release.set()

    assert await asyncio.to_thread(finished.wait, 1)
    await asyncio.sleep(0)
    assert slots.acquire(blocking=False)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("query", "limit"),
    [
        (None, 5),
        (123, 5),
        ("", 5),
        (" \\t\\n", 5),
        ("x" * 161, 5),
        ("test", True),
        ("test", 1.5),
        ("test", "2"),
        ("test", None),
    ],
)
async def test_search_youtube_rejects_invalid_inputs_without_acquiring_slot(
    monkeypatch, query, limit
):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(youtube_search, "_SEARCH_SLOTS", slots)

    def unexpected_search(*args):
        raise AssertionError("invalid input must not start a yt-dlp worker")

    monkeypatch.setattr(youtube_search, "_search_sync", unexpected_search)
    with pytest.raises(youtube_search.YouTubeSearchError):
        await youtube_search.search_youtube(query, limit=limit)

    assert slots.acquire(blocking=False)


@pytest.mark.asyncio
async def test_search_youtube_trims_query_before_search(monkeypatch):
    calls = {}

    def fake_search(query, limit):
        calls["query"] = query
        calls["limit"] = limit
        return []

    monkeypatch.setattr(youtube_search, "_search_sync", fake_search)
    assert await youtube_search.search_youtube("  test song \\n") == []
    assert calls == {"query": "test song", "limit": 5}
