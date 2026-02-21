"""Musical reference tools for the AI Orchestra."""

SCALES = {
    "C": {
        "major": ["C", "D", "E", "F", "G", "A", "B"],
        "minor": ["C", "D", "Eb", "F", "G", "Ab", "Bb"],
        "dorian": ["C", "D", "Eb", "F", "G", "A", "Bb"],
        "phrygian": ["C", "Db", "Eb", "F", "G", "Ab", "Bb"],
        "pentatonic_major": ["C", "D", "E", "G", "A"],
        "pentatonic_minor": ["C", "Eb", "F", "G", "Bb"],
        "blues": ["C", "Eb", "F", "Gb", "G", "Bb"],
    },
    "G": {
        "major": ["G", "A", "B", "C", "D", "E", "F#"],
        "minor": ["G", "A", "Bb", "C", "D", "Eb", "F"],
        "dorian": ["G", "A", "Bb", "C", "D", "E", "F"],
        "pentatonic_major": ["G", "A", "B", "D", "E"],
        "pentatonic_minor": ["G", "Bb", "C", "D", "F"],
        "blues": ["G", "Bb", "C", "Db", "D", "F"],
    },
    "D": {
        "major": ["D", "E", "F#", "G", "A", "B", "C#"],
        "minor": ["D", "E", "F", "G", "A", "Bb", "C"],
        "dorian": ["D", "E", "F", "G", "A", "B", "C"],
        "pentatonic_major": ["D", "E", "F#", "A", "B"],
        "pentatonic_minor": ["D", "F", "G", "A", "C"],
        "blues": ["D", "F", "G", "Ab", "A", "C"],
    },
    "A": {
        "major": ["A", "B", "C#", "D", "E", "F#", "G#"],
        "minor": ["A", "B", "C", "D", "E", "F", "G"],
        "dorian": ["A", "B", "C", "D", "E", "F#", "G"],
        "pentatonic_major": ["A", "B", "C#", "E", "F#"],
        "pentatonic_minor": ["A", "C", "D", "E", "G"],
        "blues": ["A", "C", "D", "Eb", "E", "G"],
    },
    "E": {
        "major": ["E", "F#", "G#", "A", "B", "C#", "D#"],
        "minor": ["E", "F#", "G", "A", "B", "C", "D"],
        "dorian": ["E", "F#", "G", "A", "B", "C#", "D"],
        "pentatonic_major": ["E", "F#", "G#", "B", "C#"],
        "pentatonic_minor": ["E", "G", "A", "B", "D"],
        "blues": ["E", "G", "A", "Bb", "B", "D"],
    },
    "F": {
        "major": ["F", "G", "A", "Bb", "C", "D", "E"],
        "minor": ["F", "G", "Ab", "Bb", "C", "Db", "Eb"],
        "pentatonic_major": ["F", "G", "A", "C", "D"],
        "pentatonic_minor": ["F", "Ab", "Bb", "C", "Eb"],
        "blues": ["F", "Ab", "Bb", "B", "C", "Eb"],
    },
}

CHORDS = {
    "major": {"intervals": [0, 4, 7], "symbol": ""},
    "minor": {"intervals": [0, 3, 7], "symbol": "m"},
    "dominant7": {"intervals": [0, 4, 7, 10], "symbol": "7"},
    "major7": {"intervals": [0, 4, 7, 11], "symbol": "maj7"},
    "minor7": {"intervals": [0, 3, 7, 10], "symbol": "m7"},
    "diminished": {"intervals": [0, 3, 6], "symbol": "dim"},
    "augmented": {"intervals": [0, 4, 8], "symbol": "aug"},
    "suspended2": {"intervals": [0, 2, 7], "symbol": "sus2"},
    "suspended4": {"intervals": [0, 5, 7], "symbol": "sus4"},
    "add9": {"intervals": [0, 4, 7, 14], "symbol": "add9"},
}

CHORD_PROGRESSIONS = {
    "pop": {
        "major": ["I", "V", "vi", "IV"],
        "minor": ["i", "VI", "III", "VII"],
        "example_C_major": "C - G - Am - F",
    },
    "jazz": {
        "ii-V-I": ["ii7", "V7", "Imaj7"],
        "rhythm_changes": ["I", "VI7", "ii7", "V7"],
        "blues": ["I7", "IV7", "I7", "V7", "IV7", "I7"],
        "example_C_major": "Dm7 - G7 - Cmaj7",
    },
    "blues": {
        "12_bar": ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
        "example_A": "A7 - D7 - A7 - E7 - D7 - A7",
    },
    "classical": {
        "major": ["I", "IV", "V", "I"],
        "minor": ["i", "iv", "V", "i"],
        "example_C_major": "C - F - G - C",
    },
    "rock": {
        "power": ["I", "bVII", "IV"],
        "minor": ["i", "bVI", "bVII"],
        "example_A_minor": "Am - F - G",
    },
    "folk": {
        "major": ["I", "IV", "I", "V"],
        "example_G_major": "G - C - G - D",
    },
    "electronic": {
        "minor": ["i", "bVI", "bIII", "bVII"],
        "example_A_minor": "Am - F - C - G",
    },
    "bossa_nova": {
        "ii-V-I": ["ii7", "V7", "Imaj7", "bVII7"],
        "example_C_major": "Dm7 - G7 - Cmaj7 - Bb7",
    },
}

