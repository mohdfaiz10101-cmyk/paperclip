#!/usr/bin/env python3
"""Paperclip Discord Bot -- bridges Discord channels to Paperclip agents.

Routes messages from configured Discord channels to Paperclip agents via the
Paperclip REST API, polls for completion, and posts responses back as rich
Discord embeds.

Environment variables:
    DISCORD_TOKEN          Discord bot token (required)
    PAPERCLIP_URL          Paperclip API base URL (default: http://localhost:3100)
    PAPERCLIP_COMPANY_ID   Company ID to use (required)
    PAPERCLIP_API_KEY      Agent API key for authenticating with Paperclip (required)
    CHANNEL_AGENT_MAP      JSON mapping of Discord channel IDs to agent IDs (required)
    POLL_INTERVAL_SECONDS  Seconds between issue status polls (default: 5)
    POLL_TIMEOUT_SECONDS   Maximum seconds to wait for agent response (default: 300)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
import discord
from discord.ext import commands

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DISCORD_TOKEN: str = os.environ.get("DISCORD_TOKEN", "")
PAPERCLIP_URL: str = os.environ.get("PAPERCLIP_URL", "http://localhost:3100").rstrip("/")
PAPERCLIP_COMPANY_ID: str = os.environ.get("PAPERCLIP_COMPANY_ID", "")
PAPERCLIP_API_KEY: str = os.environ.get("PAPERCLIP_API_KEY", "")
POLL_INTERVAL: int = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
POLL_TIMEOUT: int = int(os.environ.get("POLL_TIMEOUT_SECONDS", "300"))

_raw_map: str = os.environ.get("CHANNEL_AGENT_MAP", "{}")
CHANNEL_AGENT_MAP: Dict[str, str] = json.loads(_raw_map)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("paperclip-discord")

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_REQUIRED_VARS: Dict[str, str] = {
    "DISCORD_TOKEN": DISCORD_TOKEN,
    "PAPERCLIP_COMPANY_ID": PAPERCLIP_COMPANY_ID,
}

_missing = [name for name, value in _REQUIRED_VARS.items() if not value]
if _missing:
    logger.error("Missing required environment variables: %s", ", ".join(_missing))
    sys.exit(1)

if not PAPERCLIP_API_KEY:
    logger.warning(
        "PAPERCLIP_API_KEY is not set. API requests may fail if the "
        "Paperclip server requires authentication."
    )

if not CHANNEL_AGENT_MAP:
    logger.warning(
        "CHANNEL_AGENT_MAP is empty -- no channels will be monitored. "
        "Set CHANNEL_AGENT_MAP as a JSON object like "
        '{"1234567890": "agent-uuid-here"}.'
    )

# ---------------------------------------------------------------------------
# Paperclip API client
# ---------------------------------------------------------------------------

TERMINAL_STATUSES: frozenset[str] = frozenset({"done", "cancelled"})


@dataclass(frozen=True)
class PaperclipIssue:
    """Lightweight representation of a Paperclip issue."""

    id: str
    identifier: str
    title: str
    status: str
    description: Optional[str]
    assignee_agent_id: Optional[str]


async def create_issue(
    session: aiohttp.ClientSession,
    channel_id: str,
    message: discord.Message,
    agent_id: str,
) -> PaperclipIssue:
    """Create a Paperclip issue from a Discord message."""

    url = f"{PAPERCLIP_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/issues"
    author = message.author.display_name
    payload: Dict[str, Any] = {
        "title": f"[Discord] {message.content[:200]}",
        "description": (
            f"**From:** {author} in <#{channel_id}>\n"
            f"**Message URL:** {message.jump_url}\n\n"
            f"{message.content}"
        ),
        "assigneeAgentId": agent_id,
        "originKind": "discord",
        "originId": str(message.id),
        "metadata": {
            "discord_channel_id": channel_id,
            "discord_message_id": str(message.id),
            "discord_author_id": str(message.author.id),
            "discord_author_name": author,
        },
    }

    logger.info(
        "Creating issue for agent %s from channel %s (message %s)",
        agent_id,
        channel_id,
        message.id,
    )
    async with session.post(url, json=payload) as resp:
        resp.raise_for_status()
        data = await resp.json()

    return PaperclipIssue(
        id=data["id"],
        identifier=data.get("identifier", data["id"][:8]),
        title=data["title"],
        status=data.get("status", "todo"),
        description=data.get("description"),
        assignee_agent_id=data.get("assigneeAgentId"),
    )


async def poll_issue_until_done(
    session: aiohttp.ClientSession,
    issue_id: str,
) -> Dict[str, Any]:
    """Poll an issue until it reaches a terminal status or times out."""

    url = f"{PAPERCLIP_URL}/api/issues/{issue_id}"
    deadline = time.monotonic() + POLL_TIMEOUT
    data: Dict[str, Any] = {}

    while time.monotonic() < deadline:
        async with session.get(url) as resp:
            resp.raise_for_status()
            data = await resp.json()

        status = data.get("status", "unknown")
        if status in TERMINAL_STATUSES:
            return data

        logger.debug("Issue %s status: %s -- polling again", issue_id, status)
        await asyncio.sleep(POLL_INTERVAL)

    logger.warning("Polling timed out for issue %s after %ds", issue_id, POLL_TIMEOUT)
    return data


async def get_issue_comments(
    session: aiohttp.ClientSession,
    issue_id: str,
) -> List[Dict[str, Any]]:
    """Retrieve comments for an issue, newest first."""

    url = f"{PAPERCLIP_URL}/api/issues/{issue_id}/comments"
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()


async def list_agents(
    session: aiohttp.ClientSession,
) -> List[Dict[str, Any]]:
    """List all agents in the configured company."""

    url = f"{PAPERCLIP_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/agents"
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()


async def get_cost_summary(
    session: aiohttp.ClientSession,
) -> Dict[str, Any]:
    """Retrieve cost summary for the configured company."""

    url = f"{PAPERCLIP_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/costs/summary"
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()


async def get_cost_by_agent(
    session: aiohttp.ClientSession,
) -> List[Dict[str, Any]]:
    """Retrieve per-agent cost breakdown."""

    url = f"{PAPERCLIP_URL}/api/companies/{PAPERCLIP_COMPANY_ID}/costs/by-agent"
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def build_response_embed(
    agent_name: str,
    agent_role: str,
    response_text: str,
    issue_identifier: str,
    cost_info: Optional[Dict[str, Any]] = None,
) -> discord.Embed:
    """Build a rich Discord embed for an agent response.

    Discord embed limits: title 256 chars, description 4096 chars,
    field name 256 chars, field value 1024 chars, max 25 fields.
    """

    embed = discord.Embed(
        title=f"{agent_name} ({agent_role})"[:256],
        colour=discord.Color.blue(),
    )

    truncated = (
        response_text[:4000] + "..." if len(response_text) > 4000 else response_text
    )
    embed.description = truncated

    embed.add_field(name="Issue", value=issue_identifier, inline=True)

    if cost_info:
        total_cents = cost_info.get("totalCostCents", 0)
        token_count = cost_info.get("totalTokens", 0)
        cost_display = f"${total_cents / 100:.2f}" if total_cents else "N/A"
        embed.add_field(name="Cost", value=cost_display, inline=True)
        if token_count:
            embed.add_field(name="Tokens", value=str(token_count), inline=True)

    return embed


def _extract_agent_response(
    issue_data: Dict[str, Any],
    comments: List[Dict[str, Any]],
) -> str:
    """Extract the agent response text from issue data and comments.

    Strategy:
      1. Use the most recent agent-authored comment.
      2. Fall back to the issue description.
      3. Fall back to the issue status as a short summary.
    """

    agent_comments: List[Dict[str, Any]] = [
        c for c in comments if c.get("agentId") is not None
    ]

    if agent_comments:
        return agent_comments[-1].get("body", "")

    description = issue_data.get("description", "")
    if description:
        return description

    return f"Issue completed with status: {issue_data.get('status', 'unknown')}"


# ---------------------------------------------------------------------------
# Bot setup
# ---------------------------------------------------------------------------

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True

bot = commands.Bot(command_prefix="/", intents=intents)
_bot_session: Optional[aiohttp.ClientSession] = None


def _get_session() -> aiohttp.ClientSession:
    """Return the shared aiohttp session, raising if not initialized."""
    if _bot_session is None:
        raise RuntimeError("aiohttp session not initialized -- call setup_hook first")
    return _bot_session


async def _ensure_session() -> aiohttp.ClientSession:
    """Create the shared aiohttp session lazily."""
    global _bot_session
    if _bot_session is None or _bot_session.closed:
        headers: Dict[str, str] = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if PAPERCLIP_API_KEY:
            headers["Authorization"] = f"Bearer {PAPERCLIP_API_KEY}"
        _bot_session = aiohttp.ClientSession(
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=60),
        )
    return _bot_session


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@bot.event
async def on_ready() -> None:
    """Called when the bot is connected and ready."""
    logger.info(
        "Logged in as %s (id=%s). Monitoring %d channel(s).",
        bot.user,
        bot.user.id if bot.user else "unknown",
        len(CHANNEL_AGENT_MAP),
    )
    try:
        synced = await bot.tree.sync()
        logger.info("Synced %d slash command(s).", len(synced))
    except discord.HTTPException:
        logger.exception("Failed to sync slash commands")


@bot.event
async def on_message(message: discord.Message) -> None:
    """Handle incoming messages in mapped channels."""

    # Ignore messages from bots (including ourselves).
    if message.author.bot:
        return

    channel_id = str(message.channel.id)
    agent_id = CHANNEL_AGENT_MAP.get(channel_id)

    if agent_id is None:
        return

    # Must have content to create an issue.
    if not message.content.strip():
        return

    session = _get_session()

    try:
        # React to acknowledge receipt.
        await message.add_reaction("\U0001F4EC")  # inbox tray

        issue = await create_issue(session, channel_id, message, agent_id)
        logger.info(
            "Created issue %s for message %s in channel %s",
            issue.identifier,
            message.id,
            channel_id,
        )

        # Poll until the agent finishes.
        issue_data = await poll_issue_until_done(session, issue.id)

        # Fetch comments to find the agent response.
        comments = await get_issue_comments(session, issue.id)

        response_text = _extract_agent_response(issue_data, comments)

        # Look up the agent name for the embed header.
        agent_name = "Agent"
        agent_role = ""
        try:
            agents_list = await list_agents(session)
            for a in agents_list:
                if a.get("id") == agent_id:
                    agent_name = a.get("name", "Agent")
                    agent_role = a.get("role", "")
                    break
        except aiohttp.ClientError:
            logger.warning("Could not fetch agent list for embed name")

        embed = build_response_embed(
            agent_name=agent_name,
            agent_role=agent_role,
            response_text=response_text,
            issue_identifier=issue.identifier,
        )

        await message.reply(embed=embed)
        await message.add_reaction("\U00002705")  # check mark

    except aiohttp.ClientResponseError as exc:
        logger.exception("API error processing message %s", message.id)
        await message.reply(
            f"Error communicating with Paperclip API: {exc.status} {exc.message}",
        )
        await message.add_reaction("\U0000274C")  # cross mark

    except Exception:
        logger.exception("Unexpected error processing message %s", message.id)
        await message.reply("An unexpected error occurred while processing your request.")
        await message.add_reaction("\U0000274C")


# ---------------------------------------------------------------------------
# Slash commands
# ---------------------------------------------------------------------------

@bot.tree.command(name="agents", description="List available Paperclip agents")
async def agents_command(interaction: discord.Interaction) -> None:
    """List all agents in the configured company."""

    await interaction.response.defer(thinking=True)
    session = _get_session()

    try:
        agents = await list_agents(session)
    except aiohttp.ClientError:
        logger.exception("Failed to list agents")
        await interaction.followup.send("Failed to fetch agents from Paperclip.")
        return

    if not agents:
        await interaction.followup.send("No agents found.")
        return

    embed = discord.Embed(
        title="Paperclip Agents",
        colour=discord.Color.green(),
    )

    for agent in agents[:25]:  # Discord embed field limit is 25.
        name = agent.get("name", "Unknown")
        role = agent.get("role", "N/A")
        status = agent.get("status", "N/A")
        adapter = agent.get("adapterType", "N/A")
        embed.add_field(
            name=f"{name} ({role})"[:256],
            value=f"Status: {status} | Adapter: {adapter}"[:1024],
            inline=False,
        )

    await interaction.followup.send(embed=embed)


@bot.tree.command(name="status", description="Show agent statuses")
async def status_command(interaction: discord.Interaction) -> None:
    """Show current status of all agents."""

    await interaction.response.defer(thinking=True)
    session = _get_session()

    try:
        agents = await list_agents(session)
    except aiohttp.ClientError:
        logger.exception("Failed to fetch agent statuses")
        await interaction.followup.send("Failed to fetch agent statuses.")
        return

    if not agents:
        await interaction.followup.send("No agents found.")
        return

    status_lines: List[str] = []
    for agent in agents:
        name = agent.get("name", "Unknown")
        status = agent.get("status", "N/A")
        emoji = {
            "idle": "\U0001F7E2",      # green circle
            "busy": "\U0001F7E1",      # yellow circle
            "in_progress": "\U0001F7E1",
            "paused": "\U0001F534",    # red circle
            "terminated": "\U000026AB",
        }.get(status, "\U000026AA")    # white circle
        status_lines.append(f"{emoji} **{name}**: {status}")

    embed = discord.Embed(
        title="Agent Statuses",
        description="\n".join(status_lines)[:4096],
        colour=discord.Color.dark_gold(),
    )

    await interaction.followup.send(embed=embed)


@bot.tree.command(name="costs", description="Show cost summary")
async def costs_command(interaction: discord.Interaction) -> None:
    """Show cost summary for the company and per-agent breakdown."""

    await interaction.response.defer(thinking=True)
    session = _get_session()

    try:
        summary, by_agent = await asyncio.gather(
            get_cost_summary(session),
            get_cost_by_agent(session),
        )
    except aiohttp.ClientError:
        logger.exception("Failed to fetch cost data")
        await interaction.followup.send("Failed to fetch cost data from Paperclip.")
        return

    total_cents = summary.get("totalCostCents", 0)
    total_events = summary.get("totalEvents", 0)

    embed = discord.Embed(
        title="Cost Summary",
        colour=discord.Color.purple(),
    )

    embed.add_field(
        name="Total Cost",
        value=f"${total_cents / 100:.2f}",
        inline=True,
    )
    embed.add_field(
        name="Total Events",
        value=str(total_events),
        inline=True,
    )

    if by_agent:
        agent_lines: List[str] = []
        for entry in by_agent[:20]:
            agent_name = entry.get("agentName", "Unknown")
            agent_cents = entry.get("totalCostCents", 0)
            agent_events = entry.get("totalEvents", 0)
            agent_lines.append(
                f"**{agent_name}**: ${agent_cents / 100:.2f} ({agent_events} events)"
            )
        embed.add_field(
            name="Per-Agent Breakdown",
            value="\n".join(agent_lines)[:1024],
            inline=False,
        )

    await interaction.followup.send(embed=embed)


# ---------------------------------------------------------------------------
# Startup / shutdown hooks
# ---------------------------------------------------------------------------

@bot.event
async def setup_hook() -> None:
    """Initialize resources before the bot connects."""
    await _ensure_session()
    logger.info("Setup hook complete -- aiohttp session ready")


@bot.event
async def on_close() -> None:
    """Clean up resources when the bot shuts down."""
    if _bot_session is not None and not _bot_session.closed:
        await _bot_session.close()
        logger.info("Closed aiohttp session")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Start the Discord bot."""
    if not DISCORD_TOKEN:
        logger.error("DISCORD_TOKEN is not set. Cannot start bot.")
        sys.exit(1)

    logger.info(
        "Starting Paperclip Discord Bot -- URL=%s Company=%s Channels=%d",
        PAPERCLIP_URL,
        PAPERCLIP_COMPANY_ID[:8] + "...",
        len(CHANNEL_AGENT_MAP),
    )
    bot.run(DISCORD_TOKEN, log_handler=None)


if __name__ == "__main__":
    main()
