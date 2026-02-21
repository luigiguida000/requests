"""AI Orchestra — Interactive CLI entry point."""
import os
import sys
import json
import argparse
from datetime import datetime
from pathlib import Path


BANNER = r"""
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║          🎼  A I   O R C H E S T R A   A I  🎼               ║
║                                                               ║
║   Direttore: Claude Opus 4.6                                  ║
║   Musicisti AI: Melodia · Armonia · Ritmo · Testi             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
"""

GENRES = [
    "jazz", "blues", "rock", "pop", "classical",
    "electronic", "folk", "bossa_nova", "latin",
]


def save_composition(composition, output_dir: str = "./composizioni") -> str:
    """Save the composition to a text file."""
    os.makedirs(output_dir, exist_ok=True)
    safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in composition.title)
    filename = f"{output_dir}/{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"

    with open(filename, "w", encoding="utf-8") as f:
        f.write(f"{'='*70}\n")
        f.write(f"  AI ORCHESTRA — COMPOSIZIONE\n")
        f.write(f"{'='*70}\n\n")
        f.write(f"Titolo:  {composition.title}\n")
        f.write(f"Genere:  {composition.genre}\n")
        f.write(f"Tema:    {composition.theme}\n")
        f.write(f"Tonalità: {composition.key}\n")
        f.write(f"Tempo:   {composition.tempo} BPM\n")
        f.write(f"Data:    {datetime.now().strftime('%d/%m/%Y %H:%M')}\n")
        f.write(f"\n{'─'*70}\n")

        if composition.melody:
            f.write(f"\n🎵 MELODIA\n{'─'*40}\n")
            f.write(composition.melody.notes + "\n")

        if composition.harmony:
            f.write(f"\n🎹 ARMONIA\n{'─'*40}\n")
            f.write(composition.harmony.chord_progression + "\n")

        if composition.rhythm:
            f.write(f"\n🥁 RITMO\n{'─'*40}\n")
            f.write(composition.rhythm.pattern + "\n")

        if composition.lyrics:
            f.write(f"\n✍️  TESTO\n{'─'*40}\n")
            f.write("--- STROFA ---\n")
            f.write(composition.lyrics.verse + "\n\n")
            f.write("--- RITORNELLO ---\n")
            f.write(composition.lyrics.chorus + "\n")
            if composition.lyrics.bridge:
                f.write("\n--- BRIDGE ---\n")
                f.write(composition.lyrics.bridge + "\n")

        if composition.full_arrangement:
            f.write(f"\n🎼 ARRANGIAMENTO COMPLETO\n{'─'*40}\n")
            f.write(composition.full_arrangement + "\n")

        if composition.conductor_notes:
            f.write(f"\n🎩 NOTE DEL DIRETTORE\n{'─'*40}\n")
            f.write(composition.conductor_notes + "\n")

        f.write(f"\n{'='*70}\n")
        f.write("Generato con AI Orchestra — Powered by Claude Opus 4.6\n")

    return filename


def prompt_user() -> dict:
    """Interactive prompts to gather composition parameters."""
    print("\n🎼 Nuova composizione\n")

    title = input("  📝 Titolo del brano: ").strip()
    if not title:
        title = f"Composizione AI #{datetime.now().strftime('%H%M')}"

    print(f"\n  🎸 Generi disponibili: {', '.join(GENRES)}")
    genre = input("  Genere musicale: ").strip().lower().replace(" ", "_")
    if genre not in GENRES:
        print(f"  ⚠️  Genere non riconosciuto. Uso 'jazz' come default.")
        genre = "jazz"

    theme = input("\n  🌟 Tema/Mood (es. nostalgia, amore, libertà, tristezza): ").strip()
    if not theme:
        theme = "emozione libera"

    lyrics_input = input("\n  ✍️  Vuoi il testo? (s/n): ").strip().lower()
    with_lyrics = lyrics_input not in ("n", "no", "no grazie")

    key_input = input("\n  🎵 Tonalità (lascia vuoto per auto): ").strip().upper()
    key = key_input if key_input else "auto"

    tempo_input = input("  ⏱️  Tempo BPM (lascia vuoto per auto): ").strip()
    try:
        tempo = int(tempo_input) if tempo_input else 0
    except ValueError:
        tempo = 0

    request = input("\n  💬 Descrivi liberamente la tua visione per il brano:\n  > ").strip()
    if not request:
        request = f"Crea un brano {genre} sul tema '{theme}'"

    return {
        "title": title,
        "genre": genre,
        "theme": theme,
        "with_lyrics": with_lyrics,
        "key": key,
        "tempo": tempo,
        "request": request,
    }


def run_quick_demo():
    """Run a quick demonstration composition."""
    return {
        "title": "Notte di Mezza Estate",
        "genre": "jazz",
        "theme": "nostalgia e speranza sotto le stelle",
        "with_lyrics": True,
        "key": "auto",
        "tempo": 0,
        "request": "Un brano jazz notturno, malinconico ma pieno di speranza, "
                   "che evochi una passeggiata solitaria in una città addormentata. "
                   "Ispirato a Miles Davis e Chet Baker.",
    }


