# Documentație tehnică — AERIS (`LRCV`)

Documentația aplicației AERIS (KWAD) pentru Aeroportul Internațional Craiova (`LRCV`). Descrie structura proiectului, calculele matematice din motorul de simulare, bazele de date JSON (IFR și VFR), verificarea separării 4D și interfața web.

---

## 1. Structura generală

Aplicația este împărțită în trei componente:
1. **`AERIS API/` (.NET 10 Web API):** face toate calculele de vânt, atmosferă, secvențiere a aterizărilor, predicție pe 45 de minute, analiză decolare-aterizare, redirecționare VFR, separare 4D a traiectoriilor și traducerea datelor în text prin modelul local de 4B parametri.
2. **`frontend/` (React 19 + TypeScript + Leaflet):** afișează harta radar pentru Craiova, benzile de zbor, cronologia și panourile cu rezultate matematice. Nu recalculează secvența de aterizare; afișează exact ce primește de la backend (sau din `mockBackend.ts` când rulează în modul mock).
3. **`AERIS.Tests/` (.NET 10):** testele automate pentru calculele fizice și motorul de separare a traiectoriilor.

```mermaid
flowchart LR
    subgraph Date["Surse de date"]
        OS["OpenSky Network (ADS-B)"]
        WX["METAR LRCV (3 surse)"]
        DB["JSON ROMATSA (IFR + VFR)"]
    end

    subgraph API["Backend (.NET 10)"]
        CALC["Crosswind & SequenceGenerator"]
        MATH["FlightPhysicsAndPredictionEngine"]
        SEP["TrajectorySeparationEngine"]
        AI["GroundedExplainer (AI 4B)"]
    end

    subgraph UI["Frontend (React + Leaflet)"]
        ZOD["Validare Zod"]
        MAP["MapView + Timeline"]
        PNL["DetailsPanel + AskAi"]
    end

    Date --> API
    CALC --> MATH --> SEP --> AI
    API --> ZOD --> MAP
    ZOD --> PNL
```

---

## 2. Datele aerodromului Craiova (`LRCV`) și bazele de date JSON

Geometria folosită în calcule provine din AIP România (AIRAC 2026-10-01):
- **ARP Craiova:** `44.318056° N, 23.888611° E`, elevație `626 ft` (`191 m`).
- **Pista `08/26` (`2500 m x 45 m`, asfalt):**
  - Pragul `08`: relevment adevărat `88.93°`, elevație `678 ft`.
  - Pragul `26`: relevment adevărat `268.95°`, elevație `669 ft` (echipată cu ILS Cat I și procedură RNP).
  - `RunwayConfiguration.cs` acceptă atât notația `08/26`, cât și notația mai veche `09/27`.

### Bazele de date mock ROMATSA (`AERIS API/data/`)
- **`romatsa-ifr-mock-db.json`:** conține regulile de separare din FIR București (`LRBB`), matricea ICAO pentru turbulența de siaj (`Heavy`, `Medium`, `Light`), procedurile instrumentale `ILS/RNP RWY 26` (`TITEK`, `PEMOK`, `PANZU` -> `OZZET` -> `CV508` -> `THR 26`) și `RNP RWY 08` (`NECCO` -> `CV408` -> `THR 08`), zonele de holding la `OZZET` și `NECCO`, parametrii de performanță pentru `A320-232`, `A321neo`, `ATR 72-600`, `B737-800`, `E190` și aeroporturile de rezervă IFR (`LROP`, `LRTR`, `LRSB`, `LBSF`).
- **`romatsa-vfr-mock-db.json`:** conține punctele de intrare VFR (`VFR-S` Dunăreni, `VFR-N` Șimnicu de Sus, `VFR-W` Breasta), plafoanele și vizibilitatea minimă VMC (SERA.5001), datele pentru avioanele ușoare (`ICP Savannah S`, `PZL-104 Wilga 35A`, `Cessna 172S`, `Diamond DA40`, `Tecnam P2008JC`) și pistele înierbate din jurul Craiovei (`PODARI`, `LRCW` Craiova-Sud/Balta Verde, `SLATINA`).

---

## 3. Calculele din motorul de simulare (`FlightPhysicsAndPredictionEngine.cs`)

### 3.1. Atmosfera ISA, altitudinea de densitate și viteza adevărată (TAS)
Temperatura standard la nivelul aerodromului ($h = 626\text{ ft}$):
$$T_{\text{ISA}}(h) = 15 - 0.0019812 \cdot h \approx 13.76^\circ\text{C}$$

Altitudinea barometrică ($\text{PA}$) și altitudinea de densitate ($\text{DA}$):
$$\text{PA} = h_{\text{elev}} + (1013.25 - \text{QNH}) \cdot 27.3$$
$$\text{DA} = \text{PA} + 118.8 \cdot (\text{OAT} - T_{\text{ISA}})$$

