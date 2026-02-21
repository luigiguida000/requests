"""The AI Conductor — orchestrates all musician agents via Claude tool use."""
import json
import anthropic
from .models import Composition
from .tools import (
    get_scale,
    get_chord_info,
    get_chord_progression,
    get_rhythm_pattern,
    get_tempo_marking,
    get_genre_defaults,
)
from .musicians import (
    compose_melody,
    arrange_harmony,
    create_rhythm,
    write_lyrics,
    arrange_full_song,
)

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

# --- Tool definitions for the conductor ---

CONDUCTOR_TOOLS = [
    {
        "name": "get_scale",
        "description": "Ottieni le note di una scala musicale dato key e mode. Usalo per informarti sulle note disponibili prima di dare istruzioni ai musicisti.",
        "input_schema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "La tonalità (C, D, E, F, G, A, B)"},
                "mode": {
                    "type": "string",
                    "description": "Il modo: major, minor, dorian, phrygian, pentatonic_major, pentatonic_minor, blues",
                },
            },
            "required": ["key", "mode"],
        },
    },
    {
        "name": "get_chord_progression",
        "description": "Ottieni le progressioni di accordi tipiche per un genere musicale.",
        "input_schema": {
            "type": "object",
            "properties": {
                "genre": {
                    "type": "string",
                    "description": "Il genere: jazz, blues, rock, pop, classical, electronic, folk, bossa_nova, latin",
                },
                "style": {"type": "string", "description": "Lo stile: major o minor"},
            },
            "required": ["genre"],
        },
    },
    {
        "name": "get_rhythm_pattern",
        "description": "Ottieni il pattern ritmico di riferimento per uno stile musicale.",
        "input_schema": {
            "type": "object",
            "properties": {
                "style": {
                    "type": "string",
                    "description": "Lo stile ritmico: rock, jazz, bossa_nova, blues, electronic, folk, latin, pop",
                }
            },
            "required": ["style"],
        },
    },
    {
        "name": "get_genre_defaults",
        "description": "Ottieni i parametri musicali predefiniti per un genere (tonalità, tempo, feel).",
        "input_schema": {
            "type": "object",
            "properties": {
                "genre": {
                    "type": "string",
                    "description": "Il genere musicale",
                }
            },
            "required": ["genre"],
        },
    },
    {
        "name": "get_tempo_marking",
        "description": "Ottieni il segno di tempo italiano (Allegro, Andante, ecc.) per un BPM.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tempo_bpm": {"type": "integer", "description": "Il tempo in BPM"}
            },
            "required": ["tempo_bpm"],
        },
    },
    {
        "name": "call_melody_composer",
        "description": "Convoca il Compositore di Melodie per creare la linea melodica principale del brano.",
        "input_schema": {
            "type": "object",
            "properties": {
                "genre": {"type": "string", "description": "Il genere musicale"},
                "key": {"type": "string", "description": "La tonalità (es. C, G, A)"},
                "mode": {"type": "string", "description": "Il modo (es. major, minor, blues)"},
                "tempo": {"type": "integer", "description": "Il tempo in BPM"},
                "theme": {"type": "string", "description": "Il tema/mood del brano"},
            },
            "required": ["genre", "key", "mode", "tempo", "theme"],
        },
    },
    {
        "name": "call_harmony_arranger",
        "description": "Convoca l'Arrangiatore Armonico per creare accordi e voicings attorno alla melodia.",
        "input_schema": {
            "type": "object",
            "properties": {
                "melody_description": {
                    "type": "string",
                    "description": "La descrizione della melodia già composta",
                },
                "genre": {"type": "string", "description": "Il genere musicale"},
                "key": {"type": "string", "description": "La tonalità"},
            },
            "required": ["melody_description", "genre", "key"],
        },
    },
    {
        "name": "call_rhythm_creator",
        "description": "Convoca il Creatore di Ritmi per progettare la sezione ritmica del brano.",
        "input_schema": {
            "type": "object",
            "properties": {
                "genre": {"type": "string", "description": "Il genere musicale"},
                "tempo": {"type": "integer", "description": "Il tempo in BPM"},
                "feel": {
                    "type": "string",
                    "description": "Il feel ritmico (es. swing, shuffle, straight, syncopated)",
                },
            },
            "required": ["genre", "tempo", "feel"],
        },
    },
    {
        "name": "call_lyrics_writer",
        "description": "Convoca il Paroliere per scrivere i testi del brano (solo se il brano non è strumentale).",
        "input_schema": {
            "type": "object",
            "properties": {
                "theme": {"type": "string", "description": "Il tema e le emozioni da esprimere"},
                "genre": {"type": "string", "description": "Il genere musicale"},
                "key": {"type": "string", "description": "La tonalità (influenza il mood dei testi)"},
                "melody_description": {
                    "type": "string",
                    "description": "Descrizione della melodia per la prosodia",
                },
            },
            "required": ["theme", "genre", "key", "melody_description"],
        },
    },
    {
        "name": "call_song_arranger",
        "description": "Convoca l'Arrangiatore Finale per assemblare tutti i contributi in un arrangiamento completo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Il titolo del brano"},
                "conductor_vision": {
                    "type": "string",
                    "description": "La visione artistica del direttore per guidare l'arrangiamento finale",
                },
            },
            "required": ["title", "conductor_vision"],
        },
    },
]


