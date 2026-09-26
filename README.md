# LifeFit

Ernährung, Training und Einkauf in einem System: Ziel festlegen → Woche planen → Einkaufsliste entsteht automatisch → Training & Essen mit einem Tap tracken → Fortschritt sehen.

## Starten

```bash
npm install
npm run dev        # http://localhost:5173 (im WLAN auch vom Handy erreichbar)
npm test           # Domänen-Tests (Vitest)
npm run build      # Typecheck + Produktions-Build nach dist/
```

## Architektur

```
src/
  domain/        Reine Geschäftslogik, ohne React (getestet)
    nutrition.ts   Kalorien-/Makroberechnung, Rezept-Nährwerte, versionierte Ziele
    planner.ts     Wochenvorschlag, Portionsskalierung, Tausch-Alternativen
    shopping.ts    Einkaufsliste – wird aus dem Essensplan ABGELEITET
    training.ts    Trainingsplan-Rotation, Progression, Rekorde, Volumen
    progress.ts    Gewichtstrend, Zielfortschritt, Wochenstatistik
    engine/        Adaptive Fitness Engine: Regeln, Guardrails, Empfehlungen (siehe docs/ADAPTIVE_ENGINE.md)
  data/          Kuratierter Katalog: Lebensmittel, Rezepte, Übungen, Programme
  services/      Produktsuche per Barcode (Open Food Facts) – der einzige Netzwerkzugriff, nur auf Nutzeraktion
  store/         Zustand (useSyncExternalStore), Aktionen, lokale Persistenz
  components/    Wiederverwendbare UI (Button, Card, Sheet, Progress, Controls …)
  features/      Screens: onboarding, today, nutrition, training, shopping, progress, profile
  lib/           Router (Hash), Formatierung, Toasts, Undo
```

**Wie die Bereiche verbunden sind**

- Mahlzeit einplanen/tauschen/entfernen → Einkaufsliste ändert sich automatisch (abgeleitet, kein Sync-Code).
- Mahlzeit „Gegessen“ → Log-Eintrag mit Nährwert-Snapshot → Tagesring, Wochenstatistik, Einkaufs-Badge.
- Lebensmittel hinzufügen (Vorschlag, Suche, Barcode, manuell) → derselbe Log → Tagesbilanz; mit Katalog-Zuordnung auch Vorrat-Abzug und langsames Lernsignal für die nächste Planung.
- Gekauftes Produkt scannen → Vorrat (nie automatisch aus Gegessenem). Nährwerte aus Open Food Facts, Preise nie.
- Training abschließen → Volumen & Rekorde → Heute, Trainingsübersicht, Fortschritt.
- Gewicht eintragen → 7-Tage-Trend → Zielfortschritt & Prognose.

**Bewusste Entscheidungen**

- Keine Runtime-Abhängigkeiten außer React. Router, Store, Icons und Chart sind bewusst klein selbst gebaut.
- Offline-first: Daten liegen lokal (`localStorage`), IDs werden clientseitig erzeugt – bereit für späteren Server-Sync.
- Undo-Toasts statt Bestätigungsdialogen; Fehlergrenzen pro Screen; beschädigte Daten werden gesichert statt verworfen.
