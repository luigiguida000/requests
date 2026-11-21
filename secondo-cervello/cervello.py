#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cervello.py - strumenti per il secondo cervello (vault Obsidian).

In parole semplici:
  salute    controlla il vault: link rotti, note orfane o vuote, nomi doppi,
            file pesanti che gonfiano i backup. Non modifica nulla.
  cerca     cerca nelle note e risponde con le citazioni (file e riga).
            Non modifica nulla.
  impronta  calcola l'impronta (SHA-256) di un file.
  scrivi    sostituisce una nota in modo protetto: controlla l'impronta,
            fa una copia nel giornale, scrive in un colpo solo.
            Se la nota e' cambiata nel frattempo, si ferma.
  storia    elenca le ultime scritture protette.
  annulla   rimette una nota com'era prima di una scrittura protetta.
  recupera  sistema le scritture interrotte (corrente saltata, crash).
  autotest  prova tutte le funzioni su un vault di prova e dice se va tutto bene.

Solo libreria standard di Python (3.9 o piu' recente).
Funziona su Windows nativo, Linux e macOS.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
import unicodedata
import uuid
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote

VERSIONE = "1.1.0"

# Cartelle che non contengono note dell'utente.
CARTELLE_SISTEMA = {".obsidian", ".trash", ".git", ".cervello", ".stfolder", ".sync"}
# Cartelle che in un vault non dovrebbero esserci (gonfiano i backup).
CARTELLE_INTRUSE = {
    "node_modules", ".venv", "venv", "site-packages", "__pycache__",
    ".mypy_cache", ".pytest_cache", ".tox", "dist-info", ".cache",
}
# Estensioni tipiche di programmi, modelli o archivi: sospette in un vault.
EST_SOSPETTE = {
    ".pyc", ".pyd", ".dll", ".exe", ".msi", ".so", ".dylib", ".lib",
    ".safetensors", ".gguf", ".ckpt", ".pt", ".pth", ".onnx", ".bin",
    ".zip", ".7z", ".rar", ".tar", ".gz", ".iso",
}
NOMI_INDICE = {"index", "indice", "home", "readme", "leggimi", "moc", "start", "inizio"}
SCHEMI_ESTERNI = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.\-]*:")

