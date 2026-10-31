# AERIS (KWAD) — 4D Air Traffic Management, Trajectory Prediction & Decision Support System (`LRCV`)

**AERIS** este o platformă avansată de **Arrival Management (AMAN), Predicție 4D a Viitorului, Separare a Traiectoriilor și Suport Decizional ATC** dedicată **Aeroportului Internațional Craiova (`LRCV` / `CRA`)**, construită pe **.NET 10 (ASP.NET Core Web API)** și **React 19 + TypeScript + Leaflet**.

Sistemul combină **fizica zborului și cinematica atmosferică deterministă** (prioritatea nr. 1 pentru siguranța ATC) cu **date reale în timp real** (OpenSky Network + METAR multi-sursă), **baze de date procedurale de tip ROMATSA AIP (IFR & VFR)** și un **modul AI local de 4B parametri (`GroundedExplainer`)** care traduce calculele matematice verificate în limbaj natural pentru controlorul de trafic și piloți.

> 📄 **Documentația tehnică și matematică detaliată** (ecuații fizice, arhitectură, contracte API, scheme de date și ghid de prezentare Demo) se află în **[`docs/DOCUMENTATIE_TEHNICA.md`](docs/DOCUMENTATIE_TEHNICA.md)**.

---

## ✨ Capabilități Principale (Hackathon Edition)

### 1. 🔮 Predicția Viitorului 4D (`T+0` → `T+45 min`)
- **Model Atmosferic ISA & Altitudine de Densitate ($\text{DA}$):** Calculează abaterea față de atmosfera standard ($\Delta T_{\text{ISA}}$), altitudinea barometrică, altitudinea de densitate și raportul de densitate $\sigma = \rho/\rho_0$ pentru conversia exactă $\text{TAS} = \text{IAS}/\sqrt{\sigma}$.
- **Forfecarea Verticală a Vântului (*Wind Shear*):** Modelează vântul la $2000\text{ ft}$ și $5000\text{ ft}$ prin **legea puterii lui Hellmann** $V(h) = V_{10}\cdot(h/h_{10})^\alpha$ combinată cu **rotația spiralei Ekman** ($+10^\circ \dots +18^\circ$ în altitudine).
- **Nowcasting pe 6 Orizonturi ($T+0, T+5\text{m}, T+10\text{m}, T+15\text{m}, T+30\text{m}, T+45\text{m}$):** Prezice evoluția rafalelor, pista activă optimă (`RWY 08` vs `RWY 26`), încărcarea TMA, numărul de aeronave în holding și **fereastra optimă de aterizare VFR**.

### 2. ♟️ „Doi Pași Înaintea Avionului” (*Two Steps Ahead Prediction*)
Pentru fiecare aeronavă din sector, motorul calculează anticipativ trei stări discrete (cu salt interactiv pe cronologia radar):
1. **$T_0$ (Starea Curentă — Intrare Sector / TMA / CTR):** Poziția, altitudinea, $\text{GS}$, capul compas corectat la vânt și verificarea QNH.
2. **Pasul +1 (Poziția Tactică Viitoare — Fix Intermediar):** Sosirea la `OZZET` (IF RWY 26), `NECCO` (IF RWY 08), intrarea în hipodromul de așteptare sau inițierea vectorizării de degajare.
3. **Pasul +2 (Rezoluția Finală — Touchdown / Alternativă):** Atingerea pragului pistei `THR 08/26` la slotul optimizat sau aterizarea pe pista alternativă recomandată (`PODARI`, `LRCW` Craiova-Sud, `SLATINA`).

