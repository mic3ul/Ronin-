"""YouTube search commands."""

import html
import logging

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message

from services.youtube_search import YouTubeSearchError, search_youtube

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
async def youtube_search_command(message: Message) -> None:
    """Find YouTube videos from a short text query."""
    query = (message.text or "").partition(" ")[2].strip()
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
