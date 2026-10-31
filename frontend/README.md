# AERIS — frontend

React 19 + TypeScript + Vite 8, hartă Leaflet (react-leaflet 5), stare comună Zustand.

## Pornire

```bash
npm install
npm run dev:mock   # fără backend: port local al motorului (src/api/mockBackend.ts), pill „MOCK” în UI
npm run dev        # cu backend: pornește întâi „AERIS API” (dotnet run → http://localhost:5271)
npm test           # vitest: interpolare, rute AIP, mock = backend, traiectorii, scheme zod, store (revizii, reset)
npm run build      # build de producție (tsc + vite)
```

Backendul nu are CORS: în dev, `/api` trece prin proxy-ul Vite spre `http://localhost:5271` (`vite.config.ts`). Folosește profilul `http` al backendului.

## Ce face

- Încarcă traficul cu `GET /api/craiova/live-traffic?forceSimulated=true` (repetabil) și îl evaluează cu `POST /api/craiova/evaluate` pentru presetul meteo ales. Frontendul deține scenariul și o revizie care crește la fiecare modificare; răspunsurile pentru revizii vechi sunt ignorate.
- Harta: CTR 20 NM, pista 08/26, tranzițiile RNP reale din AIP (AIRAC 2026-10-01), avioane cu bloc de date, urmă doar până la momentul curent, traseul planificat pentru avionul selectat. Fără fundal implicit (merge offline); OSM opțional.
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
- Backendul numește pista 09/27; harta afișează 08/26 (AIP curent) și arată și denumirea din backend.
- „Balta Verde / LRBV” este de fapt Craiova-Sud (LRCW); pe hartă se folosesc coordonatele AIP ale LRCW.
- Ora: backendul calculează față de o bază fixă 14:00, fără dată sau fus orar; UI-ul scrie „ora scenariului”.