### 3. 🛬 Analiză Completă De-la-Decolare-la-Aterizare (*Takeoff-to-Landing Analysis*)
- Reconstituie profilul cinematic și energetic în **6 faze**: `1. Takeoff (TOF)` $\to$ `2. Enroute Cruise (CRZ)` $\to$ `3. Top of Descent (TOD)` $\to$ `4. Initial Approach (IAF/IF)` $\to$ `5. Final Approach 3.0° (FAF)` $\to$ `6. Touchdown & Rollout (LDG)`.
- **Triunghiul Vitezelor & Unghiul de Derivă ($\text{WCA}$):** Calculează $\text{WCA} = \arcsin(V_{\text{xw}}/\text{TAS})$, capul compas de zburat ($\text{HDG}$) și viteza față de sol pe panta finală ($\text{GS}_{\text{app}}$).
- **Cinematica Pantei de $3.0^\circ$ & Distanța de Aterizare ($\text{LDR}$):** Calculează punctul $\text{TOD}$, rata de coborâre necesară $\text{ROD} \approx \text{GS}\cdot 5.31\text{ fpm}$, energia specifică totală $E_s = h + V^2/(2g)$, distanța de oprire $\text{LDR}$ raportată la $\text{LDA} = 2500\text{ m}$ și timpul de ocupare a pistei ($\text{ROT}$).

### 4. 🧭 Decizie Matematică VFR: Orbită vs. Redirecționare la Piste Apropiate
- **Calculul *Point of No Return* ($\text{PNR}$):** Determină timpul maxim de așteptare în orbită înainte ca rezerva de combustibil să impună degajarea (luând în calcul consumul redus în holding $\approx 0.78\times$ croazieră, timpul de zbor spre alternativă cu vânt și rezerva legală VFR de $30\text{ min}$).
- **Clasament Multi-Criterial ($0\text{–}100$) al Pistelor din Apropiere:**
  - **Aerodrom Podari (`PODARI`):** Pistă înierbată ULM `02/20` ($020^\circ/200^\circ$, $500\text{ m}$), la $14.5\text{ km}$ SV — aliniată aproape perfect pe vântul critic de sud ($180^\circ$).
  - **Aerodrom Craiova-Sud / Balta Verde (`LRCW` / `LRBV`):** Pistă înierbată `13/31` ($130^\circ/310^\circ$, $600\text{ m}$), la $11.8\text{ km}$ VSV.
  - **Aerodrom Slatina (`SLATINA`):** Pistă `08/26` ($080^\circ/260^\circ$, $700\text{ m}$), la $46.0\text{ km}$ ENE.

### 5. 🛡️ Motor 4D de Separare a Traiectoriilor & Replanificare Automată
- **Verificare 4D (Latitudine, Longitudine, Altitudine, Timp):** Eșantionează traiectoriile la pas de $5\text{ s}$ pe procedurile reale AIP (`TITEK`, `PEMOK`, `PANZU` $\to$ `OZZET`/`NECCO` $\to$ `CV508`/`CV408` $\to$ `THR 26/08`).
- **Reguli ICAO Clasa C & Turbulență de Siaj (*Wake Turbulence*):** Verifică separarea minimă ($3.0\text{ NM}$ / $1000\text{ ft}$ IFR-IFR, matricea de siaj `Heavy`/`Medium`/`Light`, ocuparea pistei și conflictele în hipodromul de așteptare *Racetrack* sau pe procedura *Missed Approach*).
- **Auto-Replanificare (`SafePlanningCoordinator`):** Rezolvă automat conflictele prin decalarea sloturilor, etajarea pe verticală în holding ($+1000\text{ ft}$) sau redirecționarea VFR.

### 6. 🗂️ Baze de Date Mock ROMATSA (IFR + VFR) & Date Live
- **[`AERIS API/data/romatsa-ifr-mock-db.json`](AERIS%20API/data/romatsa-ifr-mock-db.json):** Reguli FIR București (`LRBB`), matrice wake turbulence, proceduri RNP/ILS `RWY 08/26`, holding-uri publicate, performanțe BADA (`A320-232`, `A321neo`, `ATR 72-600`, `B737-800`, `E190`) și alternative IFR (`LROP`, `LRTR`, `LRSB`, `LBSF`).
- **[`AERIS API/data/romatsa-vfr-mock-db.json`](AERIS%20API/data/romatsa-vfr-mock-db.json):** Coridoare VFR LRCV (`VFR-S`, `VFR-N`, `VFR-W`), minime VMC SERA.5001, aeronave ușoare (`ICP Savannah S`, `PZL-104 Wilga 35A`, `Cessna 172S`, `Diamond DA40`, `Tecnam P2008JC`) și aerodromuri regionale de degajare.
- **METAR Multi-Sursă Rezilient:** Preluare automată cu fallback în cascadă (`AviationWeather.gov` $\to$ `CheckWX` $\to$ `AVWX`) și cache de $5\text{ min}$.