RE_RECINTO = re.compile(r"^\s*(```|~~~)")
RE_CODICE_INLINE = re.compile(r"`[^`\n]*`")
RE_COMMENTO = re.compile(r"%%.*?%%", re.S)
RE_WIKILINK = re.compile(r"(!?)\[\[([^\[\]\n]+?)\]\]")
RE_MDLINK = re.compile(r"(!?)\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
RE_INTESTAZIONE = re.compile(r"^(#{1,6})\s+(.*)$")


# --------------------------------------------------------------------------- utilita'

def _uscita_utf8() -> None:
    """Su Windows la console puo' non essere UTF-8: evita errori con accenti."""
    for flusso in (sys.stdout, sys.stderr):
        try:
            flusso.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def norm(testo: str) -> str:
    """Forma confrontabile di un nome: NFC, barre unix, minuscole."""
    return unicodedata.normalize("NFC", testo).replace("\\", "/").strip().casefold()


def leggi_testo(percorso: Path) -> str:
    with open(percorso, "rb") as f:
        dati = f.read()
    return dati.decode("utf-8-sig", errors="replace")


def impronta_file(percorso: Path) -> str:
    h = hashlib.sha256()
    with open(percorso, "rb") as f:
        for blocco in iter(lambda: f.read(1024 * 1024), b""):
            h.update(blocco)
    return h.hexdigest()


def impronta_bytes(dati: bytes) -> str:
    return hashlib.sha256(dati).hexdigest()


def vault_predefinito() -> Path | None:
    """Vault della cartella corrente; se non c'e', quello in cui sta lo script (.cervello/cervello.py)."""
    return trova_vault(Path.cwd()) or trova_vault(Path(__file__).resolve().parent.parent)


def trova_vault(partenza: Path) -> Path | None:
    """Risale le cartelle finche' trova .obsidian (o .cervello)."""
    p = partenza.resolve()
    if p.is_file():
        p = p.parent
    for c in [p, *p.parents]:
        if (c / ".obsidian").is_dir() or (c / ".cervello").is_dir():
            return c
    return None


def mb(n: int) -> str:
    """Dimensione leggibile: B, KB, MB o GB."""
    for unita, soglia in (("GB", 1024 ** 3), ("MB", 1024 ** 2), ("KB", 1024)):
        if n >= soglia:
            return f"{n / soglia:.1f} {unita}"
    return f"{n} B"


def separa_frontmatter(testo: str):
    """Restituisce (frontmatter|None, corpo, riga_inizio_corpo, errore|None)."""
    if not testo.startswith("---"):
        return None, testo, 1, None
    righe = testo.split("\n")
    if righe[0].strip() != "---":
        return None, testo, 1, None
    for i in range(1, len(righe)):
        if righe[i].strip() in ("---", "..."):
            return "\n".join(righe[1:i]), "\n".join(righe[i + 1:]), i + 2, None
    return None, testo, 1, "frontmatter aperto con --- ma mai chiuso"


def leggi_alias(frontmatter: str | None) -> list[str]:
    if not frontmatter:
        return []
    alias: list[str] = []
    righe = frontmatter.split("\n")
    i = 0
    while i < len(righe):
        m = re.match(r"^(aliases|alias)\s*:\s*(.*)$", righe[i].strip(), re.I)
        if m:
            valore = m.group(2).strip()
            if valore.startswith("[") and valore.endswith("]"):
                alias += [v.strip().strip("'\"") for v in valore[1:-1].split(",") if v.strip()]
            elif valore:
                alias.append(valore.strip("'\""))
            else:
                j = i + 1
                while j < len(righe) and re.match(r"^\s*-\s+", righe[j]):
                    alias.append(re.sub(r"^\s*-\s+", "", righe[j]).strip().strip("'\""))
                    j += 1
                i = j - 1
        i += 1
    return [a for a in alias if a]


def testo_senza_codice(testo: str) -> list[tuple[int, str]]:
    """Righe (numero, testo) senza blocchi di codice, codice inline e commenti %%."""
    testo = RE_COMMENTO.sub(lambda m: "\n" * m.group(0).count("\n"), testo)
    fuori = []
    in_recinto = False
    for n, riga in enumerate(testo.split("\n"), 1):
        if RE_RECINTO.match(riga):
            in_recinto = not in_recinto
            continue
        if in_recinto:
            continue
        fuori.append((n, RE_CODICE_INLINE.sub("", riga)))
    return fuori


# --------------------------------------------------------------------------- vault

class Vault:
    def __init__(self, radice: Path):
        self.radice = radice.resolve()
        self.note: list[Path] = []          # file .md dell'utente
        self.allegati: list[Path] = []      # altri file dell'utente
        self.tutti: list[tuple[Path, int]] = []  # (file, byte) di TUTTO, sistema compreso
        self.intrusi: dict[str, int] = {}   # cartella intrusa -> byte
        self._scansiona()
        self._indicizza()

    def rel(self, p: Path) -> str:
        return p.relative_to(self.radice).as_posix()

    def _scansiona(self) -> None:
        for cartella, sottocartelle, file in os.walk(self.radice):
            cart = Path(cartella)
            parti = cart.relative_to(self.radice).parts
            # Obsidian ignora cartelle e file che iniziano con il punto.
            di_sistema = any(p in CARTELLE_SISTEMA or p.startswith(".") for p in parti)
            intrusa = next((p for p in parti if p in CARTELLE_INTRUSE or p.endswith(".dist-info")), None)
            for nome in file:
                p = cart / nome
                try:
                    dim = p.stat().st_size
                except OSError:
                    continue
                self.tutti.append((p, dim))
                if intrusa:
                    chiave = "/".join(parti[: parti.index(intrusa) + 1])
                    self.intrusi[chiave] = self.intrusi.get(chiave, 0) + dim
                if di_sistema or intrusa or nome.startswith("."):
                    continue
                if nome.lower().endswith(".md"):
                    self.note.append(p)
                else:
                    self.allegati.append(p)
        self.note.sort()
        self.allegati.sort()

    def _indicizza(self) -> None:
        self.per_nome: dict[str, list[Path]] = defaultdict(list)      # nome nota senza .md
        self.per_percorso: dict[str, Path] = {}                       # percorso senza .md
        self.allegati_per_nome: dict[str, list[Path]] = defaultdict(list)
        self.allegati_per_percorso: dict[str, Path] = {}
        self.per_alias: dict[str, list[Path]] = defaultdict(list)
        self.frontmatter: dict[Path, str | None] = {}
        self.testi: dict[Path, str] = {}
        for p in self.note:
            self.per_nome[norm(p.stem)].append(p)
            self.per_percorso[norm(self.rel(p)[:-3])] = p
            testo = leggi_testo(p)
            self.testi[p] = testo
            fm, _, _, _ = separa_frontmatter(testo)
            self.frontmatter[p] = fm
            for a in leggi_alias(fm):
                self.per_alias[norm(a)].append(p)
        for p in self.allegati:
            self.allegati_per_nome[norm(p.name)].append(p)
            self.allegati_per_percorso[norm(self.rel(p))] = p

    def risolvi(self, obiettivo: str, da: Path) -> list[Path]:
        """Trova a cosa punta un link [[...]] come fa Obsidian (nome, percorso, alias)."""
        t = norm(obiettivo)
        if not t:
            return []
        if t.startswith("./") or t.startswith("../"):
            try:
                assoluto = (da.parent / unquote(obiettivo)).resolve()
                t = norm(self.rel(assoluto))
            except ValueError:
                return []
        t = t.lstrip("/")
        senza_md = t[:-3] if t.endswith(".md") else t
        if "/" in t:
            if senza_md in self.per_percorso:
                return [self.per_percorso[senza_md]]
            if t in self.allegati_per_percorso:
                return [self.allegati_per_percorso[t]]
            coda_nota = [p for k, p in self.per_percorso.items() if k.endswith("/" + senza_md)]
            if coda_nota:
                return coda_nota
            return [p for k, p in self.allegati_per_percorso.items() if k.endswith("/" + t)]
        if senza_md in self.per_nome:
            return self.per_nome[senza_md]
        if t in self.allegati_per_nome:
            return self.allegati_per_nome[t]
        if senza_md in self.per_alias:
            return self.per_alias[senza_md]
        return []

    def risolvi_md(self, destinazione: str, da: Path) -> Path | None:
        """Link Markdown [testo](percorso): relativo alla nota o alla radice del vault."""
        d = unquote(destinazione).split("#")[0].split("?")[0]
        if not d:
            return None
        basi = (da.parent, self.radice)
        if d.startswith("/"):  # in Obsidian la barra iniziale indica la radice del vault
            d, basi = d.lstrip("/"), (self.radice,)
        for base in basi:
            try:
                c = (base / d).resolve()
            except (OSError, ValueError):
                continue
            if c.exists():
                return c
            if not d.lower().endswith(".md"):
                c2 = (base / (d + ".md")).resolve()
                if c2.exists():
                    return c2
        return None

    def link(self, p: Path):
        """Genera (riga, tipo, obiettivo, incorporato) per ogni link della nota."""
        for n, riga in testo_senza_codice(self.testi[p]):
            for m in RE_WIKILINK.finditer(riga):
                grezzo = re.split(r"\\?\|", m.group(2), maxsplit=1)[0]  # anche [[Nota\|alias]] in tabella
                obiettivo = re.split(r"[#^]", grezzo, maxsplit=1)[0].strip()
                if obiettivo:
                    yield n, "wiki", obiettivo, bool(m.group(1))
            for m in RE_MDLINK.finditer(riga):
                dest = m.group(2).strip()
                if dest.startswith("#") or SCHEMI_ESTERNI.match(dest):
                    continue
                yield n, "md", dest, bool(m.group(1))


# --------------------------------------------------------------------------- salute

def leggi_canvas(percorso: Path) -> list[str]:
    """File richiamati da una Canvas di Obsidian (nodi di tipo file)."""
    try:
        dati = json.loads(leggi_testo(percorso))
    except ValueError:
        return []
    nodi = dati.get("nodes", []) if isinstance(dati, dict) else []
    return [n["file"] for n in nodi if isinstance(n, dict) and isinstance(n.get("file"), str)]


def analizza_salute(v: Vault) -> dict:
    rotti, ambigui = [], []
    entranti: Counter = Counter()
    uscenti: Counter = Counter()
    allegati_usati: set[Path] = set()
    for p in v.note:
        for riga, tipo, obiettivo, incorporato in v.link(p):
            if tipo == "wiki":
                trovati = v.risolvi(obiettivo, p)
            else:
                r = v.risolvi_md(obiettivo, p)
                trovati = [r] if r else []
            if not trovati:
                rotti.append({"nota": v.rel(p), "riga": riga, "link": obiettivo,
                              "tipo": "incorporato" if incorporato else tipo})
                continue
            if tipo == "wiki" and len(trovati) > 1 and len({norm(x.stem) for x in trovati}) == 1:
                ambigui.append({"nota": v.rel(p), "riga": riga, "link": obiettivo,
                                "candidati": sorted(v.rel(x) for x in trovati)})
            for t in trovati:
                if t == p:
                    continue
                if t.suffix.lower() == ".md":
                    entranti[t] += 1
                    uscenti[p] += 1
                else:
                    allegati_usati.add(t)
    for c in v.allegati:
        if c.suffix.lower() != ".canvas":
            continue
        allegati_usati.add(c)
        for rif in leggi_canvas(c):
            for t in v.risolvi(rif, c):
                if t.suffix.lower() == ".md":
                    entranti[t] += 1
                else:
                    allegati_usati.add(t)

    vuote, fm_rotti = [], []
    for p in v.note:
        fm, corpo, _, errore = separa_frontmatter(v.testi[p])
        if errore:
            fm_rotti.append({"nota": v.rel(p), "problema": errore})
        if not corpo.strip():
            vuote.append(v.rel(p))

    def e_indice(p: Path) -> bool:
        return norm(p.stem) in NOMI_INDICE

    orfane = sorted(v.rel(p) for p in v.note if entranti[p] == 0 and not e_indice(p))
    isolate = sorted(v.rel(p) for p in v.note
                     if entranti[p] == 0 and uscenti[p] == 0 and not e_indice(p))
    nomi_doppi = {k: sorted(v.rel(x) for x in lista)
                  for k, lista in v.per_nome.items() if len(lista) > 1}
    allegati_mai_usati = sorted(v.rel(p) for p in v.allegati
                                if p not in allegati_usati and p.suffix.lower() not in {".canvas", ".base"})

    totale = sum(d for _, d in v.tutti)
    per_cartella: Counter = Counter()
    per_estensione: Counter = Counter()
    sospetti = []
    for p, d in v.tutti:
        parti = p.relative_to(v.radice).parts
        per_cartella[parti[0] if len(parti) > 1 else "(radice)"] += d
        est = p.suffix.lower() or "(nessuna)"
        per_estensione[est] += d
        if est in EST_SOSPETTE:
            sospetti.append((p, d))
    pesanti = sorted(v.tutti, key=lambda x: -x[1])[:15]
    peso_sospetti = sum(d for _, d in sospetti)
    peso_intrusi = sum(v.intrusi.values())

    return {
        "vault": str(v.radice),
        "versione": VERSIONE,
        "conteggi": {
            "note": len(v.note), "allegati": len(v.allegati), "file_totali": len(v.tutti),
            "link_rotti": len(rotti), "link_ambigui": len(ambigui), "note_orfane": len(orfane),
            "note_isolate": len(isolate), "note_vuote": len(vuote),
            "frontmatter_rotti": len(fm_rotti), "nomi_doppi": len(nomi_doppi),
            "allegati_mai_usati": len(allegati_mai_usati),
        },
        "peso": {
            "totale_byte": totale,
            "per_cartella": per_cartella.most_common(10),
            "per_estensione": per_estensione.most_common(10),
            "piu_pesanti": [(v.rel(p), d) for p, d in pesanti],
            "cartelle_intruse": sorted(v.intrusi.items(), key=lambda x: -x[1]),
            "file_sospetti_byte": peso_sospetti,
            "file_sospetti": [(v.rel(p), d) for p, d in sorted(sospetti, key=lambda x: -x[1])[:15]],
            "recuperabili_byte": peso_intrusi + sum(d for p, d in sospetti
                                                    if not any(k in v.rel(p) for k in v.intrusi)),
        },
        "link_rotti": rotti, "link_ambigui": ambigui, "note_orfane": orfane,
        "note_isolate": isolate, "note_vuote": vuote, "frontmatter_rotti": fm_rotti,
        "nomi_doppi": nomi_doppi, "allegati_mai_usati": allegati_mai_usati,
    }


def rapporto_markdown(r: dict, massimo: int) -> str:
    c, peso = r["conteggi"], r["peso"]
    o = []
    o.append(f"# Salute del vault ({time.strftime('%d/%m/%Y %H:%M')})\n")
    o.append(f"Vault: `{r['vault']}` | strumento cervello.py {r['versione']} | solo lettura, nulla e' stato modificato.\n")
    o.append("## In breve\n")
    o.append("| Controllo | Quanti | Cosa vuol dire |\n|---|---:|---|")
    righe = [
        ("Note", c["note"], "file .md tuoi"),
        ("Allegati", c["allegati"], "immagini, PDF e altri file"),
        ("Link rotti", c["link_rotti"], "puntano a note o file che non esistono"),
        ("Link ambigui", c["link_ambigui"], "piu' note con lo stesso nome: Obsidian ne sceglie una"),
        ("Note orfane", c["note_orfane"], "nessuna nota le collega"),
        ("Note isolate", c["note_isolate"], "orfane e senza link in uscita: scollegate dal grafo"),
        ("Note vuote", c["note_vuote"], "nessun testo oltre alle proprieta'"),
        ("Proprieta' rotte", c["frontmatter_rotti"], "blocco --- aperto e mai chiuso"),
        ("Nomi doppi", c["nomi_doppi"], "stesso nome di nota in cartelle diverse"),
        ("Allegati mai usati", c["allegati_mai_usati"], "nessuna nota li richiama"),
    ]
    for nome, n, spiega in righe:
        o.append(f"| {nome} | {n} | {spiega} |")
    o.append("")
    o.append("## Peso del vault (perche' il backup e' grande)\n")
    o.append(f"Totale: **{mb(peso['totale_byte'])}**. "
             f"Recuperabili togliendo programmi, ambienti e archivi: **{mb(peso['recuperabili_byte'])}**.\n")
    if peso["cartelle_intruse"]:
        o.append("**Cartelle che non dovrebbero stare in un vault** (ambienti Python, cache, node_modules):\n")
        for k, d in peso["cartelle_intruse"][:massimo]:
            o.append(f"- `{k}` - {mb(d)}")
        o.append("")
    o.append("| Cartella | Peso |\n|---|---:|")
    for k, d in peso["per_cartella"]:
        o.append(f"| {k} | {mb(d)} |")
    o.append("\n| Tipo di file | Peso |\n|---|---:|")
    for k, d in peso["per_estensione"]:
        o.append(f"| {k} | {mb(d)} |")
    o.append("\n**I 15 file piu' pesanti:**\n")
    for k, d in peso["piu_pesanti"]:
        o.append(f"- `{k}` - {mb(d)}")
    o.append("")

    def elenco(titolo: str, voci: list, fmt) -> None:
        if not voci:
            return
        o.append(f"## {titolo} ({len(voci)})\n")
        for x in voci[:massimo]:
            o.append("- " + fmt(x))
        if len(voci) > massimo:
            o.append(f"- ... e altri {len(voci) - massimo} (usa --tutto per vederli)")
        o.append("")

    elenco("Link rotti", r["link_rotti"],
           lambda x: f"`{x['nota']}` riga {x['riga']}: [[{x['link']}]] ({x['tipo']})")
    elenco("Link ambigui", r["link_ambigui"],
           lambda x: f"`{x['nota']}` riga {x['riga']}: [[{x['link']}]] -> " + ", ".join(x["candidati"]))
    elenco("Proprieta' rotte", r["frontmatter_rotti"], lambda x: f"`{x['nota']}`: {x['problema']}")
    elenco("Note vuote", r["note_vuote"], lambda x: f"`{x}`")
    elenco("Note isolate", r["note_isolate"], lambda x: f"`{x}`")
    elenco("Nomi doppi", sorted(r["nomi_doppi"].items()),
           lambda x: f"{x[0]}: " + ", ".join(f"`{y}`" for y in x[1]))
    elenco("Allegati mai usati", r["allegati_mai_usati"], lambda x: f"`{x}`")
    o.append("## Cosa fare\n")
    o.append("1. Correggi prima i **link rotti**: sono informazioni che credi collegate e non lo sono.")
    o.append("2. Per le **note isolate** decidi: collegarle a una nota indice, unirle o archiviarle.")
    o.append("3. Sposta fuori dal vault programmi, ambienti Python e archivi: il backup dimagrisce subito.")
    o.append("4. Ripeti il controllo una volta a settimana e confronta i numeri.")
    return "\n".join(o) + "\n"


def cmd_salute(a) -> int:
    radice = _vault_da(a)
    if not radice.is_dir():
        print(f"ERRORE: la cartella {radice} non esiste.", file=sys.stderr)
        return 2
    inizio = time.time()
    r = analizza_salute(Vault(radice))
    r["secondi"] = round(time.time() - inizio, 2)
    if a.json:
        testo = json.dumps(r, ensure_ascii=False, indent=2)
    else:
        testo = rapporto_markdown(r, 10 ** 9 if a.tutto else a.massimo)
    if a.rapporto:
        Path(a.rapporto).write_text(testo, encoding="utf-8")
        c = r["conteggi"]
        print(f"Rapporto salvato in {a.rapporto} ({r['secondi']} s): {c['note']} note, "
              f"{c['link_rotti']} link rotti, {c['note_isolate']} note isolate, "
              f"peso {mb(r['peso']['totale_byte'])}.")
    else:
        print(testo)
    if a.severo and r["conteggi"]["link_rotti"]:
        return 1
    return 0


# --------------------------------------------------------------------------- cerca (BM25)

PAROLE_VUOTE = set("""
a ad al allo ai agli all agl alla alle con col coi da dal dallo dai dagli dall dagl dalla dalle di del dello
dei degli dell degl della delle in nel nello nei negli nell negl nella nelle su sul sullo sui sugli sull sugl
sulla sulle per tra fra il lo la i gli le un uno una e ed o od ma se che chi cui non piu come dove quando
anche sono sei era essere ho hai ha abbiamo hanno questo questa questi queste quello quella quelli quelle
mi ti si ci vi ne me te lui lei noi voi loro mio mia tuo tua suo sua cosa cio gia qui li la
the of and or to in is are was be for on at by with from as it this that an not
""".split())


def tokenizza(testo: str) -> list[str]:
    t = unicodedata.normalize("NFKD", testo.casefold())
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    fuori = []
    for parola in re.findall(r"\w+", t):
        if len(parola) < 2 or parola in PAROLE_VUOTE or parola.isdigit() and len(parola) < 3:
            continue
        if len(parola) > 4 and parola[-1] in "aeiou" and not parola.isdigit():
            parola = parola[:-1]  # castello/castelli -> castell
        fuori.append(parola)
    return fuori


def pezzi_nota(v: Vault, p: Path, max_parole: int = 220):
    """Divide la nota in sezioni (per intestazione) di lunghezza limitata."""
    fm, corpo, inizio_corpo, _ = separa_frontmatter(v.testi[p])
    sezione, righe, riga_inizio, in_recinto = "", [], inizio_corpo, False
    for i, riga in enumerate(corpo.split("\n")):
        n = inizio_corpo + i
        if RE_RECINTO.match(riga):
            in_recinto = not in_recinto
        m = None if in_recinto else RE_INTESTAZIONE.match(riga)
        parole = sum(len(x.split()) for x in righe)
        if (m or parole >= max_parole) and any(x.strip() for x in righe):
            yield riga_inizio, sezione, "\n".join(righe)
            righe, riga_inizio = [], n
        if m:
            sezione = m.group(2).strip()
        righe.append(riga)
    if any(x.strip() for x in righe):
        yield riga_inizio, sezione, "\n".join(righe)


def costruisci_indice(v: Vault):
    pezzi, frequenze, lunghezze = [], [], []
    df: Counter = Counter()
    for p in v.note:
        titolo = tokenizza(p.stem + " " + " ".join(leggi_alias(v.frontmatter[p])))
        for riga, sezione, testo in pezzi_nota(v, p):
            tok = tokenizza(testo) + titolo * 2 + tokenizza(sezione)
            if not tok:
                continue
            f = Counter(tok)
            pezzi.append((p, riga, sezione, testo))
            frequenze.append(f)
            lunghezze.append(len(tok))
            df.update(f.keys())
    return pezzi, frequenze, lunghezze, df


def cerca(v: Vault, domanda: str, quanti: int = 8, k1: float = 1.5, b: float = 0.75):
    pezzi, frequenze, lunghezze, df = costruisci_indice(v)
    termini = list(dict.fromkeys(tokenizza(domanda)))
    if not pezzi or not termini:
        return []
    N = len(pezzi)
    media = sum(lunghezze) / N
    punteggi = []
    for i, f in enumerate(frequenze):
        s = 0.0
        for t in termini:
            tf = f.get(t)
            if not tf:
                continue
            idf = math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * lunghezze[i] / media))
        if s > 0:
            coperti = sum(1 for t in termini if t in f)
            punteggi.append((s * (1 + 0.5 * (coperti - 1)), i))
    punteggi.sort(key=lambda x: -x[0])
    risultati, viste = [], Counter()
    for s, i in punteggi:
        p, riga, sezione, testo = pezzi[i]
        if viste[p] >= 2:  # al massimo 2 pezzi per nota: piu' varieta'
            continue
        viste[p] += 1
        risultati.append({"nota": v.rel(p), "riga": riga + _riga_migliore(testo, termini),
                          "sezione": sezione, "punteggio": round(s, 3),
                          "estratto": _estratto(testo, termini)})
        if len(risultati) >= quanti:
            break
    return risultati


