"""discord.py (2.x) helpers on top of ReceiptClient.

    receipts = DiscordReceipts(ReceiptClient())
    await receipts.send(channel, data)                    # post a receipt directly
    view = await receipts.checkout(interaction, data)     # preview, pick a style, send
    await view.wait()                                     # view.status: sent / cancelled / timeout
    view = await receipts.style_view(interaction.guild_id)  # server-wide default style
"""

from __future__ import annotations

import io
import logging
from typing import Any, Optional, Protocol

import discord

from receipt_client import ReceiptClient, ReceiptServiceError

log = logging.getLogger(__name__)

MAX_SELECT_OPTIONS = 25
# Interaction tokens expire after 15 minutes; the panel must close before that.
MAX_CHECKOUT_TIMEOUT = 14 * 60


class StyleStore(Protocol):
    async def get(self, guild_id: Optional[int]) -> str: ...

    async def set(self, guild_id: Optional[int], template: str) -> None: ...


class MemoryStyleStore:
    """Per-guild style preference kept in memory. Any object with async get/set works."""

    def __init__(self, default_template: str = "thermal"):
        self.default_template = default_template
        self._styles: dict[Optional[int], str] = {}

    async def get(self, guild_id: Optional[int]) -> str:
        return self._styles.get(guild_id, self.default_template)

    async def set(self, guild_id: Optional[int], template: str) -> None:
        self._styles[guild_id] = template


def style_options(templates: list[dict[str, Any]], current: str) -> list[discord.SelectOption]:
    return [
        discord.SelectOption(
            label=f"{t['code']} {t['name']}",
            value=t["id"],
            description=(t.get("description") or "")[:100] or None,
            default=t["id"] == current,
        )
        for t in templates[:MAX_SELECT_OPTIONS]
    ]


def mark_default(select: discord.ui.Select, value: str) -> None:
    for option in select.options:
        option.default = option.value == value


class DiscordReceipts:
    def __init__(
        self,
        client: ReceiptClient,
        store: Optional[StyleStore] = None,
        preview_data: Optional[dict[str, Any]] = None,
        filename: str = "receipt.png",
    ):
        self.client = client
        self.store = store or MemoryStyleStore()
        self.preview_data = preview_data
        self.filename = filename

    async def file(self, guild_id: Optional[int], data: dict[str, Any], template: Optional[str] = None) -> discord.File:
        """Renders ``data`` with the guild's style (or ``template``) as an attachment."""
        png = await self.client.render(template or await self.store.get(guild_id), data)
        return discord.File(io.BytesIO(png), filename=self.filename)

    async def send(
        self, channel: discord.abc.Messageable, data: dict[str, Any], template: Optional[str] = None
    ) -> discord.Message:
        guild = getattr(channel, "guild", None)
        return await channel.send(file=await self.file(guild.id if guild else None, data, template))

    async def style_view(self, guild_id: Optional[int]) -> "StyleView":
        templates = await self.client.list_templates()
        return StyleView(self, templates, await self.store.get(guild_id))

    async def checkout(
        self,
        interaction: discord.Interaction,
        data: dict[str, Any],
        destination: Optional[discord.abc.Messageable] = None,
        content: Optional[str] = None,
        timeout: float = 300,
    ) -> "CheckoutView":
        """Final step of an order: an ephemeral preview with a style menu and send/cancel buttons.

        Posts to ``destination`` (defaults to the interaction's channel) when the user
        presses send. ``await view.wait()`` and read ``view.status`` / ``view.template``.
        Works on a fresh interaction or one that was already responded to.
        """
        if not interaction.response.is_done():
            await interaction.response.defer(ephemeral=True, thinking=True)

        templates = await self.client.list_templates()
        view = CheckoutView(
            self,
            data,
            templates,
            template=await self.store.get(interaction.guild_id),
            user_id=interaction.user.id,
            destination=destination or interaction.channel,
            content=content,
            timeout=min(timeout, MAX_CHECKOUT_TIMEOUT),
        )
        view.message = await interaction.followup.send(
            CheckoutView.PROMPT, file=await view.receipt_file(), view=view, ephemeral=True, wait=True
        )
        return view


