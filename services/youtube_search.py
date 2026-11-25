"""YouTube metadata search helpers; media is never downloaded or re-hosted."""

from __future__ import annotations

import asyncio
import math
import threading
from typing import Any
from urllib.parse import urlsplit

from yt_dlp import YoutubeDL


def normalize_duration(seconds: Any) -> int | None:
    """Return a safe, finite, non-negative duration in whole seconds."""
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
        return None
    if isinstance(seconds, int):
        return seconds if seconds >= 0 else None
    if not math.isfinite(seconds) or seconds < 0:
        return None
    return int(seconds)


def format_duration(seconds: int | float | None) -> str:
    """Format a duration for Telegram messages."""
    total = normalize_duration(seconds)
    if total is None:
        return "المدة غير معروفة"
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def is_youtube_url(url: str) -> bool:
    """Accept HTTPS URLs on an exact YouTube host and the default HTTPS port."""
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname in {"youtube.com", "www.youtube.com"}
            and parsed.port in (None, 443)
            and parsed.username is None
            and parsed.password is None
        )
    except (TypeError, ValueError):
        return False


class YouTubeSearchError(RuntimeError):
    """Raised when YouTube search cannot be completed."""


class YouTubeSearchBusyError(YouTubeSearchError):
    """Raised when all bounded YouTube metadata-search slots are occupied."""


MAX_CONCURRENT_SEARCHES = 3
_SEARCH_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_SEARCHES)
_SEARCH_TIMEOUT_SECONDS = 25


def _release_search_slot(worker: asyncio.Task[Any], slots: threading.BoundedSemaphore) -> None:
    """Consume a detached worker's result and release its concurrency slot."""
    try:
        worker.exception()
    except asyncio.CancelledError:
        pass
    finally:
        slots.release()


def _search_sync(query: str, limit: int) -> list[dict[str, Any]]:
    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "noplaylist": True,
        "socket_timeout": 12,
        "retries": 1,
        "extractor_retries": 1,
    }
    with YoutubeDL(options) as client:
        data = client.extract_info(f"ytsearch{limit}:{query}", download=False)

    results = []
    for item in (data or {}).get("entries") or []:
        if not item:
            continue
        video_id = item.get("id")
        url = item.get("webpage_url")
        if not url and video_id:
            url = f"https://www.youtube.com/watch?v={video_id}"
        if not url or not is_youtube_url(str(url)):
            continue
        results.append({
            "title": str(item.get("title") or "Untitled video")[:180],
            "url": str(url),
            "duration": normalize_duration(item.get("duration")),
            "channel": str(item.get("channel") or item.get("uploader") or "")[:80],
        })
    return results


async def search_youtube(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Search YouTube metadata without downloading media.

    A process-wide semaphore bounds yt-dlp work across groups. If a search
    times out or its caller is cancelled, its slot remains occupied until the
    underlying thread actually finishes; cancelling to_thread alone does not
    stop that thread.
    """
    safe_limit = max(1, min(limit, 5))
    slots = _SEARCH_SLOTS
    if not slots.acquire(blocking=False):
        raise YouTubeSearchBusyError("YouTube search concurrency limit reached")

    release_when_worker_finishes = False
    try:
        worker = asyncio.create_task(asyncio.to_thread(_search_sync, query, safe_limit))
        try:
            return await asyncio.wait_for(
                asyncio.shield(worker),
                timeout=_SEARCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            release_when_worker_finishes = True
            worker.add_done_callback(lambda task: _release_search_slot(task, slots))
            raise YouTubeSearchError("YouTube search timed out") from exc
        except asyncio.CancelledError:
            release_when_worker_finishes = True
            worker.add_done_callback(lambda task: _release_search_slot(task, slots))
            raise
        except Exception as exc:
            raise YouTubeSearchError("YouTube search failed") from exc
    finally:
        if not release_when_worker_finishes:
            slots.release()
