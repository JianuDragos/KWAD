# AERIS — Consola Radar ATC (Frontend)

React 19 + TypeScript + Vite 8, hartă radar Leaflet (`react-leaflet` 5), validare de graniță Zod și stare comună Zustand.

## Ce trebuie instalat

Doar două programe; restul (biblioteci, fonturi IBM Plex, geometrie AIP `LRCV`) se află deja în proiect.

| Program | Versiune | De unde |
|---|---|---|
| Node.js | 22.12+ sau 24 (vezi `.nvmrc`) | https://nodejs.org |
| .NET SDK | 10 (pentru backend) | https://dotnet.microsoft.com/download |

Fonturile (`IBM Plex Sans Condensed` și `IBM Plex Mono`) sunt incluse local în `src/assets/fonts` (licență OFL) pentru ca demo-ul să funcționeze complet offline.

## Pornire

Backendul, din `AERIS API`:

```bash
dotnet run
```

Frontendul, din `frontend` (prima dată `npm ci` instalează bibliotecile exact din `package-lock.json`):

```bash
npm ci
npm run dev
```

Deschide http://localhost:5173 (pagina Live) sau http://localhost:5173/#/demo (simularea interactivă).

Alte comenzi:

```bash
npm run dev:mock   # fără backend: motor matematic + date mock în src/api/mockBackend.ts și src/api/mockLive.ts
npm test           # suita de 49 teste unitare (Vitest)
npm run build      # build de producție în dist/
```

Backendul nu necesită CORS în dev: `/api` trece prin proxy-ul Vite către `http://localhost:5271`. Dacă backendul rulează pe alt port, pornește frontendul cu variabila `AERIS_API`, de exemplu în PowerShell:
```powershell
$env:AERIS_API="http://localhost:5272"; npm run dev
```

## Două moduri de operare

- **`#/live` (implicit):** Avioanele reale din OpenSky (`/api/craiova/live-positions`, actualizare la 15 s), geofencing VFR pe punctele `VFR-S`, `VFR-N`, `VFR-W` (`/api/craiova/vfr/tracking`) și METAR-ul real `LRCV` (`/api/weather/metar/decoded`, cache 5 min).
- **`#/demo` (pentru prezentarea Hackathon):** Simulare matematică 4D completă, cu preseturi meteo (`Calm`, `Vânt de vest`, `Vânt lateral moderat`, `Vânt lateral puternic 180° 22G26 kt`), cronologie interactivă și panouri de calcul fizic.

## Ce afișează Modul Demo (`#/demo`)

1. **Harta Radar (`MapView.tsx`):**
   - CTR Craiova (20 NM), pista `08/26` (relevmente adevărate AIP $88.93^\circ / 268.95^\circ$), tranzițiile RNP reale din AIP România (`TITEK`, `PEMOK`, `PANZU` $\to$ `OZZET` / `NECCO` $\to$ `CV508` / `CV408` $\to$ `THR 26/08`).
   - Traiectorii sintetice sincronizate la secundă cu sloturile din backend și **circuite de așteptare tip hipodrom ICAO (`appendRacetrack`)** pentru aeronavele în holding.
2. **Predicția Viitorului 4D (`DetailsPanel.tsx`):**
   - Afișează altitudinea de densitate ($\text{DA}$), vântul în altitudine la $2000\text{ ft}$ și $5000\text{ ft}$ (legea lui Hellmann + spirala Ekman) și fereastra optimă VFR.
   - Butoane interactive pentru orizonturile `T+0m`, `T+5m`, `T+10m`, `T+15m`, `T+30m`, `T+45m` — click pe orice orizont mută ceasul simulării la acel moment viitor.
3. **Analiza Zborului în Fiecare Bandă (`StripDetails`):**
   - **2 Pași Înaintea Avionului (`T0` $\to$ `Pas +1` $\to$ `Pas +2`):** Click pe fiecare pas mută harta la momentul respectiv și afișează fix-ul, altitudinea, $\text{GS}$, $\text{HDG}$ corectat și acțiunea ATC.
   - **Analiză De-la-Decolare-la-Aterizare:** Afișează aerodromul de origine, distanța $\text{TOD}$, rata de coborâre $\text{ROD}$ pe panta de $3.0^\circ$, unghiul de derivă $\text{WCA}$, bara vizuală $\text{LDR} / 2500\text{ m}$, $\text{ROT}$ și tabelul celor 6 faze cinematice.
   - **Calcul VFR Orbită vs. Redirecționare:** Afișează *Point of No Return* ($\text{PNR}$) și clasamentul pistelor înierbate apropiate (`PODARI`, `LRCW` Craiova-Sud, `SLATINA`) cu scorul matematic $0\text{–}100$, capul compas corectat la vânt, $\text{ETE}$ și $\text{LDR}$.
4. **Interpretare AI 4B (`AskAi.tsx`):**
   - Trimite întrebarea împreună cu starea scenariului către `POST /api/craiova/explain` și redă explicația în limbaj natural pe baza enunțurilor matematice verificate.

Taste rapide: `Spațiu` redare/pauză, `Esc` deselectare, `1` / `2` vedere largă / apropiată.

## Structură

```text
src/contracts/backend.ts   Tipurile TypeScript ale backendului (inclusiv modelele matematice 4D)
src/contracts/schemas.ts   Scheme Zod: fiecare răspuns API este validat strict la graniță
src/data/                  Geometria LRCV din AIP (lrcv-geo.json, pista 08/26) + preseturi meteo
src/sim/                   Geometrie sferică, interpolare, hipodrom ICAO (appendRacetrack), model trafic
src/api/                   Client HTTP + motor mock complet (mockBackend.ts, mockLive.ts)
src/state/store.ts         Starea comună Zustand (scenariu, revizie, ceas, selecție)
src/components/            TopBar, MapView, DetailsPanel, Timeline, AskAi, LiveView
```
