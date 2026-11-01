# AERIS (KWAD)

Aplicație de planificare a sosirilor, simulare matematică a zborului și suport decizional pentru Aeroportul Internațional Craiova (`LRCV`), scrisă în .NET 10 (ASP.NET Core Web API) și React 19 + TypeScript + Leaflet.

Documentația tehnică completă (formulele fizice, arhitectura și rutele API) se găsește în [docs/DOCUMENTATIE_TEHNICA.md](docs/DOCUMENTATIE_TEHNICA.md).

## Ce face aplicația

La Craiova (`LRCV`, pista `08/26`, 2500 m) traficul comercial IFR (Airbus A320/A321, ATR 72) împarte spațiul aerian (CTR clasa C, 20 NM) cu aviația ușoară VFR (Savannah S, Wilga 35A, Cessna 172), care are limite reduse la vântul lateral (11–15 kt). Aplicația asistă controlorul de trafic aerian în secvențierea la aterizare și în deciziile operaționale VFR pe patru direcții:

1. **Prognoză meteo pe 45 de minute (`T+0` .. `T+45m`):**
   Calculează altitudinea de densitate (ISA), profilul vântului pe altitudine la 2000 ft și 5000 ft (legea lui Hellmann + rotația Ekman) și estimează evoluția vântului lateral, pista recomandată (`08` sau `26`), numărul de aeronave din sector și fereastra în care zborurile VFR pot ateriza în siguranță.

2. **Analiză de la decolare la aterizare și predicție cu 2 pași înainte:**
   - Pentru fiecare aeronavă calculează cele 6 faze ale zborului (decolare, croazieră, Top of Descent, apropiere inițială, finală pe panta de 3°, rulaj pe pistă), unghiul de derivă la vânt (`WCA`), rata de coborâre (`ROD`), distanța de oprire pe pistă (`LDR` raportat la cei 2500 m disponibili) și timpul de ocupare a pistei (`ROT`).
   - Afișează poziția și parametrii aeronavei cu **2 pași înainte**: `T0` (intrarea în sector) -> `Pas +1` (punctul intermediar `OZZET` / `NECCO` sau intrarea în așteptare) -> `Pas +2` (aterizarea pe prag sau pe aerodromul de rezervă).

3. **Decizie pentru zborurile VFR (așteptare în orbită sau redirecționare):**
   - Când vântul lateral pe Craiova depășește limita aeronavei VFR sau pista este ocupată de traficul IFR, calculează **Point of No Return (PNR)** din combustibilul rămas, consumul redus în așteptare față de croazieră și rezerva legală VFR de 30 de minute.
   - Evaluează aerodromul local al Craiovei — **Aerodromul Balta Verde Craiova (`LRCW`), administrat de Aeroclubul României** (pistă înierbată 920 m) — și, ca punct secundar, **Aerodrom Slatina (`SLATINA`, 700 m)**, acordând fiecăruia un scor de siguranță de la 0 la 100 în funcție de vântul lateral, distanță și lungimea pistei.

4. **Separarea traiectoriilor, baze de date ROMATSA și Asistent Tactic AI:**
   - Verifică traiectoriile la pas de 5 secunde (separare orizontală și verticală, turbulență de siaj ICAO, ocuparea pistei și așteptarea în hipodrom) și replanifică automat sloturile dacă apare un conflict.
   - Include două baze de date JSON după modelul AIP România / ROMATSA: una pentru **IFR** (`AERIS API/data/romatsa-ifr-mock-db.json`) și una pentru **VFR** (`AERIS API/data/romatsa-vfr-mock-db.json`).
   - Include un modul AI local (`GroundedExplainer` cu `Qwen3-4B-Instruct-2507` prin `llama.cpp`) care formulează răspunsuri în limba română exclusiv din datele calculate de backend, cu verificare numerică C# și sinteză deterministă de rezervă.

## Cum se pornește

Ai nevoie de **.NET 10 SDK** și **Node.js 22.12+ (sau 24)**.