RHYTHM_PATTERNS = {
    "rock": {
        "kick": "X . . . X . . . X . . . X . . .",
        "snare": ". . X . . . X . . . X . . . X .",
        "hihat": "X X X X X X X X X X X X X X X X",
        "feel": "driving, straight",
    },
    "jazz": {
        "ride": "X . X X . X X . X . X X . X X .",
        "hihat": ". . X . . . X . . . X . . . X .",
        "kick": "X . . . . . . . X . . . . . . .",
        "feel": "swung, laid-back",
    },
    "bossa_nova": {
        "clave": "X . . X . . X . . . X . X . . .",
        "rim": ". . X . . X . . X . . X . . X .",
        "feel": "syncopated, subtle",
    },
    "blues": {
        "kick": "X . . . X . . X X . . . X . . .",
        "snare": ". . X . . . X . . . X . . . X .",
        "shuffle": "X X X X X X X X X X X X X X X X (shuffle feel)",
        "feel": "shuffle, heavy groove",
    },
    "electronic": {
        "kick": "X . . . X . . . X . . . X . . .",
        "snare": ". . . . X . . . . . . . X . . .",
        "clap": ". . X . . . X . . . X . . . X .",
        "feel": "mechanical, precise, 4-on-the-floor",
    },
    "folk": {
        "strum": "D . DU . UDU D . DU . UDU",
        "feel": "acoustic, organic, finger-picking",
    },
    "latin": {
        "clave": "X . . X . . X . X . . X . . X .",
        "congas": "X . X X . X . X X . X X . X . X",
        "feel": "hot, syncopated, dancefloor",
    },
    "pop": {
        "kick": "X . . . X . . . X . . . X . . .",
        "snare": ". . X . . . X . . . X . . . X .",
        "hihat": "X . X . X . X . X . X . X . X .",
        "feel": "clean, upbeat, polished",
    },
}

TEMPO_RANGES = {
    "grave": (20, 40),
    "largo": (40, 60),
    "adagio": (60, 70),
    "andante": (70, 85),
    "moderato": (85, 100),
    "allegretto": (100, 120),
    "allegro": (120, 156),
    "vivace": (156, 176),
    "presto": (176, 200),
    "prestissimo": (200, 280),
}

GENRE_DEFAULTS = {
    "jazz": {"key": "F", "mode": "major", "tempo": 120, "feel": "swing"},
    "blues": {"key": "A", "mode": "blues", "tempo": 90, "feel": "shuffle"},
    "rock": {"key": "E", "mode": "minor", "tempo": 130, "feel": "straight"},
    "pop": {"key": "C", "mode": "major", "tempo": 110, "feel": "straight"},
    "classical": {"key": "D", "mode": "major", "tempo": 80, "feel": "rubato"},
    "electronic": {"key": "A", "mode": "minor", "tempo": 128, "feel": "mechanical"},
    "folk": {"key": "G", "mode": "major", "tempo": 95, "feel": "organic"},
    "bossa_nova": {"key": "F", "mode": "major", "tempo": 108, "feel": "bossa"},
    "latin": {"key": "D", "mode": "minor", "tempo": 120, "feel": "clave"},
}


def get_scale(key: str, mode: str) -> dict:
    """Return notes in the requested scale."""
    key = key.upper()
    mode = mode.lower().replace(" ", "_")
    if key not in SCALES:
        available = list(SCALES.keys())
        return {"error": f"Key '{key}' not found. Available: {available}"}
    if mode not in SCALES[key]:
        available = list(SCALES[key].keys())
        return {"error": f"Mode '{mode}' not in key {key}. Available: {available}"}
    return {
        "key": key,
        "mode": mode,
        "notes": SCALES[key][mode],
        "note_count": len(SCALES[key][mode]),
    }


def get_chord_info(root: str, chord_type: str) -> dict:
    """Return information about a specific chord."""
    chord_type = chord_type.lower().replace("-", "").replace(" ", "")
    if chord_type not in CHORDS:
        return {"error": f"Chord type '{chord_type}' not found. Available: {list(CHORDS.keys())}"}
    return {
        "root": root,
        "type": chord_type,
        "symbol": f"{root}{CHORDS[chord_type]['symbol']}",
        "intervals": CHORDS[chord_type]["intervals"],
    }


def get_chord_progression(genre: str, style: str = "major") -> dict:
    """Return a chord progression for a genre."""
    genre = genre.lower().replace(" ", "_")
    if genre not in CHORD_PROGRESSIONS:
        return {"error": f"Genre '{genre}' not found. Available: {list(CHORD_PROGRESSIONS.keys())}"}
    prog_data = CHORD_PROGRESSIONS[genre]
    return {
        "genre": genre,
        "progressions": prog_data,
    }


def get_rhythm_pattern(style: str) -> dict:
    """Return a rhythm pattern for a style."""
    style = style.lower().replace(" ", "_")
    if style not in RHYTHM_PATTERNS:
        return {"error": f"Style '{style}' not found. Available: {list(RHYTHM_PATTERNS.keys())}"}
    return {
        "style": style,
        "pattern": RHYTHM_PATTERNS[style],
    }


def get_tempo_marking(tempo_bpm: int) -> dict:
    """Return the Italian tempo marking for a BPM value."""
    for marking, (low, high) in TEMPO_RANGES.items():
        if low <= tempo_bpm <= high:
            return {"bpm": tempo_bpm, "marking": marking}
    return {"bpm": tempo_bpm, "marking": "unknown"}


def get_genre_defaults(genre: str) -> dict:
    """Return default musical parameters for a genre."""
    genre = genre.lower().replace(" ", "_")
    if genre not in GENRE_DEFAULTS:
        return {"error": f"Genre '{genre}' not found. Available: {list(GENRE_DEFAULTS.keys())}"}
    return {"genre": genre, **GENRE_DEFAULTS[genre]}
