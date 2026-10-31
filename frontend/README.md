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

- `#/live` (implicit): avioanele reale din OpenSky (`/api/craiova/live-positions`, la 15 s) și METAR-ul real LRCV (`/api/weather/metar/decoded`, la 5 min). Pista afișată e cea cu vânt de față după METAR.
- `#/demo`: simularea pentru prezentare (descrisă mai jos). La hackathon deschide direct `http://localhost:5173/#/demo`.

Comutatorul Live / Demo din bara de sus schimbă adresa, deci modul rămâne și după refresh.

## Ce face (Demo)

- Încarcă traficul cu `GET /api/craiova/live-traffic?forceSimulated=true` (repetabil) și îl evaluează cu `POST /api/craiova/evaluate` pentru presetul meteo ales. Frontendul deține scenariul și o revizie care crește la fiecare modificare; răspunsurile pentru revizii vechi sunt ignorate.
- Harta: CTR 20 NM, pista 09/27, tranzițiile RNP reale din AIP (AIRAC 2026-10-01), avioane cu bloc de date, urmă doar până la momentul curent, traseul planificat pentru avionul selectat. Fără fundal implicit (merge offline); OSM opțional.
- Pozițiile avioanelor sunt **sintetice**: backendul nu trimite poziții. Traiectoriile urmează traseele AIP și aterizează exact la slotul dat de backend (sau la ETA dacă nu există slot). Frontendul nu calculează ordinea.
- Panou: situația sosirilor, apoi detaliile aeronavei selectate (recomandare, orbită, alternative). Analiza AI apare „indisponibilă” până există endpoint.
- Timeline simplu (fereastră, ETA, slot, ceas care se poate muta cu mouse-ul). Formularul VFR, variantele și Apply sunt modulul lui Daha; clientul pentru ele există deja (`evaluatePlanning` în `src/api/client.ts`).

Taste: `Spațiu` redare/pauză, `Esc` deselectare, `1` / `2` vedere largă / apropiată.

## Structură

```
src/contracts/backend.ts   tipurile răspunsurilor backendului (commit ad6e098)
src/contracts/schemas.ts   scheme zod: fiecare răspuns e validat la sosire; un contract schimbat dă eroare cu numele câmpului
src/data/                  geometria LRCV din AIP + puncte sintetice + preseturi meteo
src/sim/                   geometrie, interpolare, traiectorii sintetice, model de trafic (funcții pure, testate)
src/api/                   client HTTP + mock
src/state/store.ts         starea comună (scenariu, revizie, ceas, selecție)
src/components/            TopBar, MapView, DetailsPanel, Timeline
```

## Comportamente ale backendului pe care UI-ul le arată explicit

- Doar primul VFR primește slot (`SequenceGenerator.cs`); celelalte apar „fără slot”.
- „Balta Verde / LRBV” este de fapt Craiova-Sud (LRCW); pe hartă se folosesc coordonatele AIP ale LRCW.
- Ora: backendul calculează față de o bază fixă 14:00, fără dată sau fus orar; UI-ul scrie „ora scenariului”.
