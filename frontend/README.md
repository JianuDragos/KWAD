# AERIS — Frontend

Interfață web pentru controlul și planificarea traficului aerian la Aeroportul Internațional Craiova (`LRCV`), construită cu React 19, TypeScript, Vite 8, Leaflet (`react-leaflet` 5) și Zustand.

## Cerințe

| Program | Versiune | Descărcare |
|---|---|---|
| Node.js | 22.12+ sau 24 (vezi `.nvmrc`) | https://nodejs.org |
| .NET SDK | 10 (pentru backend) | https://dotnet.microsoft.com/download |

Fonturile (`IBM Plex Sans Condensed` și `IBM Plex Mono`) sunt incluse local în `src/assets/fonts` (licență OFL) și nu necesită conexiune la internet.

## Pornire

1. **Backendul** (din directorul `AERIS API`):
```powershell
dotnet run --launch-profile http
```

2. **Frontendul** (din directorul `frontend`):
```powershell
npm ci
npm run dev
```

Aplicația pornește la `http://localhost:5173`.

Alte comenzi utile:
```powershell
npm run dev:mock   # rulare fără backend (folosește src/api/mockBackend.ts și src/api/mockLive.ts)
npm test -- --run  # rularea suitei de teste (Vitest - 88 teste)
npm run build      # compilare de producție în dist/
```

În modul de dezvoltare, cererile `/api` sunt redirecționate prin proxy-ul Vite către `http://localhost:5271`. Pentru un alt port de backend se poate seta variabila `AERIS_API` (ex. `$env:AERIS_API="http://localhost:5272"; npm run dev`).

## Moduri de lucru

Comutatorul din bara superioară permite navigarea între cele trei moduri (păstrate în URL după refresh):

- **`#/live` (Trafic real):** afișează aeronavele reale din sectorul Craiova (`/api/craiova/live-positions`), urmărirea VFR (`/api/craiova/vfr/tracking`) și datele METAR decodate (`/api/weather/metar/decoded`).
- **`#/demo` (Simulare):** încarcă traficul demonstrativ (Standard sau Eurasia Long-Haul) și îl evaluează cu `POST /api/craiova/evaluate` pentru presetul meteo selectat. Include:
  - Harta radar cu CTR 20 NM, TMA Craiova, pista `08/26`, procedurile RNP din AIP, traiectoriile complete de la decolare la aterizare, circuitele de așteptare tip hipodrom și rutele de redirecționare VFR către **Aerodromul Balta Verde Craiova (`LRCW` — Aeroclubul României)** sau **Aerodrom Slatina (`SLATINA`)**.
  - Panoul lateral cu prognoza meteo pe 45 de minute (`T+0` .. `T+45m`), benzile de zbor, predicția cu 2 pași înainte (`T0` -> `Pas +1` -> `Pas +2`), analiza pe 6 faze și calculul VFR (PNR + clasamentul aerodromurilor alternative).
  - Cronologia interactivă (scrubber temporal, sloturi și ferestre ETA).
- **`#/assistant` (Asistent Tactic ATC):** consolă de analiză operațională în limba română (conectată la modelul local `Qwen3-4B` cu verificare C#) și panou interactiv de decizie pentru aeronavele VFR aflate în așteptare (așteptare rând pe `LRCV` vs. redirecționare la alternativă).

## Preferințe și comenzi rapide

- Din meniul **Setări** (bara superioară) se pot comuta unitățile de măsură (`NM`/`km`, `kt`/`km/h`, `ft`/`m`) și straturile hărții (rute, sectoare FIR, hartă geografică OSM).
- Scurtături tastatură în modul Demo: `Spațiu` (redare/pauză), `Esc` (deselectare), `1` / `2` (vedere regională / apropiată).

## Structura codului

```text
src/contracts/     tipurile TypeScript și schemele Zod pentru validarea răspunsurilor API
src/data/          geometria LRCV din AIP, aerodromurile de origine/rezervă și preseturile meteo
src/sim/           calcule geometrice, interpolare temporală și construcția traiectoriilor
src/api/           clientul HTTP, integrarea bazelor ROMATSA și implementarea mock
src/state/         starea aplicației (Zustand): scenariu, revizie, ceas, trafic live, asistent și preferințe
src/components/    TopBar, SettingsMenu, MapView, DetailsPanel, Timeline, AssistantView, LivePanel
```
