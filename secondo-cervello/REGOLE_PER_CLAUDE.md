# Regole da aggiungere al CLAUDE.md del vault

Copia il blocco qui sotto in fondo al `CLAUDE.md` del vault (o al file di regole che Claude legge all'avvio).
Numera la regola come preferisci, in modo coerente con le regole G già esistenti.

```markdown
## Strumenti del vault (cervello.py) - dal 21/11/2026

Strumento: `.cervello/cervello.py` (solo libreria standard, nessuna rete). Se manca o non funziona, dillo a Luigi.

1. Scritture protette. Prima di modificare una nota esistente leggine l'impronta
   (`python .cervello/cervello.py impronta "<nota>"`), poi scrivi SOLO con
   `python .cervello/cervello.py scrivi "<nota>" --da <file> --impronta <impronta letta> --motivo "<perché>"`.
   Per una nota nuova usa `--impronta nuovo`. Se il comando risponde FERMO (uscita 3) la nota è cambiata:
   rileggila, rifai la modifica sul testo nuovo, non forzare mai.
2. Inizio sessione. Esegui `python .cervello/cervello.py recupera`: se trova scritture interrotte, riferiscilo a Luigi.
3. Ricerca. Prima di rispondere su contenuti del vault usa
   `python .cervello/cervello.py cerca "<parole>" --json` e cita file e riga dei risultati. Se non trova nulla,
   dillo: non riempire i vuoti a memoria.
4. Salute. Una volta a settimana, o quando Luigi lo chiede, esegui
   `python .cervello/cervello.py salute . --rapporto .cervello/salute.md` e riassumi i numeri, confrontandoli
   con l'ultimo rapporto. Correggi i link rotti solo con scritture protette e dopo averli mostrati a Luigi.
5. Peso. Non mettere nel vault ambienti Python, programmi, modelli o archivi: vanno su E:.
```