### 1. Modelul AI local (opțional, pentru tab-ul Asistent)
```powershell
cd "AERIS-Backend-Handoff"
powershell -NoProfile -File .\Start-LLM.ps1
```
Serverul de inferență pornește local pe `http://127.0.0.1:18090` (dacă nu este pornit, backendul folosește automat motorul determinist C#).

### 2. Backend (.NET 10)
```powershell
cd "AERIS API"
dotnet run --launch-profile http
```
Serverul pornește pe `http://localhost:5271` (Swagger este disponibil la `http://localhost:5271/swagger`).

### 3. Frontend (React + Vite)
Într-un alt terminal:
```powershell
cd frontend
npm ci
npm run dev
```
- **Trafic real (Live):** `http://localhost:5173/#/live` (OpenSky / ADSB.lol + OGN APRS + METAR real `LRCV`)
- **Simulare (Demo):** `http://localhost:5173/#/demo` (scenarii meteo și secvențiere completă)
- **Asistent Tactic ATC:** `http://localhost:5173/#/assistant` (analiză conversațională și decizie VFR)
- Rulare frontend fără backend (mod demonstrativ izolat): `npm run dev:mock`

## Teste

```powershell
# Teste backend (.NET 10 - 22 teste pentru separarea traiectoriilor, predicție, calcule VFR și verificare AI)
dotnet test "AERIS.Tests/AERIS.Tests.csproj"

# Teste frontend (Vitest - 88 teste pentru scheme Zod, simulare, geometrie și preferințe)
cd frontend
npm test -- --run
```

## Structura proiectului

- `AERIS API/` — backendul .NET 10:
  - `Services/FlightPhysicsAndPredictionEngine.cs` — calculele de atmosferă, vânt pe altitudine, prognoza pe 45 min, analiza decolare-aterizare, cei 2 pași înainte și decizia VFR (PNR + evaluarea `LRCW` Balta Verde și `SLATINA`).
  - `Services/TrajectorySeparation/` — predicția traiectoriilor în timp și spațiu, hipodromul de așteptare (racetrack) și rezolvarea conflictelor de separare.
  - `Services/CraiovaAdvisoryEngine.cs`, `SequenceGenerator.cs`, `CrosswindCalculator.cs` — secvențierea la aterizare și recomandările pe aeronave.
  - `Services/MetarParser.cs`, `OpenSkyService.cs`, `OpenSkyLiveService.cs`, `OgnAprsListener.cs`, `VmcChecker.cs` — preluarea traficului și a datelor meteo în timp real.
  - `GroundedExplainer.cs` — generarea și verificarea numerică a explicațiilor în limbaj natural.
  - `data/` — bazele de date `romatsa-ifr-mock-db.json` și `romatsa-vfr-mock-db.json`.
- `AERIS-Backend-Handoff/` — pachetul local `llama.cpp` + modelul `Qwen3-4B-Instruct-2507` (GGUF).
- `AERIS.Tests/` — suita de teste automate xUnit pentru backend.
- `frontend/` — interfața radar în React + TypeScript + Leaflet (detalii în [frontend/README.md](frontend/README.md)).
- `docs/DOCUMENTATIE_TEHNICA.md` — documentația tehnică a aplicației.

## Rute API principale

- `POST /api/craiova/evaluate` — evaluează un scenariu (vreme + listă de aeronave) și returnează sloturile, prognoza pe 45 min, analiza pe 6 faze, cei 2 pași înainte și decizia VFR.
- `GET /api/craiova/simulation` — simulare directă cu parametri în query (`windSpeed`, `windDirection`, `windGust`, `visibility`).
- `GET /api/craiova/alternates` — evaluarea aerodromului **Balta Verde Craiova (`LRCW` — Aeroclubul României)** și a punctului secundar **Slatina (`SLATINA`)**.
- `GET /api/craiova/romatsa/vfr` și `GET /api/craiova/romatsa/ifr` — bazele de date ROMATSA pentru VFR și IFR.
- `POST /api/craiova/explain` — explicație verificată în limba română a situației curente sau a scenariului din Demo.
- `POST /api/separation/evaluate` și `GET /api/separation/demo-conflict` — verificarea separării traiectoriilor și replanificarea automată.
- `GET /api/craiova/live-positions`, `GET /api/craiova/vfr/tracking`, `GET /api/weather/metar/decoded` — datele în timp real pentru pagina Live.
