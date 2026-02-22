# ITS-MAS Quiz Static (GitHub Pages)

Diese Variante ist **komplett statisch** und fuer GitHub Pages gedacht.

- Kein laufender Node-/Express-Server noetig
- Keine persistente `npm start`-Session im Betrieb
- Fortschritt, Retry-Pool und Theme werden lokal im Browser gespeichert (`localStorage`)

## Stack

- Vite
- React + TypeScript

## Lokale Entwicklung

```bash
cd quiz_app_static
npm install
npm run dev
```

## Statischer Build

```bash
cd quiz_app_static
npm install
npm run build
```

Der Output liegt in `quiz_app_static/dist` und kann direkt statisch gehostet werden.

## GitHub Pages Deploy (empfohlen via Actions)

1. In GitHub unter `Settings -> Pages` als `Build and deployment` die Quelle `GitHub Actions` aktivieren.
2. Die Workflow-Datei `/.github/workflows/deploy-quiz-static.yml` verwenden.
3. Push auf `main` (oder manuell per `workflow_dispatch`) triggert den Deploy.

## Manuelles Deploy (Alternative)

Wenn du ohne Actions deployen willst:

1. `npm run build` in `quiz_app_static` ausfuehren.
2. Inhalt von `quiz_app_static/dist` in einen statischen Hosting-Branch (z. B. `gh-pages`) publizieren.

## Datenquelle

Fragen liegen in `quiz_app_static/src/data/questions.json`.
