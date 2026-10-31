# KWAD / AERIS - Air Traffic Management Planning & Sequencing Engine

AERIS este un motor de planificare, secvențiere și suport decizional pentru sosirile de aeronave (Arrival Management / Runway Sequencing & Decision Advisory), dezvoltat în .NET 10 (ASP.NET Core Web API).

---

## 🎯 Modulul Dedicat: Aeroportul Internațional Craiova (LRCV / CRA)
Sistemul integrează date în timp real din rețeaua **OpenSky Network** pentru spațiul aerian Craiova și calculează scenarii optime de aterizare pentru trafic mixt (comercial + aviație mică de agrement):

- **Integrare OpenSky Network API:** Preluare automată a zborurilor active din sectorul Craiova (bounding box Oltenia) cu fallback transparent pe simulare realistă a orarului regulat (Wizz Air A320/A321 din Londra Luton și Milano Bergamo).
- **Trafic mixt & Aviație de agrement:** Modele pentru aeronave mici fără instrumentație IFR avansată (ICP Savannah S, PZL-104 Wilga 35A, Cessna 172 Skyhawk).
- **Trigonometria Vântului Lateral (*Crosswind*):**
  - Calculul componentei de vânt lateral și de față pentru pista 08/26 (capete 082° / 262°).
  - Selectarea automată a pistei active pentru maximizarea componentei de vânt de față.
- **Reguli de Prioritizare:**
  - Aeronavele comerciale IFR au prioritate pe pistă și limite superioare de vânt lateral (32-35 kts).
  - Aeronavele mici de agrement (Savannah 11 kts, Wilga 13 kts) cedează prioritatea.
- **Sistem de Recomandări (*Decision Support Tool*):**
  - **Orbită de așteptare (*Holding Pattern*):** Recomandare de orbitare paralelă cu latura sudică a pistei (zona Cârcea - Pielești, 1500 ft QNH) până la eliberarea pistei sau scăderea vântului lateral.
  - **Deviere către aerodromuri alternative (*Alternates*):**
    - **Aerodromul Balta Verde Craiova (`LRBV`):** La 11.8 km (cap 245°), pistă înierbată 13/31 oferind reducere substanțială a vântului lateral.
    - **Aerodrom Podari (`PODARI`):** La 14.5 km (cap 225°), pistă dedicată ULM 02/20, aliniată aproape perfect cu vântul de sud.

---

## 🚀 Rulare și Testare

Interfața (React) e în `frontend/`; pașii de pornire și ce trebuie instalat (Node.js și .NET 10 SDK) sunt în [frontend/README.md](frontend/README.md).

### 1. Pornire API
```bash
cd "AERIS API"
dotnet run
```

### 2. Swagger UI
După pornire, deschideți în browser:
👉 **`http://localhost:5271/swagger`** *(sau direct `http://localhost:5271/`)*

### 3. Endpoint-uri Craiova:
- `GET /api/craiova/simulation?windSpeed=22&windDirection=180&windGust=26` - Simulare completă a aterizărilor pe Craiova cu vânt lateral critic, sfaturi de orbită și deviere.
- `GET /api/craiova/alternates?windSpeed=20&windDirection=180` - Calculul vântului lateral și timpilor de zbor către Balta Verde și Podari.
- `GET /api/craiova/live-traffic` - Colectare trafic live OpenSky Network.
- `POST /api/craiova/evaluate` - Evaluare scenariu meteo și trafic personalizat.

### 4. Endpoint-uri de Planificare Generală:
- `GET /api/planning/sample` - Scenariul de referință cu 4 aeronave.
- `POST /api/planning/evaluate` - Optimizare matematică sloturi sosire cu separare minimă.
