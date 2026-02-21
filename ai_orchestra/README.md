# 🎼 AI Orchestra

Un'orchestra virtuale multi-agente alimentata da **Claude Opus 4.6** che compone musica originale su richiesta.

## Architettura

```
┌─────────────────────────────────────────────────────────────┐
│                   🎩 DIRETTORE (Claude Opus 4.6)            │
│           Tool use + Adaptive Thinking + Streaming          │
└──────┬──────────┬──────────┬──────────┬────────────────────┘
       │          │          │          │
   ┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌────▼────┐ ┌────────────┐
   │Melodia│ │Armonia│ │Ritmo  │ │ Testi   │ │Arrangiatore│
   │Composer│ │Arranger│ │Creator│ │ Writer  │ │  Finale    │
   └───────┘ └───────┘ └───────┘ └─────────┘ └────────────┘
```

Ogni agente è una chiamata specializzata a Claude con un system prompt dedicato al suo ruolo musicale.

## Installazione

```bash
pip install anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Utilizzo

### Modalità interattiva
```bash
python -m ai_orchestra
```

### Demo rapida
```bash
python -m ai_orchestra --demo
```

### Da riga di comando
```bash
python -m ai_orchestra --genere jazz --titolo "Notte Stellata" --tema "solitudine e speranza"
python -m ai_orchestra --genere blues --bpm 90 --tema "perdita" --strumentale
python -m ai_orchestra --genere bossa_nova --titolo "Ipanema Moderna" --tema "estate brasiliana"
```

### Opzioni CLI

| Opzione | Descrizione |
|---------|-------------|
| `--genere` | Genere musicale (jazz, blues, rock, pop, classical, electronic, folk, bossa_nova, latin) |
| `--titolo` | Titolo del brano |
| `--tema` | Tema/mood della composizione |
| `--tonalita` | Tonalità (C, D, E, F, G, A, B) |
| `--bpm` | Tempo in battiti per minuto |
| `--strumentale` | Brano senza testo |
| `--richiesta` | Descrizione libera della composizione |
| `--demo` | Composizione di esempio |
| `--info` | Informazioni sull'orchestra |

### Uso come libreria Python

```python
from ai_orchestra import conduct

composition = conduct(
    request="Un brano jazz malinconico che evochi la pioggia notturna",
    title="Pioggia di Novembre",
    genre="jazz",
    theme="malinconia e introspezione",
    key="D",
    tempo=85,
    with_lyrics=True,
)

print(composition.melody.notes)
print(composition.harmony.chord_progression)
print(composition.lyrics.chorus)
print(composition.full_arrangement)
```

## Generi supportati

- **jazz** — swing, bebop, cool jazz
- **blues** — 12 battute, shuffle groove
- **rock** — power chords, ritmo driving
- **pop** — melodie orecchiabili, strutture classiche
- **classical** — armonia tonale, forme tradizionali
- **electronic** — 4-on-the-floor, sintetizzatori
- **folk** — acustico, fingerpicking
- **bossa_nova** — clave brasiliana, voicings jazz
- **latin** — clave, congas, ritmo caldo

## Output

Le composizioni vengono salvate automaticamente in `./composizioni/` come file `.txt` con:
- Linea melodica con note e ritmo
- Progressione armonica e voicings
- Pattern ritmico dettagliato
- Testo (strofa, ritornello, bridge)
- Arrangiamento completo con struttura
- Note del Direttore

## Come funziona

1. **Il Direttore** riceve la richiesta e usa i tool per consultare le scale, i pattern ritmici e le progressioni tipiche del genere
2. **Convoca il Compositore di Melodie** con istruzioni precise (tonalità, tempo, mood)
3. **Convoca l'Arrangiatore Armonico** che costruisce accordi attorno alla melodia
4. **Convoca il Creatore di Ritmi** per il groove e la sezione ritmica
5. **Convoca il Paroliere** (se richiesto) per testi poetici
6. **Convoca l'Arrangiatore Finale** che assembla tutto in un brano strutturato
7. Il risultato viene presentato e salvato su file
