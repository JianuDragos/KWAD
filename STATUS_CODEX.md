# AERIS — Status Aplicație & Ghid pentru Codex

> **Data generării:** 31 Octombrie 2026  
> **Repository:** `JianuDragos/KWAD` (branch `main`)  
> **Locație proiect:** `c:\Users\tener\source\repos\aeris`  
> **Tehnologii cheie:** ASP.NET Core (.NET 10), React 19 + TypeScript + Vite 8, Leaflet, Zustand, llama.cpp / Phi-3.5-mini local.

---

## 1. Arhitectura Generală a Soluției

AERIS este un sistem inteligent de asistență pentru controlorii de trafic aerian (ATC) la Aeroportul Internațional Craiova (LRCV), format din 3 piloni independenți:

```
┌───────────────────────────────────────────────────────────────────┐
│                      FRONTEND (React 19 + Vite)                   │
│   - MapView (Leaflet + proceduri RNP / piste AIP LRCV 08/26)      │
│   - Dashboard ATC redesign (TopBar, DetailsPanel, Timeline)       │
│   - Zustand Store cu control revizie & scenariu                   │
└──────────────▲────────────────────────────────────▲───────────────┘
               │ (Proxy Vite /api -> 5271)          │ (Direct / viitor)
               ▼                                    │
┌──────────────────────────────────────────────┐    │
│            AERIS API (ASP.NET Core)          │    │
│   - Planning & Sequencing Engine             │    │
│   - Craiova Advisory Engine (vânt/orbite/div)│    │
│   - Weather Service (METAR live & decodat)   │    │
│   - OpenSky Live Positions (lat/lon/track/fl)│    │
│   - [Next] Integrare GroundedExplainer       │    │
└──────────────────────┬───────────────────────┘    │
                       │ HTTP (port 18090)          │
                       ▼                            ▼
┌───────────────────────────────────────────────────────────────────┐
│              LOCAL AI RUNTIME (AERIS-Backend-Handoff)             │
│   - llama.cpp server local (Phi-3.5-mini-instruct Q4_K_M ~2.2 GB) │
│   - Rulează independent la http://127.0.0.1:18090/                │
│   - Grounded Explainer: selectează doar enunțuri aprobate de ATC  │
└───────────────────────────────────────────────────────────────────┘
```

---

## 2. Componente & Stare Curentă

### A. Backend (`AERIS API/`) — .NET 10.0
- **Status:** Compilat curat (`0 Errors, 0 Warnings`), rulează pe portul HTTP `http://localhost:5271`.
- **Controllers & Servicii:**
  1. **`WeatherController`** (NOU):
     - `GET /api/weather/metar` — String METAR brut direct de la `aviationweather.gov`.
     - `GET /api/weather/metar/decoded` — Date meteo decodate complet în română: vânt (grade, kts, direcție cardinală), componente crosswind pe pista 09/27, plafon nori/straturi, vizibilitate, temperatură, rouă, umiditate (Magnus), QNH, categorie zbor (`VFR`/`MVFR`/`IFR`/`LIFR`), rezumat operațional și prompt AI structurat (`aiContextPrompt`).
  2. **`CraiovaController`**:
     - `GET /api/craiova/live-positions` (NOU): Poziții GPS în timp real din OpenSky Network (lat/lon, altitudine barometrică/geometrică, FL aproximat, viteză noduri, track, rată verticală, distanță Haversine și azimut față de LRCV).
     - `GET /api/craiova/live-traffic` (LEGACY PRESERVAT): Trafic blenduit (IFR + VFR mici Savannah/Wilga) pentru motorul de simulare.
     - `GET /api/craiova/simulation`: Simulare completă de aterizare și deconflictualizare.
     - `POST /api/craiova/evaluate`: Evaluare scenariu custom.
     - `GET /api/craiova/alternates`: Aerodromuri alternative din Oltenia (Balta Verde / Podari) calculate matematic în funcție de vânt.
  3. **`PlanningController`**:
     - `GET /api/planning/sample`: Scenariu demonstrativ planning.
     - `POST /api/planning/evaluate`: Evaluare matematică sloturi de aterizare.

