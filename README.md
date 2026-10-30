# KWAD / AERIS - Air Traffic Management Planning & Sequencing Engine

AERIS este un motor de planificare și optimizare a secvențierii sosirilor de aeronave (Arrival Management / Runway Sequencing) dezvoltat în .NET 10 (ASP.NET Core Web API).

## Caracteristici Principale
- **Reguli de zbor mixte:** Suport pentru zboruri IFR (Instrument Flight Rules) și VFR (Visual Flight Rules).
- **Separare minimă:** Respectă distanțarea temporală minimă între sosiri consecutive pe pistă (*wake vortex separation*).
- **Ferestre de timp admise:** Respectă constrângerile de tip $[Earliest, Latest]$ pentru fiecare aeronavă.
- **Sloturi blocate (*Frozen Slots*):** Suport pentru sloturi orare fixe stabilite de controlorii de trafic aerian.
- **Optimizare & Ierarhizare:** Calculează automat toate combinațiile de inserare VFR, evaluează întârzierile și returnează cele mai bune variante clasificate după întârzierea totală și maximă.
- **Swagger / OpenAPI:** Interfață Swagger UI integrată pentru testare și documentare interactivă.

## Rulare și Testare

### 1. Pornire API
```bash
cd "AERIS API"
dotnet run
```

### 2. Swagger UI
După pornire, deschideți în browser:
```
http://localhost:5271/swagger
```

### 3. Endpoint-uri disponibile:
- `GET /api/planning/sample` - Evaluează instant scenariul demonstrativ predefinit.
- `POST /api/planning/evaluate` - Evaluează un scenariu personalizat transmis în corpul cererii (JSON).