def _riga_migliore(testo: str, termini: list[str]) -> int:
    """Riga del pezzo che contiene piu' parole cercate (a parita', la prima)."""
    migliore, punti_max = 0, 0
    for i, riga in enumerate(testo.split("\n")):
        punti = len(set(tokenizza(riga)) & set(termini))
        if punti > punti_max:
            migliore, punti_max = i, punti
    return migliore


def _estratto(testo: str, termini: list[str], larghezza: int = 220) -> str:
    piatto = re.sub(r"\s+", " ", testo).strip()
    base = unicodedata.normalize("NFKD", piatto.casefold())
    base = "".join(ch for ch in base if not unicodedata.combining(ch))
    pos = min((base.find(t) for t in termini if base.find(t) >= 0), default=0)
    inizio = max(0, pos - larghezza // 3)
    pezzo = piatto[inizio:inizio + larghezza]
    return ("..." if inizio else "") + pezzo + ("..." if inizio + larghezza < len(piatto) else "")


def cmd_cerca(a) -> int:
    v = Vault(_vault_da(a))
    risultati = cerca(v, a.domanda, a.quanti)
    if a.json:
        print(json.dumps(risultati, ensure_ascii=False, indent=2))
        return 0
    if not risultati:
        print("Nessuna nota trovata. Prova con altre parole.")
        return 0
    print(f"Risultati per: {a.domanda}\n")
    for n, r in enumerate(risultati, 1):
        dove = f"{r['nota']}:{r['riga']}" + (f"  > {r['sezione']}" if r["sezione"] else "")
        print(f"{n}. {dove}\n   {r['estratto']}\n")
    return 0


# --------------------------------------------------------------------------- scritture protette

class Giornale:
    def __init__(self, vault: Path):
        self.vault = vault.resolve()
        self.cartella = self.vault / ".cervello" / "giornale"
        self.cartella.mkdir(parents=True, exist_ok=True)
        self.lucchetto = self.vault / ".cervello" / "lucchetto"

    def __enter__(self):
        scadenza = time.time() + 30
        while True:
            try:
                fd = os.open(self.lucchetto, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, f"{os.getpid()} {time.time()}".encode())
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    vecchio = time.time() - self.lucchetto.stat().st_mtime > 600
                except FileNotFoundError:
                    continue
                if vecchio:  # lucchetto abbandonato da un processo morto
                    self.lucchetto.unlink(missing_ok=True)
                    continue
                if time.time() > scadenza:
                    raise RuntimeError("un'altra scrittura protetta e' in corso: riprova tra poco")
                time.sleep(0.2)

    def __exit__(self, *exc):
        self.lucchetto.unlink(missing_ok=True)

    def operazioni(self) -> list[tuple[Path, dict]]:
        fuori = []
        for d in sorted(self.cartella.iterdir()):
            m = d / "operazione.json"
            if m.is_file():
                try:
                    fuori.append((d, json.loads(m.read_text(encoding="utf-8"))))
                except (OSError, ValueError):
                    continue
        return fuori

    @staticmethod
    def salva(cartella: Path, dati: dict) -> None:
        tmp = cartella / "operazione.json.tmp"
        tmp.write_text(json.dumps(dati, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, cartella / "operazione.json")

    def pulisci(self, giorni: int = 60) -> None:
        limite = time.time() - giorni * 86400
        for d, op in self.operazioni():
            if op.get("stato") != "in_corso" and op.get("quando_ts", time.time()) < limite:
                shutil.rmtree(d, ignore_errors=True)


def _sostituisci(destinazione: Path, dati: bytes) -> None:
    """Scrive in un file temporaneo accanto e poi sostituisce in un colpo solo."""
    destinazione.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".~cervello-", suffix=".tmp", dir=destinazione.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(dati)
            f.flush()
            os.fsync(f.fileno())
        for tentativo in range(20):  # su Windows Obsidian o OneDrive possono tenere il file aperto
            try:
                os.replace(tmp, destinazione)
                return
            except PermissionError:
                if tentativo == 19:
                    raise
                time.sleep(0.25)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def scrittura_protetta(vault: Path, destinazione: Path, nuovo: bytes, attesa: str,
                       motivo: str = "", _simula_crash: bool = False) -> dict:
    """attesa = impronta (anche solo le prime 12 cifre) oppure 'nuovo' per un file che non esiste."""
    vault = vault.resolve()
    destinazione = destinazione.resolve()
    try:
        rel = destinazione.relative_to(vault).as_posix()
    except ValueError:
        raise RuntimeError(f"{destinazione} non e' dentro il vault {vault}")
    attesa = attesa.strip().lower()
    if attesa != "nuovo" and len(attesa) < 12:
        raise RuntimeError("l'impronta deve avere almeno 12 caratteri (usa il comando impronta)")
    with Giornale(vault) as g:
        esiste = destinazione.exists()
        attuale = impronta_file(destinazione) if esiste else None
        if attesa == "nuovo" and esiste:
            raise ConflittoError(f"{rel} esiste gia': serviva un file nuovo. Niente e' stato scritto.")
        if attesa != "nuovo":
            if not esiste:
                raise ConflittoError(f"{rel} non esiste piu'. Niente e' stato scritto.")
            if not attuale.startswith(attesa):
                raise ConflittoError(
                    f"{rel} e' cambiata dopo che l'hai letta (impronta attesa {attesa[:12]}, "
                    f"attuale {attuale[:12]}). Rileggila: niente e' stato scritto.")
        dopo = impronta_bytes(nuovo)
        if attuale == dopo:
            return {"stato": "invariata", "file": rel, "impronta": dopo}
        ident = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        cart = g.cartella / ident
        cart.mkdir()
        if esiste:
            shutil.copy2(destinazione, cart / "prima")
        op = {"id": ident, "file": rel, "stato": "in_corso", "motivo": motivo,
              "quando": time.strftime("%Y-%m-%d %H:%M:%S"), "quando_ts": time.time(),
              "impronta_prima": attuale, "impronta_dopo": dopo, "esisteva": esiste}
        Giornale.salva(cart, op)
        if _simula_crash:  # usato solo da autotest: scrittura a meta' e poi "corrente saltata"
            destinazione.write_bytes(nuovo[: max(1, len(nuovo) // 2)])
            raise SimulaCrash()
        try:
            _sostituisci(destinazione, nuovo)
            if impronta_file(destinazione) != dopo:
                raise RuntimeError("verifica dopo la scrittura fallita")
        except Exception:
            try:
                _ripristina(destinazione, cart, op)
                op["stato"] = "annullata"
                Giornale.salva(cart, op)
            except Exception:
                pass  # resta "in_corso": il comando recupera rimettera' la nota com'era
            raise
        op["stato"] = "completata"
        Giornale.salva(cart, op)
        g.pulisci()
        return op


class ConflittoError(RuntimeError):
    pass


class SimulaCrash(RuntimeError):
    pass


def _ripristina(destinazione: Path, cart: Path, op: dict) -> None:
    if op.get("esisteva"):
        _sostituisci(destinazione, (cart / "prima").read_bytes())
    elif destinazione.exists():
        destinazione.unlink()


def recupera(vault: Path) -> list[dict]:
    esiti = []
    with Giornale(vault) as g:
        for cart, op in g.operazioni():
            if op.get("stato") != "in_corso":
                continue
            dest = (g.vault / op["file"])
            attuale = impronta_file(dest) if dest.exists() else None
            if attuale == op["impronta_dopo"]:
                op["stato"] = "completata"
                esito = "era gia' completa"
            elif attuale == op["impronta_prima"]:
                op["stato"] = "annullata"
                esito = "non era partita: nota intatta"
            else:
                if attuale is not None and not op.get("esisteva"):
                    dest.replace(dest.with_name(dest.name + ".recuperato"))
                else:
                    _ripristina(dest, cart, op)
                op["stato"] = "ripristinata"
                esito = "interrotta a meta': rimessa com'era prima"
            Giornale.salva(cart, op)
            esiti.append({"id": op["id"], "file": op["file"], "esito": esito})
        for tmp in g.vault.rglob(".~cervello-*.tmp"):
            tmp.unlink(missing_ok=True)
    return esiti


def annulla(vault: Path, ident: str) -> dict:
    with Giornale(vault) as g:
        scelte = [(c, o) for c, o in g.operazioni() if o["id"].startswith(ident)]
        if len(scelte) != 1:
            raise RuntimeError(f"operazione {ident} non trovata o ambigua")
        cart, op = scelte[0]
        if op["stato"] != "completata":
            raise RuntimeError(f"si possono annullare solo operazioni completate (stato: {op['stato']})")
        dest = g.vault / op["file"]
        attuale = impronta_file(dest) if dest.exists() else None
        if attuale != op["impronta_dopo"]:
            raise ConflittoError(f"{op['file']} e' stata modificata dopo: non la sovrascrivo.")
        _ripristina(dest, cart, op)
        op["stato"] = "annullata_dopo"
        Giornale.salva(cart, op)
        return op


def _vault_da(a, file: Path | None = None) -> Path:
    if getattr(a, "vault", None):
        return Path(a.vault).resolve()
    v = (trova_vault(file) if file else None) or vault_predefinito()
    if not v:
        raise RuntimeError("non trovo il vault (manca .obsidian): indica --vault PERCORSO")
    return v


def cmd_impronta(a) -> int:
    for f in a.file:
        p = Path(f)
        if not p.is_file():
            print(f"{f}: non esiste", file=sys.stderr)
            return 2
        h = impronta_file(p)
        print(f"{h}  {f}" if a.completa else f"{h[:16]}  {f}")
    return 0


def cmd_scrivi(a) -> int:
    dest = Path(a.file)
    if a.da != "-" and not Path(a.da).is_file():
        print(f"ERRORE: il file con il nuovo contenuto ({a.da}) non esiste. Niente e' stato scritto.", file=sys.stderr)
        return 2
    dati = sys.stdin.buffer.read() if a.da == "-" else Path(a.da).read_bytes()
    try:
        op = scrittura_protetta(_vault_da(a, dest), dest, dati, a.impronta, a.motivo or "")
    except ConflittoError as e:
        print(f"FERMO: {e}", file=sys.stderr)
        return 3
    except RuntimeError as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 2
    if op["stato"] == "invariata":
        print(f"Nessuna modifica: {op['file']} ha gia' questo contenuto.")
    else:
        print(f"Scritta {op['file']} (operazione {op['id']}). "
              f"Nuova impronta {op['impronta_dopo'][:16]}. Per annullare: annulla {op['id']}")
    return 0


def cmd_storia(a) -> int:
    g = Giornale(_vault_da(a))
    ops = g.operazioni()[-a.quante:]
    if not ops:
        print("Nessuna scrittura protetta registrata.")
    for _, op in ops:
        print(f"{op['id']}  {op['stato']:<15} {op['file']}  {op.get('motivo', '')}")
    return 0


def cmd_annulla(a) -> int:
    try:
        op = annulla(_vault_da(a), a.id)
    except (RuntimeError, ConflittoError) as e:
        print(f"FERMO: {e}", file=sys.stderr)
        return 3
    print(f"Annullata: {op['file']} e' tornata com'era prima dell'operazione {op['id']}.")
    return 0


def cmd_recupera(a) -> int:
    esiti = recupera(_vault_da(a))
    if not esiti:
        print("Tutto in ordine: nessuna scrittura interrotta.")
    for e in esiti:
        print(f"{e['id']}  {e['file']}: {e['esito']}")
    return 0


# --------------------------------------------------------------------------- autotest

def autotest(verboso: bool = True) -> bool:
    esiti: list[tuple[str, bool, str]] = []

    def prova(nome: str, condizione: bool, dettaglio: str = "") -> None:
        esiti.append((nome, bool(condizione), dettaglio))

    with tempfile.TemporaryDirectory(prefix="cervello-autotest-") as tmp:
        V = Path(tmp) / "Vault prova"
        (V / ".obsidian").mkdir(parents=True)
        (V / "Progetti" / "Castello").mkdir(parents=True)
        (V / "Archivio").mkdir()
        (V / "Allegati").mkdir()
        (V / "Strumenti" / ".venv" / "Lib" / "site-packages").mkdir(parents=True)
        scrivi = lambda rel, t: (V / rel).write_text(t, encoding="utf-8")
        scrivi("Home.md", "# Home\n[[Castello di Verrès]] e [[Luhmann]] e [[Progetti/Castello/Fonti|fonti]]\n")
        scrivi("Progetti/Castello/Castello di Verrès.md",
               "---\naliases: [Verres, Castello Verres]\ntags: castello\n---\n# Castello di Verrès\n"
               "Il castello è un cubo di 30 metri con caditoie in cima.\n## Cucina\n"
               "La cucina padronale al primo piano ha tre camini.\n![[pianta.png|300]]\n"
               "[[Nota che non esiste]]\n[[Fonti#Gradara]]\n"
               "```\n[[link dentro il codice non conta]]\n```\n"
               "`[[nemmeno questo]]` e %%[[commento nascosto]]%%\n"
               "[documento](../../Allegati/relazione%20finale.pdf)\n[sito](https://example.com)\n")
        scrivi("Progetti/Castello/Fonti.md", "# Fonti\n## Gradara\nFonti istituzionali sul castello.\n[[Verres]]\n")
        scrivi("Luhmann.md", "---\naliases:\n  - Niklas Luhmann\n---\nSchedario (Zettelkasten) e sistemi sociali.\n[[Home]]\n")
        scrivi("Archivio/Luhmann.md", "Copia vecchia con lo stesso nome.\n")
        scrivi("Archivio/Isolata.md", "Nessun link qui.\n")
        scrivi("Archivio/Vuota.md", "---\ntags: vuota\n---\n\n")
        scrivi("Archivio/Rotta.md", "---\ntitolo: proprietà mai chiuse\nTesto.\n")
        (V / "Allegati" / "pianta.png").write_bytes(b"\x89PNG" + b"0" * 100)
        (V / "Allegati" / "relazione finale.pdf").write_bytes(b"%PDF-1.4")
        (V / "Allegati" / "inutile.jpg").write_bytes(b"x" * 10)
        (V / "Strumenti" / ".venv" / "Lib" / "site-packages" / "torch.dll").write_bytes(b"0" * 300_000)
        (V / "Archivio" / "modello.gguf").write_bytes(b"0" * 200_000)

        # ---- salute
        v = Vault(V)
        r = analizza_salute(v)
        c = r["conteggi"]
        prova("conta le note (le .md dentro .venv escluse)", c["note"] == 8, str(c["note"]))
        rotti = {x["link"] for x in r["link_rotti"]}
        prova("trova il link rotto", "Nota che non esiste" in rotti, str(rotti))
        prova("ignora link nel codice e nei commenti",
              not rotti & {"link dentro il codice non conta", "nemmeno questo", "commento nascosto"}, str(rotti))
        prova("risolve alias, intestazioni, percorsi, accenti, allegati e link Markdown",
              len(rotti) == 1, str(rotti))
        prova("segnala il nome ambiguo Luhmann", c["link_ambigui"] == 1, str(r["link_ambigui"]))
        prova("note isolate", set(r["note_isolate"]) >= {"Archivio/Isolata.md"}
              and "Home.md" not in r["note_orfane"], str(r["note_isolate"]))
        prova("nota vuota", r["note_vuote"] == ["Archivio/Vuota.md"], str(r["note_vuote"]))
        prova("proprieta' mai chiuse", [x["nota"] for x in r["frontmatter_rotti"]] == ["Archivio/Rotta.md"])
        prova("allegato mai usato", r["allegati_mai_usati"] == ["Allegati/inutile.jpg"]
              or "Allegati/inutile.jpg" in r["allegati_mai_usati"], str(r["allegati_mai_usati"]))
        prova("trova la cartella intrusa .venv",
              any(".venv" in k for k, _ in r["peso"]["cartelle_intruse"]), str(r["peso"]["cartelle_intruse"]))
        prova("stima lo spazio recuperabile", r["peso"]["recuperabili_byte"] >= 500_000,
              str(r["peso"]["recuperabili_byte"]))
        rapporto = rapporto_markdown(r, 50)
        prova("rapporto leggibile", "## In breve" in rapporto and "Link rotti" in rapporto)

        # ---- cerca
        ris = cerca(v, "quanti camini ha la cucina del castello?")
        prova("cerca trova la sezione giusta", bool(ris) and ris[0]["sezione"] == "Cucina", json.dumps(ris[:1], ensure_ascii=False))
        prova("cerca cita file e riga esatti", bool(ris) and ris[0]["nota"].endswith("Castello di Verrès.md")
              and "camini" in (V / ris[0]["nota"]).read_text(encoding="utf-8").split("\n")[ris[0]["riga"] - 1],
              str(ris[:1]))
        ris2 = cerca(v, "verres")
        prova("cerca ignora gli accenti (verres = Verrès)", bool(ris2))
        ris3 = cerca(v, "Zettelkasten")
        prova("cerca trova Luhmann", bool(ris3) and ris3[0]["nota"] == "Luhmann.md", str(ris3[:1]))
        prova("cerca non inventa risultati", cerca(v, "astronave marziana") == [])
        prova("cerca non modifica nulla", analizza_salute(Vault(V))["conteggi"] == c)

        # ---- scritture protette
        nota = V / "Luhmann.md"
        h0 = impronta_file(nota)
        nuovo = nota.read_bytes() + "Aggiunta riga.\n".encode()
        op = scrittura_protetta(V, nota, nuovo, h0[:12], "prova")
        prova("scrive con l'impronta giusta", op["stato"] == "completata" and nota.read_bytes() == nuovo)
        try:
            scrittura_protetta(V, nota, b"sovrascrivo", h0[:12])
            prova("si ferma se la nota e' cambiata", False)
        except ConflittoError:
            prova("si ferma se la nota e' cambiata", nota.read_bytes() == nuovo)
        try:
            scrittura_protetta(V, nota, b"x", "nuovo")
            prova("non sovrascrive un file creduto nuovo", False)
        except ConflittoError:
            prova("non sovrascrive un file creduto nuovo", True)
        op_n = scrittura_protetta(V, V / "Archivio" / "Nuova.md", "Ciao àèì\n".encode(), "nuovo")
        prova("crea un file nuovo con accenti", op_n["stato"] == "completata"
              and (V / "Archivio" / "Nuova.md").read_text(encoding="utf-8") == "Ciao àèì\n")
        annulla(V, op["id"])
        prova("annulla rimette la nota com'era", impronta_file(nota) == h0)
        annulla(V, op_n["id"])
        prova("annulla toglie il file creato", not (V / "Archivio" / "Nuova.md").exists())
        # crash a meta' scrittura
        isolata = V / "Archivio" / "Isolata.md"
        h1 = impronta_file(isolata)
        try:
            scrittura_protetta(V, isolata, b"testo nuovo molto lungo " * 10, h1, _simula_crash=True)
        except SimulaCrash:
            pass
        prova("dopo il crash la nota e' danneggiata (simulazione)", impronta_file(isolata) != h1)
        recuperate = recupera(V)
        prova("recupera rimette la nota intatta dopo il crash",
              impronta_file(isolata) == h1 and len(recuperate) == 1, str(recuperate))
        prova("recupera non trova altro da fare", recupera(V) == [])
        prova("giornale nascosto a Obsidian (.cervello)", (V / ".cervello" / "giornale").is_dir()
              and all(".cervello" not in v.rel(p) for p in Vault(V).note))
        prova("lucchetto rilasciato", not (V / ".cervello" / "lucchetto").exists())

        # ---- casi reali di Obsidian: tabelle, barra iniziale, Canvas, vault trovato da solo
        T = Path(tmp) / "Vault casi"
        (T / ".obsidian").mkdir(parents=True)
        (T / "Cartella").mkdir()
        (T / "Tabella.md").write_text("| Colonna |\n|---|\n| [[Bersaglio\\|alias]] |\n"
                                      "[assoluto](/Cartella/Bersaglio.md)\n", encoding="utf-8")
        (T / "Cartella" / "Bersaglio.md").write_text("Testo\n", encoding="utf-8")
        (T / "Da canvas.md").write_text("Solo nella canvas\n", encoding="utf-8")
        (T / "Mappa.canvas").write_text('{"nodes":[{"id":"1","type":"file","file":"Da canvas.md"}],"edges":[]}',
                                        encoding="utf-8")
        rc = analizza_salute(Vault(T))
        prova("link con \\| dentro una tabella non e' rotto", not rc["link_rotti"], str(rc["link_rotti"]))
        prova("link Markdown con barra iniziale = radice del vault", not rc["link_rotti"])
        prova("le note collegate da una Canvas non sono isolate", "Da canvas.md" not in rc["note_isolate"],
              str(rc["note_isolate"]))
        cwd = os.getcwd()
        try:
            os.chdir(T / "Cartella")
            prova("trova il vault partendo da una sottocartella", vault_predefinito() == T.resolve())
        finally:
            os.chdir(cwd)

    if verboso:
        for nome, ok, dettaglio in esiti:
            print(f"[{'OK' if ok else 'ERRORE'}] {nome}" + ("" if ok or not dettaglio else f"  -> {dettaglio}"))
        falliti = sum(1 for _, ok, _ in esiti if not ok)
        print(f"\n{len(esiti) - falliti}/{len(esiti)} prove superate. "
              + ("Tutto funziona." if not falliti else "Qualcosa non va: copia questo testo a Claude."))
        print(f"Python {sys.version.split()[0]} su {sys.platform}, cervello.py {VERSIONE}")
    return all(ok for _, ok, _ in esiti)


def cmd_autotest(a) -> int:
    return 0 if autotest() else 1


# --------------------------------------------------------------------------- avvio

def main(argv=None) -> int:
    _uscita_utf8()
    ap = argparse.ArgumentParser(prog="cervello.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--versione", action="version", version=f"cervello.py {VERSIONE}")
    sub = ap.add_subparsers(dest="comando", required=True)

    s = sub.add_parser("salute", help="controllo di salute del vault (solo lettura)")
    s.add_argument("vault", nargs="?", help="cartella del vault (predefinito: quello in cui ti trovi)")
    s.add_argument("--rapporto", help="salva il rapporto in questo file invece di stamparlo")
    s.add_argument("--json", action="store_true", help="risultato in JSON (per Claude)")
    s.add_argument("--massimo", type=int, default=30, help="voci per elenco (predefinito 30)")
    s.add_argument("--tutto", action="store_true", help="mostra tutte le voci")
    s.add_argument("--severo", action="store_true", help="esce con errore se ci sono link rotti")
    s.set_defaults(f=cmd_salute)

    s = sub.add_parser("cerca", help="cerca nelle note con citazioni (solo lettura)")
    s.add_argument("domanda")
    s.add_argument("--vault")
    s.add_argument("--quanti", type=int, default=8)
    s.add_argument("--json", action="store_true")
    s.set_defaults(f=cmd_cerca)

    s = sub.add_parser("impronta", help="impronta SHA-256 di uno o piu' file")
    s.add_argument("file", nargs="+")
    s.add_argument("--completa", action="store_true", help="tutte le 64 cifre")
    s.set_defaults(f=cmd_impronta)

    s = sub.add_parser("scrivi", help="sostituisce una nota in modo protetto")
    s.add_argument("file", help="nota da scrivere")
    s.add_argument("--da", required=True, help="file con il nuovo contenuto, oppure - per leggere da stdin")
    s.add_argument("--impronta", required=True, help="impronta letta prima (almeno 12 cifre) oppure 'nuovo'")
    s.add_argument("--motivo", help="perche' (resta nel giornale)")
    s.add_argument("--vault")
    s.set_defaults(f=cmd_scrivi)

    s = sub.add_parser("storia", help="ultime scritture protette")
    s.add_argument("--vault")
    s.add_argument("--quante", type=int, default=20)
    s.set_defaults(f=cmd_storia)

    s = sub.add_parser("annulla", help="annulla una scrittura protetta")
    s.add_argument("id")
    s.add_argument("--vault")
    s.set_defaults(f=cmd_annulla)

    s = sub.add_parser("recupera", help="sistema le scritture interrotte")
    s.add_argument("--vault")
    s.set_defaults(f=cmd_recupera)

    s = sub.add_parser("autotest", help="prova tutte le funzioni su un vault di prova")
    s.set_defaults(f=cmd_autotest)

    a = ap.parse_args(argv)
    try:
        return a.f(a)
    except RuntimeError as e:
        print(f"ERRORE: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
