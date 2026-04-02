#!/usr/bin/env python3
"""Export Paperclip agents to PyGPT preset JSON files.

Fetches companies and agents from the Paperclip API, then generates
a PyGPT-compatible preset file for each agent in the presets directory.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


BASE_URL = "http://localhost:3100"
PRESETS_DIR = Path("/home/charlie/.config/pygpt-net/presets")

ROLE_LABELS: dict[str, str] = {
    "engineer": "Software Engineer",
    "cto": "Chief Technology Officer",
    "ceo": "Chief Executive Officer",
    "general": "General Agent",
    "researcher": "Researcher",
    "pm": "Product Manager",
}

PRESET_META = {
    "version": "0.9.0",
    "app.version": "0.9.0",
}


def _fetch_json(url: str) -> Any:
    """Fetch JSON from a URL using urllib (no external dependencies)."""
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError) as exc:
        print(f"ERROR: Failed to fetch {url}: {exc}", file=sys.stderr)
        sys.exit(1)


def _name_to_filename(name: str) -> str:
    """Convert an agent name to a lowercase-hyphenated filename stem.

    >>> _name_to_filename("Sonnet Coder")
    'sonnet-coder'
    >>> _name_to_filename("Opus Architect (v2)")
    'opus-architect-v2'
    """
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unnamed-agent"


def _build_system_prompt(
    agent: dict[str, Any],
    company_name: str,
) -> str:
    """Build a system prompt for the PyGPT preset.

    Uses the agent's existing systemPrompt from adapterConfig if available,
    otherwise generates one from name, role, title, and model.
    """
    adapter_config = agent.get("adapterConfig") or {}
    existing_prompt = adapter_config.get("systemPrompt", "")
    if existing_prompt:
        return existing_prompt

    name = agent.get("name", "Unknown Agent")
    role_key = agent.get("role", "general")
    role_label = ROLE_LABELS.get(role_key, role_key.replace("_", " ").title())
    title = agent.get("title") or ""
    model = adapter_config.get("model", "an AI model")

    prompt = f"You are {name}, a {role_label} at {company_name}."
    if title:
        prompt += f" Your title is {title}."
    prompt += f" You use the {model} model."

    return prompt


def _build_temperature(agent: dict[str, Any]) -> float:
    """Extract temperature from adapterConfig, defaulting to 1.0."""
    adapter_config = agent.get("adapterConfig") or {}
    raw = adapter_config.get("temperature")
    if raw is not None:
        try:
            return float(raw)
        except (TypeError, ValueError):
            pass
    return 1.0


def _build_preset(agent: dict[str, Any], company_name: str) -> dict[str, Any]:
    """Build a complete PyGPT preset dictionary for a single agent."""
    name = agent.get("name", "Unknown")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    return {
        "name": name,
        "ai_name": name,
        "user_name": "",
        "prompt": _build_system_prompt(agent, company_name),
        "temperature": _build_temperature(agent),
        "chat": True,
        "completion": False,
        "img": False,
        "__meta__": {
            **PRESET_META,
            "updated_at": now,
        },
    }


def _export_agent(agent: dict[str, Any], company_name: str) -> Path:
    """Export a single agent to a preset JSON file. Returns the file path."""
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)

    filename = _name_to_filename(agent["name"]) + ".json"
    filepath = PRESETS_DIR / filename

    preset = _build_preset(agent, company_name)

    existing: dict[str, Any] | None = None
    if filepath.exists():
        try:
            existing = json.loads(filepath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    if existing is not None:
        existing.update(preset)
        preset = existing

    filepath.write_text(
        json.dumps(preset, indent=4, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return filepath


def main() -> None:
    """Main entry point: fetch data from Paperclip API and export presets."""
    print(f"Fetching companies from {BASE_URL}/api/companies ...")
    companies = _fetch_json(f"{BASE_URL}/api/companies")

    if not isinstance(companies, list):
        print("ERROR: Expected a list of companies from the API.", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(companies)} company(ies).\n")

    total_exported = 0
    skipped: list[str] = []

    for company in companies:
        company_id = company["id"]
        company_name = company.get("name", "Unknown Company")
        print(f"Company: {company_name} ({company_id})")

        agents = _fetch_json(f"{BASE_URL}/api/companies/{company_id}/agents")
        if not isinstance(agents, list):
            print(f"  WARNING: Expected a list of agents, got {type(agents).__name__}")
            continue

        print(f"  Agents: {len(agents)}")

        for agent in agents:
            agent_name = agent.get("name", "Unnamed")
            agent_status = agent.get("status", "unknown")
            filepath = _export_agent(agent, company_name)
            print(f"  -> {filepath.name}  ({agent_name}, status={agent_status})")
            total_exported += 1

        print()

    print("=" * 50)
    print(f"Export complete: {total_exported} preset(s) written to {PRESETS_DIR}")
    if skipped:
        print(f"Skipped: {len(skipped)} agent(s) — {', '.join(skipped)}")


if __name__ == "__main__":
    main()
