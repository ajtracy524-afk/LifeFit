# LifeFit

Ernährung, Training und Einkauf in einem System: Onboarding → Ziel und Tagesziel → Woche planen → Einkaufsliste entsteht automatisch → Training und Essen mit einem Tap erfassen → Fortschritt sehen. Deutsch, Preise nur in CHF.

Was die App kann, steht in [FEATURES.md](FEATURES.md). Wie jede Onboarding-Angabe in der App wirkt (mit Test), steht in [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Starten

```bash
npm install
npm run dev        # http://localhost:5173 (im WLAN auch vom Handy erreichbar)
npm run typecheck  # TypeScript strict
npm test           # Domänen-, Store- und App-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/
```

## Architektur

```
src/
  domain/          Reine Geschäftslogik, ohne React (getestet)
    onboarding/      Antworten mit Quelle (Field<T>), Flow, Migration, „Dein Plan“, Vorher/Nachher,
                     Abbildung der Antworten auf Profil, Ernährung und Training
    body.ts, goal.ts Energiebedarf, Körperfett-Schätzungen, Zielempfehlung, Schutzregeln, Prognose
    nutrition.ts     Tagesziele (versioniert), Makros, Rezept-Nährwerte
    catalogTags.ts   Harte Ausschlüsse (Ernährungsform, 14 LMIV-Allergene, Unverträglichkeiten, Spuren)
    planner.ts       Wochenvorschlag, Portionen, Vorlieben (weich), Kochzeit, Meal-Prep
    week/            Woche als System: Wochenraster (zuhause / mitnehmen / auswärts / auslassen),
                     Kaskade bei Änderungen, Vorrat, Einkaufsliste, Tagesziele pro Tag
    training/        Plan-Generator (Split, Volumen, Frequenz, Zeit, Ausrüstung, Beschwerden)
    training.ts      Rotation, Progression, Rekorde, Volumen
    numberFree.ts    Zahlenfreier Modus (Portionen statt kcal)
    engine/          Adaptive Fitness Engine: Regeln, Guardrails, Empfehlungen (docs/ADAPTIVE_ENGINE.md)
    review/          Tagesrückblick, Trends, Auffälliges
  data/            Kuratierter Katalog: Lebensmittel (mit Tags), Rezepte, Übungen (mit Gelenkbelastung), Programme
  services/        Barcode (zxing-wasm, Kamera), Open Food Facts, FoodData Central – Netzwerk nur auf Nutzeraktion
  store/           Zustand (useSyncExternalStore), Aktionen, lokale Persistenz mit Migrationen
  components/      Wiederverwendbare UI (Button, Card, Sheet, Progress, Controls …)
  features/        Screens: onboarding, today, nutrition, training, shopping, progress, profile, plan
  lib/             Router (Hash), Formatierung, Toasts, Undo, Animationen
docs/              Onboarding-Plan und -Rückverfolgbarkeit, Katalog-Review, Engine
```

**Wie die Bereiche verbunden sind**

- Onboarding → `Field<T>` mit Quelle (`user`, `estimated`, `default`, `migrated`) → Profil, Tagesziel, Ernährungsprofil, Planer-Einstellungen, Trainingsplan. „Los geht’s“ erzeugt sofort den Wochenplan und damit die Einkaufsliste.
- Mahlzeit einplanen, tauschen oder entfernen → Einkaufsliste ändert sich automatisch (abgeleitet, kein Sync-Code).
- Wochenraster: auswärts heißt kein Rezept und kein Einkauf, nur ein reserviertes Budget. Mitnehmen heißt nur transportable Rezepte.
- Mahlzeit „Gegessen“ → Log-Eintrag mit Nährwert-Snapshot → Tagesring, Wochenstatistik, Einkaufs-Badge.
- Lebensmittel hinzufügen (Vorschlag, Suche, Barcode, manuell) → derselbe Log → Tagesbilanz. Mit Katalog-Zuordnung folgen auch Vorrat-Abzug und ein langsames Lernsignal für die nächste Planung.
- Vorrat (Checkliste, Scan, gekaufte Posten) → wird von der Einkaufsliste abgezogen. Nährwerte kommen aus Open Food Facts, Preise nie.
- Training abschließen → Volumen und Rekorde → Heute, Trainingsübersicht, Fortschritt.
- Gewicht eintragen → 7-Tage-Trend → Zielfortschritt und Prognose.
- Profil-Änderungen → Vorher/Nachher → neue Zielversion nur nach Bestätigung, mit Rückgängig. Alte Versionen bleiben unverändert.

**Bewusste Entscheidungen**

- Runtime-Abhängigkeiten sind nur React und `zxing-wasm`; Letzteres wird für den Kamera-Scan bei Bedarf nachgeladen. Router, Store, Icons und Chart sind bewusst klein selbst gebaut.
- Offline-first: Daten liegen lokal (`localStorage`), IDs werden clientseitig erzeugt. Damit ist die App bereit für einen späteren Server-Sync.
- Undo-Toasts statt Bestätigungsdialogen. Fehlergrenzen gibt es pro Screen. Beschädigte Daten werden gesichert statt verworfen.
- Schätzungen sind als Bereich oder als „geschätzt“ markiert. Standardwerte werden nie als Angaben der Person ausgegeben.
- Die App ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung. Schutzregeln (unter 18, Schwangerschaft, Untergewicht, Kaloriengrenze) gehen jeder Empfehlung vor.