def run_info():
    """Display info about the AI Orchestra."""
    print("""
🎼 AI ORCHESTRA — Come funziona

L'AI Orchestra è composta da agenti AI specializzati, coordinati da un Direttore:

  🎩 DIRETTORE (Claude Opus 4.6 + Tool Use)
     Analizza la richiesta, consulta gli strumenti musicali,
     e orchestra l'intero processo creativo.

  🎵 COMPOSITORE DI MELODIE
     Crea la linea melodica principale con note, ritmo e dinamiche.

  🎹 ARRANGIATORE ARMONICO
     Costruisce accordi, voicings e progressioni armoniche.

  🥁 CREATORE DI RITMI
     Progetta la sezione ritmica (batteria, basso, groove).

  ✍️  PAROLIERE
     Scrive testi poetici in italiano o inglese.

  🎼 ARRANGIATORE FINALE
     Assembla tutto in un arrangiamento completo con struttura e dinamiche.

Generi supportati:
  """ + ", ".join(GENRES) + """

Il risultato viene salvato automaticamente in ./composizioni/

Utilizzo:
  python -m ai_orchestra                  # modalità interattiva
  python -m ai_orchestra --demo           # composizione demo
  python -m ai_orchestra --genere jazz --titolo "My Song" --tema "amore"
""")


def cli_compose(args) -> None:
    """Compose from CLI arguments."""
    from .conductor import conduct

    params = {
        "title": args.titolo or f"Composizione {args.genere.title()}",
        "genre": args.genere or "jazz",
        "theme": args.tema or "emozione libera",
        "with_lyrics": not args.strumentale,
        "key": args.tonalita or "auto",
        "tempo": args.bpm or 0,
        "request": args.richiesta or f"Crea un brano {args.genere} sul tema '{args.tema}'",
    }

    composition = conduct(**params)

    print(f"\n{'='*60}")
    print(f"  ✅ COMPOSIZIONE COMPLETATA!")
    print(f"{'='*60}")

    saved_path = save_composition(composition)
    print(f"\n  💾 Salvato in: {saved_path}\n")


def interactive_loop() -> None:
    """Run the interactive composition loop."""
    from .conductor import conduct

    print(BANNER)
    print("  Benvenuto nell'AI Orchestra! Creiamo musica insieme.")
    print("  Comandi: [n]uova composizione | [i]nfo | [q]uit\n")

    while True:
        cmd = input("\n🎼 > ").strip().lower()

        if cmd in ("q", "quit", "exit", "esci"):
            print("\n  Arrivederci! Che la musica sia sempre con te. 🎵\n")
            break

        elif cmd in ("i", "info", "?", "help", "aiuto"):
            run_info()

        elif cmd in ("d", "demo"):
            params = run_quick_demo()
            print(f"\n  🚀 Avvio demo: \"{params['title']}\"")
            composition = conduct(**params)
            saved_path = save_composition(composition)
            print(f"\n  ✅ Demo completata! Salvato in: {saved_path}")

        elif cmd in ("", "n", "new", "nuova", "compose", "componi"):
            try:
                params = prompt_user()
                print(f"\n  🚀 Il Direttore prende il podio...\n")
                composition = conduct(**params)
                saved_path = save_composition(composition)
                print(f"\n{'='*60}")
                print(f"  ✅ COMPOSIZIONE COMPLETATA!")
                print(f"  💾 Salvato in: {saved_path}")
                print(f"{'='*60}\n")
            except KeyboardInterrupt:
                print("\n\n  Composizione interrotta.")
            except Exception as e:
                print(f"\n  ❌ Errore: {e}")

        else:
            # Treat as a free-form request
            try:
                print(f"\n  Interpretando la richiesta: '{cmd}'")
                genre = "jazz"
                for g in GENRES:
                    if g in cmd.lower():
                        genre = g
                        break
                params = {
                    "title": cmd[:50].title(),
                    "genre": genre,
                    "theme": cmd,
                    "with_lyrics": True,
                    "key": "auto",
                    "tempo": 0,
                    "request": cmd,
                }
                composition = conduct(**params)
                saved_path = save_composition(composition)
                print(f"\n  ✅ Salvato in: {saved_path}")
            except KeyboardInterrupt:
                print("\n\n  Composizione interrotta.")
            except Exception as e:
                print(f"\n  ❌ Errore: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="🎼 AI Orchestra — Componi musica con l'intelligenza artificiale",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Esempi:
  python -m ai_orchestra
  python -m ai_orchestra --demo
  python -m ai_orchestra --genere blues --titolo "Midnight Rain" --tema "perdita e rinascita"
  python -m ai_orchestra --genere jazz --bpm 130 --strumentale
        """,
    )
    parser.add_argument("--demo", action="store_true", help="Esegui una composizione demo")
    parser.add_argument("--info", action="store_true", help="Mostra informazioni sull'orchestra")
    parser.add_argument("--genere", type=str, default="jazz", help=f"Genere: {', '.join(GENRES)}")
    parser.add_argument("--titolo", type=str, help="Titolo del brano")
    parser.add_argument("--tema", type=str, help="Tema/mood del brano")
    parser.add_argument("--tonalita", type=str, help="Tonalità (es. C, G, Am)")
    parser.add_argument("--bpm", type=int, default=0, help="Tempo in BPM")
    parser.add_argument("--strumentale", action="store_true", help="Brano strumentale (senza testo)")
    parser.add_argument("--richiesta", type=str, help="Descrizione libera della composizione")

    args = parser.parse_args()

    # Check API key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("❌ Errore: variabile d'ambiente ANTHROPIC_API_KEY non impostata.")
        print("   Esporta la chiave: export ANTHROPIC_API_KEY='sk-ant-...'")
        sys.exit(1)

    if args.info:
        run_info()
        return

    if args.demo:
        from .conductor import conduct
        print(BANNER)
        params = run_quick_demo()
        print(f"  🚀 Demo: \"{params['title']}\"\n")
        composition = conduct(**params)
        saved_path = save_composition(composition)
        print(f"\n  ✅ Demo completata! Salvato in: {saved_path}\n")
        return

    # If specific args given, compose directly
    if args.titolo or args.tema or args.richiesta:
        cli_compose(args)
        return

    # Default: interactive mode
    interactive_loop()


if __name__ == "__main__":
    main()