def _execute_tool(tool_name: str, tool_input: dict, composition: Composition) -> str:
    """Execute a conductor tool and return the result as a string."""
    if tool_name == "get_scale":
        result = get_scale(tool_input["key"], tool_input["mode"])
    elif tool_name == "get_chord_progression":
        result = get_chord_progression(
            tool_input["genre"], tool_input.get("style", "major")
        )
    elif tool_name == "get_rhythm_pattern":
        result = get_rhythm_pattern(tool_input["style"])
    elif tool_name == "get_genre_defaults":
        result = get_genre_defaults(tool_input["genre"])
    elif tool_name == "get_tempo_marking":
        result = get_tempo_marking(tool_input["tempo_bpm"])
    elif tool_name == "call_melody_composer":
        melody = compose_melody(
            tool_input["genre"],
            tool_input["key"],
            tool_input["mode"],
            tool_input["tempo"],
            tool_input["theme"],
        )
        composition.melody = melody
        result = {"status": "melody_composed", "description": melody.notes}
    elif tool_name == "call_harmony_arranger":
        harmony = arrange_harmony(
            tool_input["melody_description"],
            tool_input["genre"],
            tool_input["key"],
        )
        composition.harmony = harmony
        result = {"status": "harmony_arranged", "description": harmony.chord_progression}
    elif tool_name == "call_rhythm_creator":
        rhythm = create_rhythm(
            tool_input["genre"],
            tool_input["tempo"],
            tool_input["feel"],
        )
        composition.rhythm = rhythm
        result = {"status": "rhythm_created", "description": rhythm.pattern}
    elif tool_name == "call_lyrics_writer":
        lyrics = write_lyrics(
            tool_input["theme"],
            tool_input["genre"],
            tool_input["key"],
            tool_input["melody_description"],
        )
        composition.lyrics = lyrics
        result = {
            "status": "lyrics_written",
            "verse": lyrics.verse,
            "chorus": lyrics.chorus,
        }
    elif tool_name == "call_song_arranger":
        arrangement = arrange_full_song(
            tool_input["title"],
            composition.genre,
            composition.melody,
            composition.harmony,
            composition.rhythm,
            composition.lyrics,
            tool_input["conductor_vision"],
        )
        composition.full_arrangement = arrangement
        result = {"status": "arrangement_complete", "arrangement": arrangement[:500]}
    else:
        result = {"error": f"Tool '{tool_name}' non riconosciuto"}

    return json.dumps(result, ensure_ascii=False, indent=2)


CONDUCTOR_SYSTEM = """Sei il Maestro Direttore dell'Orchestra AI — il cuore creativo e decisionale di questo ensemble virtuale.

La tua orchestra è composta da musicisti AI specializzati:
🎵 Compositore di Melodie — inventa le linee melodiche
🎹 Arrangiatore Armonico — costruisce accordi e voicings
🥁 Creatore di Ritmi — progetta il groove e la sezione ritmica
✍️  Paroliere — scrive testi poetici (se richiesto)
🎼 Arrangiatore Finale — assembla tutto in un brano completo

Il tuo ruolo è:
1. ANALIZZARE la richiesta creativa dell'utente
2. INFORMARTI usando gli strumenti musicali (scale, accordi, ritmi)
3. DIRIGERE i musicisti nell'ordine giusto:
   - Prima il Compositore di Melodie
   - Poi l'Arrangiatore Armonico (con la melodia come riferimento)
   - Poi il Creatore di Ritmi
   - Se il brano ha testo → il Paroliere
   - Infine l'Arrangiatore Finale per assemblare tutto
4. COORDINARE la visione artistica coerente tra tutti i musicisti
5. PRESENTARE il risultato finale con eleganza e passione musicale

Sei appassionato, colto, esigente ma rispettoso. Parli sempre in italiano.
Hai una visione artistica chiara e la sai comunicare con chiarezza e calore.
Prima di iniziare la composizione, rifletti sulla richiesta e decidi i parametri chiave (genere, tonalità, tempo, mood)."""


