"""Musician agents — each is a specialized Claude AI with a distinct musical role."""
import anthropic
from .models import MelodyLine, HarmonyPart, RhythmPart, LyricsPart
from .tools import get_scale, get_chord_progression, get_rhythm_pattern, get_genre_defaults

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"


def _stream_call(system: str, user: str, label: str) -> str:
    """Make a streaming call and collect the full response text."""
    print(f"\n  ♪  {label} sta componendo...", flush=True)
    result_parts = []
    with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
            result_parts.append(text)
    print()
    return "".join(result_parts)


def compose_melody(genre: str, key: str, mode: str, tempo: int, theme: str) -> MelodyLine:
    """Melody Composer — invents the main melodic line."""
    scale_info = get_scale(key, mode)
    genre_info = get_genre_defaults(genre)

    system = """Sei il Compositore di Melodie dell'Orchestra AI.
Il tuo compito è creare melodie originali, espressive e memorabili.
Devi:
- Descrivere la linea melodica con note (es. C4 D4 E4...) e ritmo (es. ♩ ♪ ♩.)
- Spiegare il carattere emotivo e le scelte melodiche
- Indicare fraseggio, dinamiche e articolazioni suggerite
- Fornire una trascrizione leggibile (notazione anglosassone + durate)
Rispondi in italiano, con passione musicale. Sii creativo e specifico."""

    user = f"""Componi la melodia principale per questo brano:
- Genere: {genre}
- Tonalità: {key} {mode}
- Tempo: {tempo} BPM ({genre_info.get('feel', 'vario')})
- Tema/Mood: {theme}
- Scale disponibili: {scale_info.get('notes', [])}

Crea una melodia di 8-16 battute che catturi perfettamente il mood richiesto.
Includi variazioni, un climax e un finale memorabile."""

    result = _stream_call(system, user, "Compositore di Melodie")
    return MelodyLine(
        key=key,
        mode=mode,
        tempo=tempo,
        time_signature="4/4",
        notes=result,
        description=f"Melodia {genre} in {key} {mode} a {tempo} BPM",
    )


def arrange_harmony(melody_description: str, genre: str, key: str) -> HarmonyPart:
    """Harmony Arranger — builds chords and voicings around the melody."""
    prog_info = get_chord_progression(genre)

    system = """Sei l'Arrangiatore Armonico dell'Orchestra AI.
Il tuo compito è creare armonie ricche e sofisticate che supportino la melodia.
Devi:
- Definire la progressione di accordi battuta per battuta
- Descrivere il voicing di ogni accordo (quale inversione, quale tessitura)
- Indicare le tensioni e risoluzioni armoniche
- Suggerire eventuali modulazioni o sostituzioni tritone (se jazz)
- Specificare gli strumenti armonici consigliati (piano, chitarra, archi, ecc.)
Rispondi in italiano con linguaggio musicale preciso."""

    user = f"""Crea l'armonizzazione per questa melodia:

MELODIA:
{melody_description[:800]}

PARAMETRI:
- Genere: {genre}
- Tonalità: {key}
- Progressioni tipiche del genere: {prog_info.get('progressions', {})}

Costruisci una progressione armonica di 8-16 battute.
Includi accordi di passaggio, tensioni e un'armonia finale soddisfacente."""

    result = _stream_call(system, user, "Arrangiatore Armonico")
    return HarmonyPart(
        chord_progression=result,
        voicings="Vedi descrizione completa",
        description=f"Armonia {genre} in {key}",
    )


def create_rhythm(genre: str, tempo: int, feel: str) -> RhythmPart:
    """Rhythm Creator — designs the rhythmic foundation."""
    rhythm_info = get_rhythm_pattern(genre if genre in [
        "rock", "jazz", "bossa_nova", "blues", "electronic", "folk", "latin", "pop"
    ] else "pop")

    system = """Sei il Creatore di Ritmi dell'Orchestra AI — il motore pulsante del gruppo.
Il tuo compito è progettare la sezione ritmica perfetta.
Devi:
- Descrivere il pattern di batteria/percussioni battuta per battuta
- Definire il groove del basso (linea melodica del basso con ritmo)
- Indicare gli accenti, le sincopi e i fill
- Spiegare il feel ritmico (straight, swing, shuffle, ecc.)
- Suggerire eventuali strumenti a percussione aggiuntivi (congas, shaker, ecc.)
Usa X per colpi forti, x per colpi morbidi, . per silenzio.
Rispondi in italiano con entusiasmo ritmico!"""

    user = f"""Crea la sezione ritmica per:
- Genere: {genre}
- Tempo: {tempo} BPM
- Feel: {feel}
- Pattern di riferimento: {rhythm_info.get('pattern', {})}

Progetta 4-8 battute di pattern ritmico di base + variazioni.
Includi un fill di 2 battute per le transizioni.
Descrivi anche la linea del basso."""

    result = _stream_call(system, user, "Creatore di Ritmi")
    return RhythmPart(
        pattern=result,
        feel=feel,
        description=f"Ritmo {genre} a {tempo} BPM",
    )


