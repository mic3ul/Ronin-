"""Lightweight YouTube search; returns public video metadata without downloading media."""

from __future__ import annotations

import asyncio
from typing import Any

from yt_dlp import YoutubeDL


class YouTubeSearchError(RuntimeError):
    """Raised when YouTube search cannot be completed."""


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
        if not url or not str(url).startswith("https://www.youtube.com/"):
            continue
        results.append({
            "title": str(item.get("title") or "Untitled video")[:180],
            "url": url,
            "duration": item.get("duration"),
            "channel": str(item.get("channel") or item.get("uploader") or "")[:80],
        })
    return results


async def search_youtube(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Search YouTube without downloading or rehosting copyrighted media."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_search_sync, query, max(1, min(limit, 5))),
            timeout=25,
        )
    except Exception as exc:
        raise YouTubeSearchError("YouTube search failed") from exc