### 7. 🤖 Interpretare AI Locală 4B (`GroundedExplainer`)
- Folosește un model LLM local compact ($4\text{B}$ parametri, compatibil OpenAI API pe `localhost:1234`) **exclusiv pentru a selecta și traduce în limbaj natural** enunțurile matematice deja calculate și validate de backend.
- **Zero halucinații:** Modelul nu poate inventa cifre, piste sau autorizări; dacă serverul LLM local este oprit, sistemul comută instantaneu pe **modul determinist (`deterministic_fallback`)**.

---

## 🏗️ Arhitectura Proiectului

```text
aeris/
├── AERIS API/                         # Backend .NET 10 (ASP.NET Core Web API)
│   ├── Controllers/
│   │   ├── CraiovaController.cs       # Simulare LRCV, Live OpenSky, VFR Geofence, AI Explain, ROMATSA DB
│   │   ├── PlanningController.cs      # Optimizare secvențe de aterizare (IFR + inserție VFR)
│   │   ├── SeparationController.cs    # Evaluare 4D separare traiectorii & auto-replanificare
│   │   └── WeatherController.cs       # METAR raw/decodat & verificare VMC SERA.5001
│   ├── Services/
│   │   ├── FlightPhysicsAndPredictionEngine.cs # Predicție 4D, 2 Pași Înainte, Takeoff-to-Landing, VFR PNR
│   │   ├── CraiovaAdvisoryEngine.cs   # Orchestrator recomandări ATC & integrare matematică
│   │   ├── CrosswindCalculator.cs     # Trigonometrie vânt pe pistele 08 (88.93°) / 26 (268.95°)
│   │   ├── SequenceGenerator.cs       # Generator permutări și optimizare întârziere minimă
│   │   ├── VfrGeofenceService.cs      # Tracking VFR pe punctele VFR-S, VFR-N, VFR-W
│   │   ├── VmcChecker.cs              # Validare condiții VMC/MVFR/IMC
│   │   └── TrajectorySeparation/      # Motor 4D traiectorii, Racetrack Holding & SafePlanningCoordinator
│   ├── Models/                        # Modele domeniu, RunwayConfiguration (08/26), SimulationMathModels
│   ├── GroundedExplainer.cs           # Integrare AI 4B local cu gardă deterministă anti-halucinații
│   └── data/                          # Baze de date JSON ROMATSA (romatsa-ifr-mock-db.json & vfr)
├── AERIS.Tests/                       # Suită de 15 teste unitare și de integrare (.NET 10)
├── frontend/                          # Consolă Radar ATC (React 19 + TypeScript + Vite 8 + Leaflet)
│   ├── src/components/                # TopBar, MapView (Radar Scope), DetailsPanel (Math UI), Timeline, AskAi
│   ├── src/sim/                       # Interpolare 4D, hipodrom ICAO (appendRacetrack), geomath, unități
│   ├── src/contracts/                 # Contracte TypeScript + scheme de validare strictă Zod
│   ├── src/api/                       # Client HTTP + port complet în mockBackend.ts pentru rulare offline
│   └── src/data/                      # Geometrie AIP România LRCV (lrcv-geo.json) + preseturi meteo
└── docs/
    └── DOCUMENTATIE_TEHNICA.md        # Documentația tehnică, matematică și operațională completă
```

---

## 🚀 Instalare și Pornire Rapidă

### Cerințe Preliminare
| Componentă | Versiune | Observații |
|---|---|---|
| **.NET SDK** | **10.0+** | Pentru `AERIS API` și `AERIS.Tests` |
| **Node.js** | **22.12+ / 24** | Pentru consola `frontend` (Vite 8 + React 19) |
| **LLM Local (Opțional)** | Orice model 4B (LM Studio / Ollama) | Pe `http://localhost:1234/v1/chat/completions` (are fallback determinist automat) |