Din raportul de densitate $\sigma = \rho / \rho_0$ se calculează viteza adevărată ($\text{TAS}$) pornind de la viteza indicată ($\text{IAS}$):
$$\text{TAS} = \frac{\text{IAS}}{\sqrt{\sigma}}$$

### 3.2. Vântul la 2000 ft și 5000 ft (Hellmann + Ekman)
Vântul raportat la sol ($10\text{ m} \approx 33\text{ ft}$) crește cu altitudinea și își rotește direcția:
- **Viteza la înălțimea $h_{\text{AGL}}$:**
  $$V(h_{\text{AGL}}) = V_{\text{ref}} \cdot \left(\frac{\max(h_{\text{AGL}}, 33)}{33}\right)^\alpha$$
  unde $\alpha \in [0.14, 0.22]$ depinde de diferența dintre rafală și vântul mediu.
- **Rotația direcției vântului cu altitudinea:**
  $$\theta(h_{\text{AGL}}) = \left(\theta_{\text{sol}} + 18^\circ \cdot \left(1 - e^{-h_{\text{AGL}} / 2500}\right)\right) \bmod 360^\circ$$

### 3.3. Predicția pe 45 de minute (`T+0`, `T+5m`, `T+10m`, `T+15m`, `T+30m`, `T+45m`)
Pentru fiecare dintre cele 6 momente viitoare, `BuildFuturePrediction` estimează viteza vântului și a rafalelor, recalculează pista activă și vântul lateral, verifică dacă se deschide o fereastră sigură pentru VFR ($\text{crosswind} \le 12\text{ kt}$ și vizibilitate $\ge 5000\text{ m}$) și numără câte avioane mai sunt în aer sau în așteptare la acel minut.

### 3.4. Triunghiul vitezelor și unghiul de derivă (`WCA`)
Pentru un avion cu viteza adevărată $\text{TAS}$ pe drumul $\chi$ și vânt $V_w$ din direcția $\theta_w$:
$$\Delta\theta = \theta_w - \chi, \qquad V_{\text{xw}} = V_w \sin(\Delta\theta), \qquad V_{\text{hw}} = V_w \cos(\Delta\theta)$$
$$\text{WCA} = \arcsin\left(\frac{V_{\text{xw}}}{\text{TAS}}\right), \qquad \text{HDG} = (\chi + \text{WCA}) \bmod 360^\circ, \qquad \text{GS} = \text{TAS} \cos(\text{WCA}) - V_{\text{hw}}$$

### 3.5. Analiza de la decolare la aterizare (6 faze)
Funcția `BuildTakeoffToLandingAnalysis` împarte zborul în 6 segmente (`Takeoff`, `Cruise`, `Top of Descent`, `Initial Approach`, `Final Approach 3.0°`, `Landing Rollout`) și calculează:
- **Distanța până la Top of Descent ($\text{TOD}$):** $\approx 3.18\text{ NM}$ pentru fiecare $1000\text{ ft}$ de coborât, ajustată cu raportul $\text{GS}/\text{TAS}$.
- **Rata de coborâre pe panta de $3^\circ$ ($\text{ROD}$):**
  $$\text{ROD}_{\text{fpm}} = \text{GS}_{\text{app}} \cdot \frac{6076.12}{60} \cdot \tan(3^\circ) \approx 5.31 \cdot \text{GS}_{\text{app}}$$
- **Distanța de aterizare necesară ($\text{LDR}$):** ține cont de viteza față de sol la prag ($V_{\text{ref}} - V_{\text{hw}}$), de densitatea aerului ($1/\sigma$), de decelerația la frânare pe asfalt sau iarbă și de un factor de siguranță de $1.15$, raportând rezultatul la lungimea pistei ($2500\text{ m}$).

### 3.6. Predicția cu 2 pași înainte (`CurrentState` -> `StepOneAhead` -> `StepTwoAhead`)
Pentru fiecare aeronavă se calculează trei poziții legate de timpul planificat de aterizare ($t_{\text{target}}$):
1. **$T_0$ (`t_target - 540s`):** intrarea în zona Craiova ($12\text{–}15\text{ NM}$ de prag).
2. **Pasul +1 (`t_target - 210s`):** poziția intermediară (`OZZET` pe pista 26, `NECCO` pe pista 08, intrarea în așteptare la sud de pistă sau plecarea spre aerodromul de rezervă).
3. **Pasul +2 (`t_target`):** atingerea pragului pistei sau sosirea la aerodromul alternativ.

### 3.7. Decizia VFR: așteptare în orbită vs. redirecționare (`PNR` și scorul `0–100`)
Când un avion VFR nu poate ateriza pe Craiova din cauza vântului lateral:
1. **Point of No Return ($\text{PNR}$):**
   $$T_{\text{PNR}} = \frac{\left(T_{\text{combustibil}} - 30\text{ min rezervă} - T_{\text{zbor spre alternativă}}\right) \cdot \dot{m}_{\text{croazieră}}}{\dot{m}_{\text{holding}}}$$
   Deoarece în așteptare consumul este mai mic decât în croazieră ($\dot{m}_{\text{holding}} \approx 0.78 \cdot \dot{m}_{\text{croazieră}}$), avionul poate aștepta mai multe minute decât diferența brută de timp. Dacă $T_{\text{PNR}} < 12\text{ min}$, sistemul recomandă devierea imediată (`DivertImmediately`).
