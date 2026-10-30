"""YouTube search and bounded audio retrieval helpers."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from pathlib import Path
from typing import Any

from yt_dlp import YoutubeDL

MAX_AUDIO_BYTES = 45_000_000
MAX_AUDIO_SECONDS = 15 * 60
_DOWNLOADS = asyncio.Semaphore(2)


def format_duration(seconds: int | float | None) -> str:
    """Format a duration for Telegram messages."""
    if not isinstance(seconds, (int, float)) or seconds < 0:
        return "المدة غير معروفة"
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


class YouTubeSearchError(RuntimeError):
    """Raised when YouTube search cannot be completed."""


class YouTubeAudioError(RuntimeError):
    """Raised when a selected track cannot be prepared for Telegram."""


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
    """Search YouTube without downloading media."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_search_sync, query, max(1, min(limit, 5))),
            timeout=25,
        )
    except Exception as exc:
        raise YouTubeSearchError("YouTube search failed") from exc


def _download_audio_sync(url: str) -> tuple[str, str]:
    if not url.startswith("https://www.youtube.com/"):
        raise YouTubeAudioError("Only YouTube result URLs are accepted")

    workdir = tempfile.mkdtemp(prefix="ronin-audio-")
    options = {
        "format": f"bestaudio[filesize<={MAX_AUDIO_BYTES}]/bestaudio",
        "outtmpl": str(Path(workdir) / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 15,
        "retries": 1,
        "max_filesize": MAX_AUDIO_BYTES,
        "match_filter": (
            lambda info, *, incomplete: "Track is longer than 15 minutes"
            if info.get("duration") and info["duration"] > MAX_AUDIO_SECONDS
            else None
        ),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "128",
        }],
    }

    try:
        with YoutubeDL(options) as client:
            info = client.extract_info(url, download=True)
        files = list(Path(workdir).glob("*.mp3"))
        if not files:
            raise YouTubeAudioError("Audio conversion did not produce an MP3 file")
        audio_path = files[0]
        if audio_path.stat().st_size > MAX_AUDIO_BYTES:
            raise YouTubeAudioError("Audio file exceeds Telegram upload limit")
        title = str((info or {}).get("title") or "YouTube audio")[:180]
        return str(audio_path), title
    except Exception as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        if isinstance(exc, YouTubeAudioError):
            raise
        raise YouTubeAudioError("Audio could not be downloaded or converted") from exc


async def download_youtube_audio(url: str) -> tuple[str, str]:
    """Prepare a short audio track; caller must remove the returned file's parent directory."""
    async with _DOWNLOADS:
        try:
            return await asyncio.to_thread(_download_audio_sync, url)
        except YouTubeAudioError:
            raise
        except Exception as exc:
            raise YouTubeAudioError("Audio preparation failed") from exc