### 1. Pornire Backend (`.NET 10 API`)
```powershell
cd "AERIS API"
dotnet run
```
- API-ul pornește pe **`http://localhost:5271`**
- Interfața **Swagger / OpenAPI** este disponibilă direct la **`http://localhost:5271/swagger`** (sau `http://localhost:5271/`).

### 2. Pornire Frontend (`React 19 Radar Scope`)
Într-un terminal nou:
```powershell
cd frontend
npm ci
npm run dev
```
- Deschide **`http://localhost:5173/#/demo`** pentru **Modul Demonstrativ Hackathon** (simulare matematică 4D interactivă, preseturi meteo, hipodrom de așteptare și analiză zbor).
- Deschide **`http://localhost:5173/#/live`** pentru **Modul Live** (trafic real OpenSky + METAR real `LRCV`).
- Pentru rulare **100% offline fără backend**, folosește:
  ```powershell
  npm run dev:mock
  ```

---

## 🧪 Rulare Teste Automate

Proiectul este acoperit de **64 de teste automate** (15 teste backend `.NET 10` + 49 teste frontend `Vitest`):

```powershell
# 1. Rularea suitei de teste Backend (.NET 10 — Separare 4D, Fizica Zborului, Predicție, VFR PNR)
dotnet run -c Release --project "AERIS.Tests/AERIS.Tests.csproj"

# 2. Rularea suitei de teste Frontend (Vitest — Contracte Zod, Simulare, Geometrie, Store)
cd frontend
npm test -- --run
```

---

## 📡 Referință Rapidă Endpoint-uri API

### Modulul Craiova (`LRCV`) & Baze de Date ROMATSA
| Metodă | Endpoint | Descriere |
|---|---|---|
| `GET` | `/api/craiova/simulation` | Simulare completă `LRCV` (parametri: `windSpeed`, `windDirection`, `windGust`, `visibility`, `forceSimulated`). |
| `POST` | `/api/craiova/evaluate` | Evaluare scenariu personalizat (vreme + listă aeronave) cu **Predicția Viitorului 4D**, **2 Pași Înainte**, **Takeoff-to-Landing** și **Decizie VFR**. |
| `GET` | `/api/craiova/alternates` | Clasamentul pistelor alternative (`PODARI`, `LRCW`, `SLATINA`) cu vânt lateral și timp de zbor. |
| `GET` | `/api/craiova/live-positions` | Poziții ADS-B reale în timp real din rețeaua OpenSky Network. |
| `GET` | `/api/craiova/vfr/tracking` | Geofencing VFR pe punctele `VFR-S`, `VFR-N`, `VFR-W` + verificare VMC. |
| `POST` | `/api/craiova/explain` | Traducere în limbaj natural (AI 4B / fallback determinist) a calculelor din scenariul Live sau Demo. |
| `GET` | `/api/craiova/romatsa/vfr` | Baza de date mock ROMATSA VFR (coridoare, aeronave ușoare, aerodromuri înierbate). |
| `GET` | `/api/craiova/romatsa/ifr` | Baza de date mock ROMATSA IFR (proceduri RNP/ILS, holding-uri, performanțe BADA, matrice siaj). |
| `GET` | `/api/craiova/romatsa/summary` | Sumar combinat al bazelor de date ROMATSA VFR & IFR. |

### Modulul Separare 4D & Planificare
| Metodă | Endpoint | Descriere |
|---|---|---|
| `POST` | `/api/separation/evaluate` | Evaluare 4D a separării traiectoriilor, detectare conflicte și auto-replanificare (`SafePlanningCoordinator`). |
| `GET` | `/api/separation/demo-conflict` | Scenariu demonstrativ cu conflict de turbulență de siaj / ocupare pistă și rezolvare automată. |
| `POST` | `/api/planning/evaluate` | Motor matematic de secvențiere a sloturilor de aterizare cu întârziere totală minimă. |
| `GET` | `/api/weather/metar/decoded` | METAR `LRCV` decodat din surse multiple cu categoria de zbor (`VFR`, `MVFR`, `IFR`, `LIFR`). |
| `GET` | `/api/weather/vmc-check` | Verificare detaliată a minimelor VMC conform SERA.5001 și calculul vântului pe pistele `08/26`. |
