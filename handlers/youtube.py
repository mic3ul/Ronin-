"""YouTube search and group audio commands."""

import html
import logging
import shutil
from pathlib import Path

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import CommandObject, InlineKeyboardButton, InlineKeyboardMarkup, Message
from aiogram.types.input_file import FSInputFile

from services.youtube_search import (
    YouTubeAudioError,
    YouTubeSearchError,
    download_youtube_audio,
    search_youtube,
)

router = Router(name="youtube")
logger = logging.getLogger(__name__)


def _duration(seconds: int | float | None) -> str:
    if not isinstance(seconds, (int, float)) or seconds < 0:
        return "المدة غير معروفة"
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


@router.message(Command("yt", "youtube", "يوت", "يوتيوب", "بحث", prefix="/!"))
async def youtube_search_command(message: Message, command: CommandObject) -> None:
    """Find YouTube videos from a short text query."""
    query = (command.args or "").strip()
    if not query:
        await message.reply(
            "🎧 <b>بحث يوتيوب</b>\n"
            "اكتب اسم الأغنية أو الفيديو بعد الأمر.\n\n"
            "<code>/yt The Weeknd - Blinding Lights</code>"
        )
        return
    if len(query) > 160:
        await message.reply("الطلب طويل جداً. اختصره إلى 160 حرفاً.")
        return

    status = await message.reply("🔎 أبحث في يوتيوب…")
    try:
        results = await search_youtube(query, limit=5)
    except YouTubeSearchError:
        logger.exception("YouTube search failed")
        await status.edit_text("تعذّر البحث حالياً. حاول مرة أخرى بعد قليل.")
        return

    if not results:
        await status.edit_text("لم أجد نتائج مطابقة. جرّب كلمات مختلفة.")
        return

    rows = []
    lines = ["🎧 <b>نتائج يوتيوب</b>", ""]
    for index, item in enumerate(results, start=1):
        title = html.escape(item["title"])
        channel = html.escape(item["channel"])
        duration = _duration(item["duration"])
        lines.append(f"<b>{index}.</b> {title}")
        details = " • ".join(part for part in (channel, duration) if part)
        if details:
            lines.append(f"<i>{details}</i>")
        rows.append([InlineKeyboardButton(
            text=f"▶ {index}. {item['title'][:48]}",
            url=item["url"],
        )])

    lines.extend(["", "اضغط على النتيجة لفتحها في يوتيوب."])
    await status.edit_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        disable_web_page_preview=True,
    )


@router.message(Command("play", "music", "شغل", "اغنية", "أغنية", prefix="/!"))
async def youtube_play_command(message: Message, command: CommandObject) -> None:
    """Find the best YouTube match and send a short audio file to the chat."""
    query = (command.args or "").strip()
    if not query:
        await message.reply(
            "🎵 اكتب اسم الأغنية بعد الأمر.\n"
            "<code>/play اسم الأغنية</code>\n"
            "يُسمح بمقاطع تصل إلى 15 دقيقة و45 MB."
        )
        return
    if len(query) > 160:
        await message.reply("الطلب طويل جداً. اختصره إلى 160 حرفاً.")
        return

    status = await message.reply("🔎 أبحث عن الأغنية…")
    try:
        results = await search_youtube(query, limit=1)
    except YouTubeSearchError:
        logger.exception("YouTube search failed for playback")
        await status.edit_text("تعذّر البحث حالياً. حاول مرة أخرى بعد قليل.")
        return

    if not results:
        await status.edit_text("لم أجد أغنية مطابقة. جرّب اسماً آخر.")
        return

    selected = results[0]
    duration = selected.get("duration")
    if duration and duration > 15 * 60:
        await status.edit_text("الأغنية أطول من الحد المسموح (15 دقيقة).")
        return

    audio_path = None
    try:
        await status.edit_text("⬇️ أجهّز الملف الصوتي…")
        audio_path, title = await download_youtube_audio(selected["url"])
        await message.answer_audio(
            audio=FSInputFile(audio_path, filename=f"{title}.mp3"),
            title=title,
            performer=selected.get("channel") or None,
            caption=f"🎵 <b>{html.escape(title)}</b>\n"
                    "<i>تم الإرسال بناءً على طلب المجموعة.</i>",
        )
        await status.delete()
    except YouTubeAudioError:
        logger.exception("YouTube audio preparation failed")
        await status.edit_text(
            "تعذّر تجهيز الصوت. قد يكون المقطع محمياً أو أطول/أكبر من الحد، "
            "أو أن FFmpeg غير مثبت."
        )
    except Exception:
        logger.exception("Failed to send YouTube audio to chat")
        await status.edit_text("فشل إرسال الملف الصوتي. تحقق من اتصال البوت وحاول مجدداً.")
    finally:
        if audio_path:
            shutil.rmtree(str(Path(audio_path).parent), ignore_errors=True)
