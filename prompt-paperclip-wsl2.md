# Prompt — Paperclip in WSL2 (Ubuntu su disco D:)

Il prompt è diviso in due parti perché in mezzo serve un riavvio di Windows.
- **PARTE A** → incollala in Claude Code aperto su **Windows** (PowerShell, eseguito come amministratore).
- **PARTE B** → incollala in Claude Code aperto **dentro Ubuntu (WSL2)**, dopo il riavvio.

---

## PARTE A — Windows: preparazione WSL2 su D:

````markdown
# OBIETTIVO
Preparare questo PC Windows per eseguire Paperclip dentro WSL2, con la distribuzione
Ubuntu installata sul disco D: (non su C:). Non installare Paperclip in questa fase.

# REGOLE
- Fermati e chiedimi conferma prima di: abilitare funzionalità di Windows, installare
  software, riavviare. Mai stampare valori di credenziali.
- Se un comando non esiste nella versione di WSL installata, leggi `wsl --help` e usa
  l'alternativa documentata; non inventare flag.

# PASSI
1. AUDIT (solo lettura), riporta in tabella: versione/build Windows, CPU, RAM totale,
   spazio libero su C: e D:, virtualizzazione abilitata nel firmware, stato WSL
   (`wsl --status`, `wsl --version`, `wsl -l -v`).
   Requisito: almeno 30 GB liberi su D:. Se mancano → fermati.
2. Abilita/aggiorna WSL (`wsl --install --no-distribution` oppure `wsl --update`).
   Se richiede riavvio → dimmelo e fermati qui; riprenderò il prompt dopo.
3. Installa Ubuntu LTS su D:\WSL\Ubuntu. Ordine di preferenza:
   a) `wsl --install -d Ubuntu-24.04 --location D:\WSL\Ubuntu` (se `--location` è supportato);
   b) installazione standard + `wsl --manage Ubuntu-24.04 --move D:\WSL\Ubuntu`;
   c) `wsl --export` → `wsl --unregister` → `wsl --import` in D:\WSL\Ubuntu
      (in questo caso imposta poi l'utente predefinito NON root in /etc/wsl.conf).
   Al primo avvio dovrò creare io utente e password Linux: dimmelo e attendi.
4. Crea/aggiorna %UserProfile%\.wslconfig con:
   - memory = 50% della RAM fisica (arrotonda per difetto in GB), processors = metà dei core;
   - networkingMode/localhost forwarding lasciati ai default (deve funzionare
     http://localhost:3100 dal browser Windows).
   Mostrami il file prima di salvarlo.
5. Dentro Ubuntu abilita systemd (/etc/wsl.conf → [boot] systemd=true), poi `wsl --shutdown`.
6. VERIFICA: `wsl -l -v` mostra Ubuntu in VERSION 2; il file ext4.vhdx si trova in
   D:\WSL\Ubuntu; dentro Ubuntu `whoami` ≠ root e `systemctl is-system-running` risponde.

# OUTPUT
Tabella audit, percorso effettivo del disco virtuale, contenuto di .wslconfig, e le
istruzioni esatte per la Parte B:
  1) apri "Ubuntu" dal menu Start;
  2) installa Claude Code in Ubuntu (comando ufficiale corrente) e fai `claude` → login
     con l'abbonamento Pro;
  3) incolla la Parte B.
````

---

## PARTE B — Dentro Ubuntu (WSL2): Paperclip, organigramma, test

````markdown
# OBIETTIVO
Installare Paperclip dentro questa distribuzione WSL2, creare un'azienda con 3 agenti
gerarchici CONFINATI a livello di sistema operativo, e DIMOSTRARE con prove verificabili
che il CEO delega a Ricercatore e Sviluppatore. Nessuna VPS.
Vincolo assoluto: COSTO ZERO (solo abbonamenti già attivi: Claude Pro, ChatGPT/Codex, Gemini).

# FONTI DI VERITÀ
- Repo: https://github.com/paperclipai/paperclip — docs: https://docs.paperclip.ing
- Usa SOLO questo repo/pacchetto npm `paperclipai`.
- Se questo prompt contraddice README/docs, vince la documentazione: segnalamelo.
- Riferimenti noti (verificali, non darli per certi):
  install `npx paperclipai@latest onboard --yes` (Node >= 24.11); UI/API su
  http://localhost:3100; API board senza auth in "local trusted mode";
  gerarchia = campo `reportsTo`; istruzioni = `instructionsFilePath` (file .md);
  adapter `claude_local`, `codex_local` (opzione `search`), `gemini_local`;
  confinamento: `filesystemScope: "workspace"`, `networkScope: "allowlist"|"deny"`,
  `networkAllowlist`, richiedono Bubblewrap e `engine: "cli"` (ACP non supportato).
  Endpoint utili: /api/companies/{id}/agents, /api/companies/{id}/org,
  /api/companies/{id}/issues, /api/agents/{id}/heartbeat/invoke.

