# AERIS — frontend

React 19 + TypeScript + Vite 8, hartă Leaflet (react-leaflet 5), stare comună Zustand.

## Ce trebuie instalat

Doar două programe; restul (biblioteci, fonturi, date AIP) e în proiect.

| Program | Versiune | De unde |
|---|---|---|
| Node.js | 22.12+ sau 24 (vezi `.nvmrc`) | https://nodejs.org |
| .NET SDK | 10 (pentru backend) | https://dotnet.microsoft.com/download |

Fonturile (IBM Plex Sans Condensed și IBM Plex Mono) sunt în `src/assets/fonts`, cu licența OFL; nu se instalează pe sistem și nu se descarcă de pe internet.

## Pornire

Backendul, din `KWAD/AERIS API`:

```bash
dotnet run
```

Frontendul, din `KWAD/frontend` (prima dată `npm ci` instalează bibliotecile exact din `package-lock.json`):

```bash
npm ci
```

```bash
npm run dev
```

Deschide http://localhost:5173 (pagina Live) sau http://localhost:5173/#/demo (simularea).

Alte comenzi:

```bash
npm run dev:mock   # fără backend: date de exemplu din src/api/mockBackend.ts și src/api/mockLive.ts
npm test           # testele (vitest)
npm run build      # build de producție în dist/
```

Backendul nu are CORS: în dev, `/api` trece prin proxy-ul Vite spre `http://localhost:5271`. Dacă backendul rulează pe alt port, pornește frontendul cu variabila `AERIS_API`, de exemplu în PowerShell `$env:AERIS_API="http://localhost:5272"; npm run dev`.

**Internet:** pagina Live are nevoie de internet (backendul cere datele de la OpenSky și aviationweather.gov), la fel fundalul „Hartă geografică”. Pagina Demo și modul `dev:mock` merg fără internet.

## Două pagini

- `#/live` (implicit): avioanele reale din OpenSky (`/api/craiova/live-positions`, la 15 s), punctele VFR (`/api/craiova/vfr/tracking`) și METAR-ul real LRCV (`/api/weather/metar/decoded`, la 5 min). Pista afișată e cea cu vânt de față după METAR.
- `#/demo`: simularea pentru prezentare (descrisă mai jos). La prezentare deschide direct `http://localhost:5173/#/demo`.

Comutatorul Live / Demo din bara de sus schimbă adresa, deci modul rămâne și după refresh.

## Ce face (Demo)

- Încarcă traficul cu `GET /api/craiova/live-traffic?forceSimulated=true` (repetabil) și îl evaluează cu `POST /api/craiova/evaluate` pentru presetul meteo ales. Frontendul deține scenariul și o revizie care crește la fiecare modificare; răspunsurile pentru revizii vechi sunt ignorate.
- Harta: CTR 20 NM, pista 08/26, tranzițiile RNP reale din AIP (AIRAC 2026-10-01), avioane cu bloc de date, urmă doar până la momentul curent, traseul planificat pentru avionul selectat și circuite de așteptare tip hipodrom (`appendRacetrack`). Fără fundal implicit (merge offline); OSM opțional.
- Pozițiile avioanelor sunt **sintetice**: traiectoriile urmează traseele AIP și aterizează exact la slotul dat de backend (sau la ETA dacă nu există slot). Frontendul nu calculează ordinea.
- Panou:
  - sus: predicția pe 45 de minute (`T+0` .. `T+45m`), altitudinea de densitate și vântul la 2000 ft / 5000 ft (click pe un orizont mută ceasul simulării acolo);
  - în banda fiecărui avion: predicția cu 2 pași înainte (`T0` -> `Pas +1` -> `Pas +2`, click pentru salt în timp), analiza de la decolare la aterizare (TOD, panta de 3°, unghiul de derivă, distanța de oprire pe pistă și cele 6 faze), iar pentru VFR calculul Point of No Return (PNR) și clasamentul pistelor apropiate (Podari, Craiova-Sud, Slatina);
  - jos: modulul de întrebări pentru AI-ul local (`AskAi`), care explică rezultatele scenariului în limbaj natural.
- Timeline jos (fereastră, ETA, slot, ceas care se poate muta cu mouse-ul).

Taste: `Spațiu` redare/pauză, `Esc` deselectare, `1` / `2` vedere largă / apropiată.

## Structură

```text
src/contracts/backend.ts   tipurile răspunsurilor backendului
src/contracts/schemas.ts   scheme zod: fiecare răspuns e validat la sosire; un contract schimbat dă eroare cu numele câmpului
src/data/                  geometria LRCV din AIP + puncte sintetice + preseturi meteo
src/sim/                   geometrie, interpolare, traiectorii sintetice (hipodrom / orbită), model de trafic
src/api/                   client HTTP + mock
src/state/store.ts         starea comună (scenariu, revizie, ceas, selecție)
src/components/            TopBar, MapView, DetailsPanel, Timeline, AskAi, LiveView
```

## Comportamente ale backendului pe care UI-ul le arată explicit

- Doar primul VFR primește slot (`SequenceGenerator.cs`); celelalte apar „fără slot”.
- „Balta Verde / LRBV” din backend este Craiova-Sud (LRCW) în AIP; pe hartă se folosesc coordonatele AIP ale LRCW.
- Ora: backendul calculează față de o bază fixă 14:00, fără dată sau fus orar; UI-ul scrie „ora scenariului”.