def write_lyrics(theme: str, genre: str, key: str, melody_description: str) -> LyricsPart:
    """Lyrics Writer — crafts words that fit the melody and theme."""
    system = """Sei il Paroliere dell'Orchestra AI — il custode delle parole e delle emozioni.
Il tuo compito è scrivere testi originali, poetici e perfettamente intonati alla melodia.
Devi:
- Scrivere una strofa (verse) di 8 versi
- Scrivere un ritornello (chorus) di 4-6 versi memorabile
- Scrivere un bridge (bridge) di 4 versi che offra una nuova prospettiva
- Rispettare la metrica e la prosodia della melodia indicata
- Usare immagini vivide, metafore e un linguaggio emotivamente potente
Puoi scrivere in italiano O inglese, scegli in base al genere e al tema.
Sii poetico, autentico e toccante."""

    user = f"""Scrivi i testi per questo brano:
- Tema/Mood: {theme}
- Genere: {genre}
- Tonalità: {key} (influenza il carattere emotivo)
- Melodia di riferimento:
{melody_description[:600]}

Crea testi che raccontino una storia o trasmettano un'emozione forte.
La metrica deve fluire naturalmente sulla melodia."""

    result = _stream_call(system, user, "Paroliere")

    # Split result into sections (rough heuristic)
    lines = result.strip().split("\n\n")
    verse = lines[0] if len(lines) > 0 else result
    chorus = lines[1] if len(lines) > 1 else "-- (vedi testo completo) --"
    bridge = lines[2] if len(lines) > 2 else None

    return LyricsPart(
        verse=verse,
        chorus=chorus,
        bridge=bridge,
        description=f"Testo {genre} sul tema: {theme}",
    )


def arrange_full_song(
    title: str,
    genre: str,
    melody: MelodyLine,
    harmony: HarmonyPart,
    rhythm: RhythmPart,
    lyrics: LyricsPart | None,
    conductor_vision: str,
) -> str:
    """Song Arranger — assembles all parts into a complete arrangement."""
    system = """Sei l'Arrangiatore Finale dell'Orchestra AI.
Il tuo compito è assemblare tutti i contributi dei musicisti in un arrangiamento coerente e brillante.
Devi:
- Strutturare il brano (intro, strofe, ritornello, bridge, outro)
- Indicare quanti strumenti suonano in ogni sezione (crescendo/decrescendo orchestrale)
- Descrivere le transizioni e i momenti chiave
- Suggerire effetti sonori, dinamiche complessive e mix
- Creare una roadmap completa del brano (con battute numerate)
- Indicare il mood di ogni sezione
Scrivi un documento di arrangiamento professionale in italiano."""

    lyrics_section = ""
    if lyrics:
        newline = "\n"
        lyrics_section = (
            "TESTO:\n"
            + lyrics.verse[:300]
            + newline
            + "[RITORNELLO]"
            + newline
            + lyrics.chorus[:200]
        )
    else:
        lyrics_section = "(brano strumentale)"

    user = f"""Assembla l'arrangiamento completo per: "{title}"

VISIONE DEL DIRETTORE:
{conductor_vision}

MELODIA ({melody.key} {melody.mode}, {melody.tempo} BPM):
{melody.notes[:500]}

ARMONIA:
{harmony.chord_progression[:500]}

RITMO ({rhythm.feel}):
{rhythm.pattern[:400]}

{lyrics_section}

Crea la struttura completa del brano con:
1. Mappa delle sezioni (intro / A / B / C / outro)
2. Strumentazione per ogni sezione
3. Dinamiche e intensita (pp -> ff)
4. Punti di climax e momenti di respiro
5. Durata stimata del brano"""

    result = _stream_call(system, user, "Arrangiatore Finale")
    return result
