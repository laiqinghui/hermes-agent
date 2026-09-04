"""Decide whether a judged session produced a canvas.

Runs in the gateway after the judging turn has FINISHED, so both signals are
available: what the agent said, and whether a canvas doc actually landed in the
store. Keeping this pure (and out of the client) is what makes the verdict
trustworthy — the SPA cannot observe turn boundaries, only a global event
stream with no session correlation.
"""
from __future__ import annotations

import re

_NO_CANVAS = re.compile(r"^\s*no canvas\s*:", re.IGNORECASE)


def verdict_from(answer: str, doc: dict | None) -> tuple[str, str]:
    """``(verdict, reason)`` where verdict is ``rendered`` or ``declined``.

    Precedence:
      1. An explicit, START-ANCHORED "NO CANVAS:" declines (anchored so a
         transcript that merely quotes the phrase cannot flip the verdict).
      2. A doc in the store means rendered, even with no answer — some models
         author the canvas and say nothing, and throwing that work away would
         be worse than a terse verdict.
      3. No doc means declined, whatever the agent claimed: without a doc the
         client would show an empty canvas.
    """
    text = (answer or "").strip()
    if _NO_CANVAS.match(text):
        return "declined", _NO_CANVAS.sub("", text).strip()
    if doc:
        return "rendered", ""
    if not text:
        return "declined", "the judging turn produced no answer and no canvas"
    return "declined", "the agent authored no canvas for this session"
