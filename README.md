# AERIS (KWAD)

Aplicație de planificare a sosirilor, simulare matematică a zborului și suport decizional pentru Aeroportul Internațional Craiova (`LRCV`), scrisă în .NET 10 (ASP.NET Core Web API) și React 19 + TypeScript + Leaflet.

Documentația completă (formulele folosite, structura proiectului și rutele API) este în [docs/DOCUMENTATIE_TEHNICA.md](docs/DOCUMENTATIE_TEHNICA.md).

## Ce face aplicația

La Craiova (`LRCV`, pista `08/26`, 2500 m) traficul comercial IFR (Airbus A320/A321, ATR 72) împarte spațiul aerian (CTR clasa C, 20 NM) cu aviația ușoară VFR (Savannah S, Wilga 35A, Cessna 172), care are limite mici la vântul lateral (11–15 kt). Aplicația rezolvă secvențierea la aterizare și deciziile pentru zborurile VFR în patru direcții:

1. **Predicție pe 45 de minute (`T+0` .. `T+45m`):**
   Calculează altitudinea de densitate (ISA), vântul în altitudine la 2000 ft și 5000 ft (legea lui Hellmann + rotația Ekman) și estimează evoluția vântului lateral, pista recomandată (`08` sau `26`), numărul de avioane din sector și fereastra în care avioanele VFR pot ateriza în siguranță.

2. **Analiză de la decolare la aterizare și predicție cu 2 pași înainte:**
   - Pentru fiecare avion calculează cele 6 faze ale zborului (decolare, croazieră, Top of Descent, apropiere inițială, finală pe panta de 3°, rulaj pe pistă), unghiul de derivă la vânt (`WCA`), rata de coborâre (`ROD`), distanța de oprire pe pistă (`LDR` raportat la cei 2500 m disponibili) și timpul de ocupare a pistei (`ROT`).
   - Arată poziția și parametrii avionului cu **2 pași înainte**: `T0` (intrarea în sector) -> `Pas +1` (punctul intermediar `OZZET` / `NECCO` sau intrarea în așteptare) -> `Pas +2` (aterizarea pe prag sau pe un aerodrom alternativ).

3. **Decizie pentru VFR (orbită sau redirecționare către piste apropiate):**
   - Când vântul lateral pe Craiova depășește limita avionului VFR, calculează **Point of No Return (PNR)** din combustibilul rămas, consumul redus în așteptare față de croazieră și rezerva legală VFR de 30 de minute.
   - Evaluează pistele înierbate din apropiere (**Podari** `02/20`, **Craiova-Sud / Balta Verde** `LRCW` `13/31`, **Slatina** `08/26`) și le dă un scor de la 0 la 100 în funcție de vântul lateral pe pista respectivă, distanță și lungimea pistei, indicând capul compas de zburat și timpul până la aterizare.

4. **Separare 4D a traiectoriilor și baze de date ROMATSA (IFR + VFR):**
   - Verifică traiectoriile la pas de 5 secunde (separare orizontală/verticală, turbulență de siaj ICAO, ocuparea pistei și așteptarea în hipodrom) și replanifică automat sloturile dacă apare un conflict.
   - Include două baze de date JSON după modelul AIP România / ROMATSA: una pentru **IFR** (`AERIS API/data/romatsa-ifr-mock-db.json`) și una pentru **VFR** (`AERIS API/data/romatsa-vfr-mock-db.json`).
   - Include un modul AI local de 4B parametri (`GroundedExplainer`) care nu face calcule pe cont propriu, ci doar transformă rezultatele matematice ale backendului în propoziții clare în limba română (cu fallback determinist dacă modelul local nu este pornit).

## Cum se pornește

Ai nevoie de **.NET 10 SDK** și **Node.js 22.12+ (sau 24)**.

### 1. Backend (.NET 10)
```powershell
cd "AERIS API"
dotnet run
```
Serverul pornește pe `http://localhost:5271` (Swagger este la `http://localhost:5271/swagger`).

### 2. Frontend (React + Vite)
Într-un alt terminal:
```powershell
cd frontend
npm ci
npm run dev
```
- Pagina **Demo** (simularea completă pentru prezentare): `http://localhost:5173/#/demo`
- Pagina **Live** (trafic real din OpenSky + METAR real `LRCV`): `http://localhost:5173/#/live`
- Dacă vrei să pornești doar frontendul fără backend: `npm run dev:mock`

## Teste

```powershell
# Teste backend (.NET 10 - 15 teste pentru separare 4D, predicție și calcule VFR)
dotnet run -c Release --project "AERIS.Tests/AERIS.Tests.csproj"

# Teste frontend (Vitest - 49 teste pentru scheme Zod, simulare și geometrie)
cd frontend
npm test -- --run
```

## Structura repo-ului

- `AERIS API/` — backendul .NET 10:
  - `Services/FlightPhysicsAndPredictionEngine.cs` — calculele de atmosferă, vânt pe altitudine, predicția pe 45 min, analiza decolare-aterizare, cei 2 pași înainte și decizia VFR (PNR + scorul pistelor apropiate).
  - `Services/TrajectorySeparation/` — predicția traiectoriilor 4D, hipodromul de așteptare (racetrack) și rezolvarea conflictelor de separare.
  - `Services/CraiovaAdvisoryEngine.cs`, `SequenceGenerator.cs`, `CrosswindCalculator.cs` — secvențierea la aterizare și recomandările pe aeronave.
  - `Services/MetarParser.cs`, `OpenSkyService.cs`, `VmcChecker.cs`, `VfrGeofenceService.cs` — preluarea datelor live și verificarea condițiilor VMC.
  - `GroundedExplainer.cs` — traducerea datelor în limbaj natural cu modelul local 4B.
  - `data/` — bazele de date `romatsa-ifr-mock-db.json` și `romatsa-vfr-mock-db.json`.
- `AERIS.Tests/` — testele pentru motorul matematic și separarea traiectoriilor.
- `frontend/` — interfața radar în React + Leaflet (detalii în [frontend/README.md](frontend/README.md)).
- `docs/DOCUMENTATIE_TEHNICA.md` — documentația tehnică a aplicației.

## Rute API principale

- `POST /api/craiova/evaluate` — evaluează un scenariu (vreme + listă de avioane) și returnează sloturile, predicția pe 45 min, analiza pe 6 faze, cei 2 pași înainte și decizia VFR.
- `GET /api/craiova/simulation` — simulare directă cu parametri în query (`windSpeed`, `windDirection`, `windGust`, `visibility`).
- `GET /api/craiova/alternates` — lista aerodromurilor apropiate (`PODARI`, `LRCW`, `SLATINA`) cu vântul lateral și scorul calculat.
- `GET /api/craiova/romatsa/vfr` și `GET /api/craiova/romatsa/ifr` — bazele de date mock ROMATSA pentru VFR și IFR.
- `POST /api/craiova/explain` — explicație în limbaj natural a situației curente sau a scenariului din Demo.
- `POST /api/separation/evaluate` și `GET /api/separation/demo-conflict` — verificarea separării 4D și replanificarea automată.
- `GET /api/craiova/live-positions`, `GET /api/craiova/vfr/tracking`, `GET /api/weather/metar/decoded` — datele în timp real pentru pagina Live.