2. **Scorul pistelor apropiate ($0\text{–}100$):**
   Fiecare teren (`PODARI`, `LRCW` Craiova-Sud, `SLATINA`) primește un scor:
   $$S = 0.55 \cdot S_{\text{crosswind}} + 0.20 \cdot S_{\text{headwind}} + 0.15 \cdot S_{\text{distanță}} + 0.10 \cdot S_{\text{combustibil}}$$
   La vânt puternic din sud ($180^\circ$, $22\text{G}26\text{ kt}$), pe Craiova vântul lateral este $26\text{ kt}$, dar pe **Podari** (pista `02/20`, orientată $020^\circ/200^\circ$) vântul lateral scade la **$8.9\text{ kt}$**, motiv pentru care Podari iese pe primul loc.

---

## 4. Separarea 4D a traiectoriilor (`Services/TrajectorySeparation/`)

- **`TrajectoryPredictor.cs` și `RacetrackGenerator.cs`:** generează punctele $(x, y, z, t)$ din 5 în 5 secunde pe procedurile RNP și desenează așteptarea în hipodrom (viraj de rată 1 de $180^\circ$, latură outbound de $60\text{ s}$, viraj de $180^\circ$, latură inbound).
- **`TrajectorySeparationEngine.cs`:** verifică la fiecare pas de timp distanța orizontală și verticală între oricare două avioane ($3\text{ NM}$ / $1000\text{ ft}$ pentru IFR-IFR, $1.5\text{ NM}$ / $500\text{ ft}$ pentru IFR-VFR), timpii de turbulență de siaj pe pistă și ocuparea pistei.
- **`SafePlanningCoordinator.cs`:** dacă găsește un conflict, decalează automat slotul de aterizare sau urcă așteptarea cu $1000\text{ ft}$ până când traiectoriile nu se mai intersectează.

---

## 5. Modulul AI local (`GroundedExplainer.cs`)

Endpoint-ul `POST /api/craiova/explain` funcționează în doi pași:
1. Backendul construiește o listă de propoziții numerotate direct din rezultatele calculate (`decision`, `weather`, `future-prediction`, `two-steps-<id>`, `takeoff-landing-<id>`, `vfr-redir-<id>`).
2. Modelul local de 4B parametri (apelat pe `http://localhost:1234/v1/chat/completions`) primește întrebarea și alege doar ID-urile propozițiilor care răspund la întrebare. Dacă modelul local nu rulează, backendul returnează direct propozițiile relevante (`deterministic_fallback`). Astfel, textul afișat are mereu exact aceleași cifre ca restul interfeței.

---

## 6. Rutele API disponibile

| Rută | Metodă | Rol |
|---|---|---|
| `/api/craiova/evaluate` | `POST` | Evaluează vremea și lista de avioane trimise din Demo; returnează sloturile și toate calculele matematice. |
| `/api/craiova/simulation` | `GET` | Rulează simularea pentru parametrii meteo din query (`windSpeed`, `windDirection`, `windGust`, `visibility`). |
| `/api/craiova/alternates` | `GET` | Returnează calculele pentru `PODARI`, `LRCW` și `SLATINA`. |
| `/api/craiova/explain` | `POST` | Returnează explicația în limbaj natural pentru pagina Live sau pentru scenariul din Demo. |
| `/api/craiova/romatsa/vfr` | `GET` | Returnează conținutul `romatsa-vfr-mock-db.json`. |
| `/api/craiova/romatsa/ifr` | `GET` | Returnează conținutul `romatsa-ifr-mock-db.json`. |
| `/api/craiova/romatsa/summary` | `GET` | Sumar al datelor din cele două baze ROMATSA. |
| `/api/craiova/live-positions` | `GET` | Pozițiile reale ale avioanelor din OpenSky Network. |
| `/api/craiova/live-traffic` | `GET` | Traficul convertit în format de scenariu (`?forceSimulated=true` pentru datele de demo). |
| `/api/craiova/vfr/tracking` | `GET` | Urmărirea avioanelor VFR față de punctele `VFR-S`, `VFR-N`, `VFR-W`. |
| `/api/separation/evaluate` | `POST` | Evaluează separarea 4D și returnează varianta replanificată fără conflicte. |
| `/api/separation/demo-conflict` | `GET` | Scenariu de test cu conflict de siaj rezolvat automat. |
| `/api/planning/evaluate` | `POST` | Calculează variantele valide de secvențiere pentru o listă de avioane. |
| `/api/weather/metar/decoded` | `GET` | METAR-ul curent pentru `LRCV` decodat (cu cache de 5 minute). |
| `/api/weather/vmc-check` | `GET` | Verifică dacă vremea curentă permite zborul VFR (SERA.5001). |