class ReceiptView(discord.ui.View):
    async def on_error(self, interaction: discord.Interaction, error: Exception, item: discord.ui.Item) -> None:
        if isinstance(error, ReceiptServiceError):
            message = f"收據產生失敗：{error}"
        else:
            log.exception("receipt view failed", exc_info=error)
            message = "操作失敗，請稍後再試。"
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)


class StyleSelect(discord.ui.Select["StyleView"]):
    def __init__(self, templates: list[dict[str, Any]], current: str):
        super().__init__(placeholder="選擇收據樣式", options=style_options(templates, current))

    async def callback(self, interaction: discord.Interaction) -> None:
        view = self.view
        template = self.values[0]
        await interaction.response.defer()
        await view.receipts.store.set(interaction.guild_id, template)
        mark_default(self, template)

        attachments = []
        if view.receipts.preview_data is not None:
            attachments.append(await view.receipts.file(interaction.guild_id, view.receipts.preview_data, template))
        await interaction.edit_original_response(
            content="已套用，之後的收據會使用這個樣式。", attachments=attachments, view=view
        )


class StyleView(ReceiptView):
    def __init__(self, receipts: DiscordReceipts, templates: list[dict[str, Any]], current: str):
        super().__init__(timeout=300)
        self.receipts = receipts
        self.add_item(StyleSelect(templates, current))


class CheckoutStyleSelect(discord.ui.Select["CheckoutView"]):
    def __init__(self, templates: list[dict[str, Any]], current: str):
        super().__init__(placeholder="選擇收據樣式", options=style_options(templates, current), row=0)

    async def callback(self, interaction: discord.Interaction) -> None:
        view = self.view
        view.template = self.values[0]
        await interaction.response.defer()
        mark_default(self, view.template)
        await interaction.edit_original_response(attachments=[await view.receipt_file()], view=view)


class CheckoutView(ReceiptView):
    PROMPT = "結單確認：選擇收據樣式後按「送出收據」。"

    def __init__(
        self,
        receipts: DiscordReceipts,
        data: dict[str, Any],
        templates: list[dict[str, Any]],
        *,
        template: str,
        user_id: int,
        destination: discord.abc.Messageable,
        content: Optional[str] = None,
        timeout: float = 300,
    ):
        super().__init__(timeout=timeout)
        self.receipts = receipts
        self.data = data
        self.template = template
        self.user_id = user_id
        self.destination = destination
        self.content = content
        self.status = "timeout"
        self.message: Optional[discord.WebhookMessage] = None
        self.sent_message: Optional[discord.Message] = None
        self._rendered: dict[str, bytes] = {}
        self.add_item(CheckoutStyleSelect(templates, template))

    async def receipt_file(self) -> discord.File:
        if self.template not in self._rendered:
            self._rendered[self.template] = await self.receipts.client.render(self.template, self.data)
        return discord.File(io.BytesIO(self._rendered[self.template]), filename=self.receipts.filename)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return interaction.user.id == self.user_id

    @discord.ui.button(label="送出收據", style=discord.ButtonStyle.success, row=1)
    async def send_receipt(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.defer()
        self.sent_message = await self.destination.send(content=self.content, file=await self.receipt_file())
        self.status = "sent"
        self.stop()
        await interaction.edit_original_response(content="收據已送出。", view=None)

    @discord.ui.button(label="取消", style=discord.ButtonStyle.secondary, row=1)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.status = "cancelled"
        self.stop()
        await interaction.response.edit_message(content="已取消，沒有送出收據。", attachments=[], view=None)

    async def on_timeout(self) -> None:
        if self.message is not None:
            await self.message.edit(content="結單面板已逾時，沒有送出收據。", attachments=[], view=None)