### B. Frontend (`frontend/`) — React 19 + TypeScript + Vite 8
- **Status:** Ultima versiune a echipei (`5d6b475` - Redesign ATC dashboard) integrată pe `main`.
- **Capabilități:**
  - Hartă Leaflet offline-ready cu CTR 20 NM, pista 08/26, rute RNP AIRAC.
  - Generare traiectorii sintetice sincronizate cu sloturile primite de la backend.
  - Timeline interactiv cu sloturi, ETA și scrubber temporal.
  - Panou de control ATC cu situația zborurilor și detaliile fiecărei aeronave selectate.
  - Client API pregătit cu suport Mock (`npm run dev:mock`) și Live Backend (`npm run dev`).

### C. Local AI Module (`AERIS-Backend-Handoff/`) — Livrat de colegul AI
- **Status:** Pregătit pentru conectare în `AERIS API`.
- **Model:** Phi-3.5-mini-instruct (GGUF Q4_K_M, 3.8B parametri, context 4k).
- **Arhitectură de siguranță (Grounded Selection):**
  - Modelul **nu** halucinează comenzi ATC libere.
  - Backend-ul îi furnizează un set de `ApprovedStatement` (decizia motorului, meteo, limitări de simulare).
  - LLM-ul doar selectează enunțurile autorizate relevante pentru întrebarea pusă, cu fallback determinist în caz de eroare/timeout.
- **Fișiere cheie:**
  - `backend/GroundedExplainer.cs` — Client C# .NET 8 (zero dependențe NuGet).
  - `Start-LLM.ps1` / `Stop-LLM.ps1` / `Test-LLM.ps1` — Management runtime local pe `http://127.0.0.1:18090`.
  - `BACKEND-INTEGRATION.md` — Instrucțiuni clare de conectare.

---

## 3. Ghid de Rulare Locală (Quickstart)

### Terminal 1: Local LLM (opțional, când se folosește AI)
```powershell
cd "c:\Users\tener\source\repos\aeris\AERIS-Backend-Handoff"
.\Start-LLM.ps1
# Verificare: .\Test-LLM.ps1
```

### Terminal 2: Backend (AERIS API)
```powershell
cd "c:\Users\tener\source\repos\aeris\AERIS API"
dotnet run --launch-profile http
# Ascultă la: http://localhost:5271 (Swagger UI disponibil la /)
```

### Terminal 3: Frontend (React)
```powershell
cd "c:\Users\tener\source\repos\aeris\frontend"
npm install    # dacă nu a fost deja rulat
npm run dev    # rulează cu backend pe http://localhost:5271
# Sau npm run dev:mock (fără backend)
```

---

## 4. Ce Urmează (Roadmap Imediat pentru Codex)

1. **Integrare `GroundedExplainer.cs` în `AERIS API`:**
   - Adăugare fișier `GroundedExplainer.cs` în proiectul backend.
   - Înregistrare `AddHttpClient<GroundedExplainer>` în `Program.cs` pe portul `18090`.
   - Expunere endpoint nou: `POST /api/craiova/explain` care preia datele din evaluarea curentă + METAR decodat și returnează explicația auditată pentru ATC.
2. **Conectare Frontend la noile Endpoint-uri:**
   - Adăugare apel `GET /api/weather/metar/decoded` în UI-ul frontend-ului pentru afișarea vremii reale din Craiova în widgetul dedicat.
   - Afișare răspuns AI din noul endpoint în panoul de detalii.
3. **Consolidare CORS & Profiluri Dev:**
   - Validare proxy Vite `/api` către portul 5271 pentru funcționare fără erori cross-origin.
