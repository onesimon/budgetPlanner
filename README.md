# Budget Planner

Applicazione web per pianificare il budget mensile, utilizzabile da PC e da cellulare. Si può installare come app (PWA) e funziona anche offline.
Non usa build, framework o database: è composta solo da HTML, CSS e JavaScript.

## Funzionalità

- **Conti configurabili**: ING, Intesa, Buoni pasto e Contanti sono predefiniti e se ne possono aggiungere altri. Ogni conto ha un saldo iniziale.
- **Fondi configurabili**: Bollette, Macchina e Risparmi sono predefiniti. Si aggiungono, rinominano ed eliminano direttamente nel Modello (o in Impostazioni). Il saldo iniziale si imposta in Impostazioni. Un fondo già usato in qualche mese non si può eliminare.
  - **Quote ai fondi**: ogni fondo è alimentato da una o più voci, per esempio Bollette = Luce + Gas + Acqua. Nel Modello si inserisce l'importo **annuo** di ogni voce: in ogni nuovo mese viene versato un dodicesimo, sempre modificabile. Ogni voce indica il conto da cui viene prelevata. La quota è un'uscita del conto e aumenta il saldo del fondo.
  - **Scadenze**: nel Modello ogni voce può avere una scadenza ricorrente, ogni N mesi a partire da un mese (es. luce ogni 3 mesi da febbraio, acqua ogni 2 mesi) oppure una volta l'anno (es. bollo auto a settembre). Nei mesi di scadenza compare un avviso, anche prima di creare il mese. L'importo effettivo si registra a mano in "Spese pagate dai fondi".
  - **Spese pagate dai fondi**: per esempio la bolletta della luce. Riducono il saldo del fondo, non quello dei conti.
- **Trasferimenti** (solo nel mese): soldi spostati da un conto a un altro, per esempio da ING a Intesa o un prelievo da ING a Contanti. Il conto di partenza scende, quello di arrivo sale, il totale non cambia.
- **Modello**: entrate ricorrenti, spese fisse e quote ai fondi (annue, divise per 12) vengono copiate in ogni nuovo mese.
- **Mese**: entrate, spese fisse, altre spese, trasferimenti, quote ai fondi e spese pagate dai fondi. Il riepilogo per conto e per fondo si aggiorna mentre scrivi. Le sezioni dei fondi sono a fisarmonica, chiuse finché non le apri.
- **Riepilogo**: saldo complessivo per conto e per fondo, totale di conti e fondi insieme, poi totali per conto, per fondo e per mese, con filtro per anno.
- **Buoni pasto**: si inseriscono come entrata sul conto "Buoni pasto". La spesa pagata con i buoni va registrata come spesa fissa sullo stesso conto.

## Dati e sincronizzazione

- I dati sono salvati nel browser (`localStorage`) del dispositivo.
- **Sincronizzazione tra dispositivi (facoltativa)**: avviene tramite un Gist privato di GitHub, gratuito.
  1. Crea un [token classic](https://github.com/settings/tokens/new?scopes=gist&description=Budget%20Planner) con il **solo** permesso `gist`. I token fine-grained non supportano i Gist.
  2. Apri *Impostazioni → Sincronizzazione online*, incolla il token e premi *Collega*. L'app trova il Gist esistente oppure ne crea uno nuovo.
  3. Ripeti il passaggio su ogni dispositivo.
  - La sincronizzazione è automatica: avviene dopo ogni modifica e quando riapri l'app. Se due dispositivi modificano i dati offline, **prevale la modifica più recente**.
- **Backup**: puoi esportare e importare i dati come file JSON da *Impostazioni → Backup*.

## Pubblicazione su GitHub Pages

1. Esegui il push dei file sul branch `main`.
2. In GitHub apri *Settings → Pages → Build and deployment*, scegli *Deploy from a branch*, poi `main` e `/ (root)`.
3. Apri `https://<utente>.github.io/budgetPlanner/` e, dal cellulare, scegli *Aggiungi a schermata Home*.

A ogni rilascio, incrementa la costante `CACHE` in `sw.js`.

## Sviluppo locale

```powershell
python -m http.server 8000
```

Poi apri http://localhost:8000.

## File

| File | Contenuto |
|---|---|
| `index.html` | Struttura della pagina e barra di navigazione |
| `style.css` | Stile mobile-first con tema chiaro e scuro |
| `app.js` | Dati, calcoli, viste e sincronizzazione Gist |
| `sw.js` | Service worker per il funzionamento offline |
| `manifest.webmanifest`, `icons/` | Installazione come app |