# REGOLE OPERATIVE
1. Fermati e chiedimi SOLO per: login OAuth/device-code nel browser, password sudo,
   qualunque azione che possa generare costi.
2. Credenziali: verifica solo PRESENZA/ASSENZA. Mai stampare valori.
3. COSTO ZERO: se ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY o GOOGLE_API_KEY sono
   impostate (env, ~/.bashrc, ~/.profile, file di config dei CLI), FERMATI e dimmelo prima
   di avviare agenti: i CLI potrebbero usarle al posto dell'abbonamento.
   Ogni CLI deve risultare autenticato in modalità abbonamento (verificalo con il suo
   comando di stato). Non impostare budget a 0 senza verificare che non metta in pausa gli agenti.
4. Tu (installatore) NON produci contenuti del test: niente ricerca, niente HTML.
   Il lavoro lo fanno gli agenti Paperclip, altrimenti il test è nullo.
5. Limiti: max 3 tentativi di fix per problema; timeout test end-to-end 45 minuti.
   Superati → fermati con diagnosi.
6. Tutto vive nel filesystem Linux (~/paperclip-company), MAI in /mnt/c o /mnt/d
   (prestazioni e compatibilità con Bubblewrap). Nessun processo come root.

# FASE 1 — AUDIT (solo lettura)
Riporta in tabella: distro e kernel WSL, RAM/CPU visibili, spazio libero su /, systemd
attivo, utente non root; versioni di git, node, npm, pnpm, bwrap; CLI `claude`, `codex`,
`gemini` (versione + stato login abbonamento); variabili API key (solo sì/no);
porta 3100 libera.

# FASE 2 — PREREQUISITI
- Node >= 24.11 tramite nvm (nessun sudo per Node).
- `sudo apt install -y bubblewrap git curl` (chiedimi la password sudo).
- Test Bubblewrap: `bwrap --ro-bind / / --dev /dev --proc /proc true` deve uscire con 0.
  Se fallisce per user namespaces → diagnostica e proponimi la correzione, non aggirarla.
- Installa i CLI mancanti nelle versioni correnti ufficiali (`codex`, `gemini`).
  Login: `codex login` (device code: dammi URL e codice, aspetto io nel browser Windows),
  `gemini` con account Google. Verifica lo stato di login di tutti e tre.

# FASE 3 — INSTALLAZIONE PAPERCLIP
- Root: ~/paperclip-company
  workspace agenti: ~/paperclip-company/workspaces/<agente>
  istruzioni:       ~/paperclip-company/instructions/<agente>.md
- Installa con il metodo raccomandato dal README. Leggi `npx paperclipai --help` e la
  guida di installazione per la gestione del servizio.
- Persistenza: proponimi (NON applicare senza conferma) un servizio systemd --user per
  avviare Paperclip all'apertura di WSL, e come tenere attiva WSL finché Windows è acceso.
- Verifica: `curl -I http://localhost:3100` → 200 da Ubuntu; dimmi di aprire lo stesso
  URL dal browser Windows e attendi conferma. Log senza errori (incluso Postgres embedded).

# FASE 4 — AZIENDA E ORGANIGRAMMA (via API o UI, poi verifica via API)
Azienda: "Galattica S.p.A." (o nome che ti indico).

| Agente | reportsTo | Adapter | Config chiave |
|---|---|---|---|
| Mega Direttore Galattico (CEO) | — | claude_local | engine cli, modello Sonnet (risparmia quota Pro), effort medium |
| Ricercatore | CEO | codex_local | engine cli, `search: true`, reasoning effort high |
| Sviluppatore | CEO | claude_local | engine cli, effort high (fallback: vedi sotto) |

CONFINAMENTO (il muro è il sistema operativo, non le buone maniere del CLI):
- Tutti: `cwd` = proprio workspace, `filesystemScope: "workspace"`, nessun
  `filesystemExtraPaths` salvo necessità documentata.
- Rete: `networkScope: "allowlist"` con il set MINIMO di host richiesti dal provider del
  CLI (autenticazione + API del modello). Determinali empiricamente: parti dal minimo,
  leggi l'errore del proxy di Paperclip, aggiungi un host alla volta, documenta ogni host.
  Il Ricercatore usa la ricerca web lato server di Codex (`search: true`): NON aprirgli
  la navigazione libera se non è dimostrato necessario.
