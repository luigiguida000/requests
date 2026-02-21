"""Data models for the AI Orchestra application."""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MelodyLine:
    key: str
    mode: str
    tempo: int
    time_signature: str
    notes: str
    description: str


@dataclass
class HarmonyPart:
    chord_progression: str
    voicings: str
    description: str


@dataclass
class RhythmPart:
    pattern: str
    feel: str
    description: str


@dataclass
class LyricsPart:
    verse: str
    chorus: str
    bridge: Optional[str]
    description: str


@dataclass
class Composition:
    title: str
    genre: str
    theme: str
    key: str
    tempo: int
    melody: Optional[MelodyLine] = None
    harmony: Optional[HarmonyPart] = None
    rhythm: Optional[RhythmPart] = None
    lyrics: Optional[LyricsPart] = None
    full_arrangement: str = ""
    conductor_notes: str = ""
    sections: list = field(default_factory=list)