def conduct(
    request: str,
    title: str,
    genre: str,
    theme: str,
    key: str = "auto",
    tempo: int = 0,
    with_lyrics: bool = True,
) -> Composition:
    """
    The main conductor function: orchestrates all musician agents to create a composition.

    Args:
        request: The user's creative request in free text
        title: Title of the composition
        genre: Musical genre
        theme: Theme/mood of the piece
        key: Musical key (or 'auto' to let Claude decide)
        tempo: Tempo in BPM (0 = let Claude decide)
        with_lyrics: Whether to include lyrics

    Returns:
        A Composition object with all parts filled in
    """
    from .tools import get_genre_defaults

    # Set defaults if not specified
    if key == "auto" or not key:
        defaults = get_genre_defaults(genre)
        if "error" not in defaults:
            key = defaults["key"]
            mode = defaults["mode"]
            if tempo == 0:
                tempo = defaults["tempo"]
        else:
            key = "C"
            mode = "major"
            if tempo == 0:
                tempo = 120
    else:
        mode = "major"

    composition = Composition(
        title=title,
        genre=genre,
        theme=theme,
        key=key,
        tempo=tempo,
    )

    print(f"\n{'='*60}")
    print(f"  🎼 IL DIRETTORE PRENDE IL PODIO")
    print(f"  Brano: \"{title}\"")
    print(f"  Genere: {genre.title()} | Tema: {theme}")
    print(f"{'='*60}\n")

    user_message = f"""Richiesta creativa: {request}

Parametri iniziali:
- Titolo: "{title}"
- Genere: {genre}
- Tema/Mood: {theme}
- Tonalità suggerita: {key} {mode}
- Tempo suggerito: {tempo} BPM
- Con testo: {'Sì' if with_lyrics else 'No (strumentale)'}

Inizia la sessione di composizione. Consulta prima gli strumenti musicali per informarti,
poi dirigi i tuoi musicisti nell'ordine corretto per creare un brano completo e coerente.
Al termine, presenta il brano con una nota del direttore."""

    messages = [{"role": "user", "content": user_message}]

    # Agentic loop — conductor calls tools until composition is complete
    max_turns = 20
    turn = 0

    while turn < max_turns:
        turn += 1
        print(f"\n  [Direttore — turno {turn}]", flush=True)

        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=CONDUCTOR_SYSTEM,
            tools=CONDUCTOR_TOOLS,
            messages=messages,
        )

        # Print any text the conductor says
        for block in response.content:
            if hasattr(block, "text"):
                print(f"\n🎩 DIRETTORE: {block.text}", flush=True)

        # If done, break
        if response.stop_reason == "end_turn":
            # Extract final conductor notes from last text block
            for block in reversed(response.content):
                if hasattr(block, "text") and block.text.strip():
                    composition.conductor_notes = block.text
                    break
            break

        # Process tool calls
        if response.stop_reason == "tool_use":
            tool_use_blocks = [b for b in response.content if b.type == "tool_use"]

            messages.append({"role": "assistant", "content": response.content})

            tool_results = []
            for tool_block in tool_use_blocks:
                tool_name = tool_block.name
                tool_input = tool_block.input
                print(f"\n  🔧 Strumento: {tool_name}", flush=True)
                if tool_input:
                    brief = {k: str(v)[:60] for k, v in tool_input.items()}
                    print(f"     Input: {brief}", flush=True)

                result_str = _execute_tool(tool_name, tool_input, composition)

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": result_str,
                    }
                )

            messages.append({"role": "user", "content": tool_results})
        else:
            # Unexpected stop reason
            break

    return composition