- Dentro il confinamento è accettabile lasciare saltare le richieste di permesso del CLI
  (default dell'adapter), perché il limite è imposto da Bubblewrap. Non attivare mai
  `dangerouslyBypassApprovalsAndSandbox` su Codex senza dirmelo e motivarlo.
- Fallback Gemini: `gemini_local` NON espone filesystemScope nella sua documentazione.
  Usalo per lo Sviluppatore solo se la quota Claude Pro si esaurisce, e solo dopo avermi
  avvisato che quell'agente non sarà confinato.
- TEST CANARY obbligatorio per ogni agente confinato:
  a) leggere ~/.ssh o un file fuori dal workspace → deve fallire;
  b) `curl https://example.com` → deve fallire;
  c) scrivere un file nel proprio workspace → deve riuscire.
  Riporta l'esito di ciascuno.

Istruzioni (file .md collegati via instructionsFilePath o tab Instructions):
- CEO: "Sei l'orchestratore e unico punto di contatto con il Board. Non svolgi lavoro
  operativo (ricerca, codice, HTML) se esiste un sottoposto competente. Scomponi ogni
  richiesta in sotto-task, assegnali come issue figlie ai sottoposti, rispetta le
  dipendenze (lo sviluppo parte solo dopo la ricerca), passa allo Sviluppatore i dati
  del Ricercatore, verifica gli output e consegna al Board il risultato consolidato con
  il percorso dei file prodotti."
- Ricercatore: "Comportati come un ricercatore che conduce ricerche approfondite e
  dettagliate online. Consulta solo fonti affidabili e verificabili e per ogni singola
  informazione riporta sempre fonte (URL) e data. Non inventare mai URL: se non trovi una
  fonte, dichiaralo. Restituisci i dati in formato strutturato (JSON o tabella)."
- Sviluppatore: "Sviluppi esclusivamente applicazioni web, script e dashboard HTML
  pulite, responsive e auto-contenute (un solo file, CSS/JS inline, nessuna dipendenza
  esterna) a partire dai dati strutturati ricevuti dal Mega Direttore Galattico.
  Mantieni ogni fonte cliccabile con la sua data."

Verifica via GET /org e /agents: 3 agenti, reportsTo corretto, file istruzioni non vuoti,
adapter pronti (nessun errore di auth), confinamento attivo nella config salvata.

# FASE 5 — TEST END-TO-END
Data di riferimento = data di sistema (dichiarala; "questa settimana" = lunedì–oggi).
Crea una issue assegnata SOLO al CEO:
"Ho bisogno di sapere le novità a tema AI di questa settimana. Fai quindi una ricerca
online approfondita con fonti e date, e comunicamele attraverso un'apposita dashboard
HTML moderna e ben strutturata."
Avvia l'heartbeat del CEO e monitora run e issue fino al timeout.

DEFINITION OF DONE (tutte vere, verificate via API/file, non a parole):
1. Esistono issue figlie della issue principale assegnate a Ricercatore e Sviluppatore.
2. Le run che le hanno completate appartengono a quegli agenti.
   Se il CEO ha fatto ricerca o HTML da solo → TEST FALLITO: correggi istruzioni e ripeti.
3. La issue di sviluppo è partita dopo il completamento di quella di ricerca.
4. Esiste un file .html autocontenuto, prodotto dallo Sviluppatore, che si apre senza
   errori in console (verificalo con un browser headless se disponibile).
5. Fonti: TU (non gli agenti) controlli 5 URL a campione dalla dashboard → devono
   rispondere 2xx/3xx e avere data coerente con la settimana. URL inesistenti = FALLITO.
6. Nessun addebito API: solo uso abbonamento.
7. Copia la dashboard in /mnt/d/paperclip-output/ così posso aprirla da Windows.

# REPORT FINALE
1. Percorso installazione + comandi avvio/arresto/aggiornamento/disinstallazione
   (sia da Ubuntu sia da PowerShell con `wsl -d <distro> -- ...`).
2. URL dashboard (da aprire nel browser Windows).
3. Tabella agenti: adapter, engine, modello, effort, reportsTo, path istruzioni, stato.
4. Confinamento: host consentiti per agente + esito dei 3 test canary.
5. Esito test con PROVE: ID issue padre/figlie, agente esecutore di ogni run, path HTML
   (Linux e Windows), esito controllo URL.
6. Cosa NON hai potuto verificare e rischi residui (quota abbonamenti, fallback Gemini,
   WSL che si spegne quando chiudi la sessione se non hai attivato la persistenza).
````
