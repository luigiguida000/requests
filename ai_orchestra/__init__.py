"""AI Orchestra — Crea musica con intelligenza artificiale multi-agente."""
__version__ = "1.0.0"
__author__ = "AI Orchestra"

from .models import Composition, MelodyLine, HarmonyPart, RhythmPart, LyricsPart
from .conductor import conduct

__all__ = [
    "conduct",
    "Composition",
    "MelodyLine",
    "HarmonyPart",
    "RhythmPart",
    "LyricsPart",
]
