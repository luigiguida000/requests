# Strumenti del secondo cervello: come si usano (per Luigi)

In parole semplici: un solo file, `cervello.py`, aggiunge al vault tre cose che non aveva:
un **controllo di salute**, una **ricerca con citazioni** e le **scritture protette**.
Non serve installare niente oltre a Python (che hai già, 3.12). Funziona su Windows normale, senza WSL.

## Installazione (una volta sola, 2 minuti)
1. Scarica `cervello.py` e `installa_e_verifica.ps1` nella stessa cartella (per esempio Download).
2. Apri PowerShell in quella cartella e scrivi:
   `powershell -ExecutionPolicy Bypass -File .\installa_e_verifica.ps1`
3. Quando chiede il percorso del vault, incollalo (la cartella che contiene `.obsidian`).

Lo script copia `cervello.py` in `<vault>\.cervello\` (cartella nascosta: Obsidian non la mostra),
fa 29 prove su un vault finto e poi il primo controllo di salute sul tuo vault, **senza modificare le note**.

## Uso di tutti i giorni (da PowerShell, dentro la cartella del vault)
| Vuoi... | Scrivi |
|---|---|
| Controllare la salute del vault | `python .cervello\cervello.py salute . --rapporto .cervello\salute.md` |
| Cercare nelle tue note | `python .cervello\cervello.py cerca "cisterna del castello"` |
| Sapere se tutto funziona | `python .cervello\cervello.py autotest` |
| Vedere le ultime modifiche protette | `python .cervello\cervello.py storia` |
| Annullare una modifica | `python .cervello\cervello.py annulla <numero operazione>` |
| Sistemare dopo un blackout o un crash | `python .cervello\cervello.py recupera` |

Le scritture protette le usa soprattutto Claude: tu puoi semplicemente dirgli
«controlla la salute del vault» oppure «cerca nel vault ...».

## Cosa controlla la salute
| Controllo | Perché conta |
|---|---|
| Link rotti | credi che due note siano collegate e non lo sono |
| Link ambigui e nomi doppi | due note con lo stesso nome: Obsidian ne apre una a caso |
| Note isolate | nessun collegamento: nel grafo non le ritrovi più |
| Note vuote, proprietà rotte | file iniziati e mai finiti |
| Allegati mai usati | immagini e PDF che nessuna nota richiama |
| **Peso** | cartelle e file che gonfiano il backup (ambienti Python, programmi, archivi, modelli) |

## Cosa fanno le scritture protette
1. Prima di cambiare una nota si legge la sua **impronta** (come quella del registro del Magazzino).
2. Se nel frattempo hai modificato la nota in Obsidian, l'impronta non torna e la scrittura **si ferma**: vince la tua modifica.
3. La versione precedente resta nel **giornale** (`.cervello\giornale`, 60 giorni): ogni modifica si può annullare.
4. Se salta la corrente a metà, `recupera` rimette la nota com'era.

## Regole sempre valide
- `salute` e `cerca` **non modificano mai nulla**.
- Il giornale sta dentro il vault, quindi finisce anche nei backup.
- Mai dati della sezione Lavoro in strumenti online: `cervello.py` lavora solo sul PC, non manda niente in rete.
