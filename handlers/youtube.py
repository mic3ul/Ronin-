"""Arabic-friendly YouTube metadata search for groups and private chats."""

import html
import logging

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import (
    CommandObject,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from filters import ThrottleFilter
from services.youtube_search import (
    YouTubeSearchError,
    format_duration,
    search_youtube,
)

router = Router(name="youtube")
logger = logging.getLogger(__name__)


@router.message(
    Command("yt", "youtube", "يوت", "يوتيوب", "بحث", prefix="/!"),
    ThrottleFilter(interval=2, per_member=True, per_group=True),
    ThrottleFilter(interval=1, per_group=True),
)
async def youtube_search_command(message: Message, command: CommandObject) -> None:
    """Search YouTube and return metadata plus links without downloading media."""
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
        duration = format_duration(item["duration"])
        lines.append(f"<b>{index}.</b> {title}")
        details = " • ".join(part for part in (channel, duration) if part)
        if details:
            lines.append(f"<i>{details}</i>")
        rows.append([
            InlineKeyboardButton(
                text=f"▶ {index}. {item['title'][:48]}",
                url=item["url"],
            )
        ])

    lines.extend(["", "اضغط على النتيجة لفتحها في يوتيوب."])
    await status.edit_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        disable_web_page_preview=True,
    )
