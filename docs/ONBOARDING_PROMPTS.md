# LifeFit – Claude-Code-Prompts: Onboarding

Diese Datei enthält eine Prompt-Serie, mit der Claude Code das Onboarding von LifeFit Schritt für Schritt neu aufbaut.

## So verwendest du die Prompts

1. **Ein Prompt pro Session.** Kopiere immer nur einen Prompt in Claude Code. Danach `/clear`, bevor der nächste kommt.
2. **Reihenfolge einhalten.** Prompt 0 analysiert nur und schreibt `docs/ONBOARDING_PLAN.md`. Alle späteren Prompts bauen auf diesem Plan auf.
3. **Plan-Modus nutzen.** Starte jeden Prompt im Plan-Modus (Shift+Tab). Lies den Plan von Claude Code, korrigiere ihn bei Bedarf und lass ihn erst dann umsetzen.
4. **Nach jedem Prompt prüfen:** `npm run typecheck && npm test`, dann im Browser und auf dem Handy durchklicken und committen.
5. **Offene Fragen beantworten.** Prompt 0 endet mit Fragen an dich. Trag die Antworten in `docs/ONBOARDING_PLAN.md` ein, bevor du weitermachst.

---

## Überarbeitetes Konzept

Deine Grundidee bleibt: drei Bereiche (Körper & Ziel → Essen & Einkauf → Training), alles optional, die App leitet daraus wissenschaftlich begründete Empfehlungen ab, und der Nutzer hat das letzte Wort. Ergänzt und geändert habe ich Folgendes:

| Deine Idee | Verbesserung | Warum |
|---|---|---|
| Alter | **Geburtsjahr** statt Alter | Das Alter bleibt automatisch aktuell. |
| – | **Alltagsaktivität** (Beruf, Schritte) | Ohne sie ist der Kalorienbedarf oft um 300–600 kcal falsch. |
| BMI anzeigen, dann relativieren | BMI **plus Taille-zu-Größe-Verhältnis** (WHtR) | WHtR sagt mehr über Bauchfett aus als der BMI und braucht nur eine Schnur. |
| Körperfett schätzen ohne Utensil | **Vier Wege nach Genauigkeit:** Wert bekannt → Massband (Navy-Methode) → nur Taille (RFM) → visueller Vergleich | Ganz ohne Hilfsmittel geht nur der visuelle Vergleich (±5 %). Ein Massband für 2 CHF macht die Schätzung deutlich genauer. Der Nutzer wählt. |
| – | **FFMI** (fettfreie-Masse-Index) | Zeigt, wie viel Muskelmasse jemand hat. Damit wird die Erfahrungsstufe objektiv einschätzbar. |
| Ziele: Fett verlieren, Fett verlieren + Muskelaufbau | Ziele: **Fett verlieren, Recomposition, Muskelaufbau, Halten & Gesundheit**, dazu ein wählbares **Tempo** | „Fett verlieren + Muskeln aufbauen“ gleichzeitig heißt Recomposition. Das ist vor allem für Anfänger und Wiedereinsteiger realistisch. |
| – | **Sicherheitsgrenzen** (unter 18, Schwangerschaft, Untergewicht) | Keine Defizit-Empfehlungen, wo sie schaden können. |
| Vorlieben Protein/Carbs/Fette | **Drei Stufen:** mag ich / egal / mag ich nicht | „Mag ich nicht“ ist für den Planer genauso wichtig wie „mag ich“. |
| Allergien, vegan | **Harte Ausschlüsse** (Allergene nach LMIV, Ernährungsform) getrennt von **weichen Vorlieben** | Allergene dürfen *nie* im Plan auftauchen, Vorlieben nur gewichten. |
| – | Mahlzeiten pro Tag, Kochzeit, Meal-Prep, Haushaltsgröße, Budget | Das bestimmt Rezepte und Einkaufsmengen stärker als Geschmack. |
| Auswärts-Wochenraster | Pro Slot: **Zuhause / Mitnehmen / Auswärts / Auslassen** | „Mitnehmen“ wird geplant und eingekauft, „Auswärts“ reserviert nur ein Kalorienbudget. Protein wird auf die Mahlzeiten zu Hause verschoben. |
| Produkte scannen | Zuerst eine **Grundvorrat-Checkliste**, danach Scannen im Serienmodus | Öl, Salz, Reis abzuhaken geht schneller als 30 Barcodes zu scannen. |
| Erfahrung aus Jahren + Muskelmasse | Dazu **„aktuell pausiert?“** und optional aktuelle Arbeitsgewichte | Wiedereinsteiger bauen schneller auf. Arbeitsgewichte liefern Startwerte für die Progression. |
| Cardio ja/nein | Cardio-Optionen **mit Empfehlung je Ziel** (Schrittziel, Zone 2, HIIT) | Fettabbau entsteht primär durchs Kaloriendefizit. Ausdauertraining senkt nachweislich viszerales Fett und verbessert die Herzgesundheit. |
| Trainingsplan je Level | Zusätzlich **Tage, Dauer, Equipment, Beschwerden** | Ohne diese Angaben passt kein Plan in den Alltag. |
| – | **Herkunft jedes Werts** (eingegeben / geschätzt / Standard) | Die App weiß, was nur angenommen ist, und kann später gezielt nachfragen. |
| „Eingaben müssen berücksichtigt werden!!!!“ | **Rückverfolgbarkeits-Prüfung** am Ende: jede Eingabe → wo sie wirkt, mit Tests | So ist garantiert, dass keine Eingabe ins Leere läuft. |

---

## Prompt 0 – Analyse & Plan (kein Code)

```text
Du arbeitest am Projekt LifeFit: React 19, Vite, TypeScript strict, Vitest, offline-first mit localStorage, keine Runtime-Abhängigkeiten außer React und zxing-wasm.

Wir bauen das Onboarding komplett neu. In dieser Session schreibst du KEINEN Produktivcode. Deine Aufgabe ist Analyse und Planung.

1. Lies README.md, FEATURES.md, docs/ADAPTIVE_ENGINE.md und den gesamten Code unter src/features/onboarding, src/store, src/domain (nutrition, planner, shopping, training, progress, engine), src/data, src/services und src/components.

2. Erstelle docs/ONBOARDING_PLAN.md mit diesen Abschnitten:

   a) Ist-Zustand: Welche Onboarding-Schritte gibt es? Welche Daten werden gespeichert (Typen, Store-Keys)? Wo im Code werden sie verwendet?

   b) Lücken: Was fehlt für das neue Konzept (unten)? Prüfe insbesondere:
      - Hat der Lebensmittel-/Rezeptkatalog Tags für Allergene (14 Hauptallergene nach LMIV), Ernährungsform (vegan, vegetarisch, pescetarisch), Kategorie (Protein/Kohlenhydrate/Fette), Kochzeit, Meal-Prep-Eignung, Transportfähigkeit?
      - Hat der Übungskatalog Tags für Equipment, Muskelgruppen (primär/sekundär), Belastung von Gelenken (Schulter, Knie, Rücken, Handgelenk) und Alternativen?
      - Welche Parameter nimmt der Planer heute entgegen, welche fehlen?
      - Wie funktionieren Vorrat und Barcode-Scan heute?

   c) Datenmodell-Vorschlag für ein OnboardingProfile. Jedes Feld ist optional und wird mit seiner Herkunft gespeichert: { value, source: 'user' | 'estimated' | 'default', updatedAt }. Dazu eine Migration bestehender localStorage-Daten (Versionsnummer, keine Datenverluste, beschädigte Daten sichern wie bisher).

   d) Integrationspunkte: Für jede Eingabe aus dem Konzept genau benennen, welche Funktion in domain/ sie konsumieren wird.

   e) Umsetzungsreihenfolge passend zu den Prompts 1–9 (siehe Konzept), mit Risiken.

   f) Grundregeln (übernimm diese wörtlich, sie gelten für alle folgenden Sessions):
      - Jeder Schritt ist optional. „Überspringen“ ist immer sichtbar. Ohne Eingabe gelten sinnvolle Standardwerte, und die App ist auch ganz ohne Onboarding benutzbar.
      - Fachlogik liegt rein und ohne React in src/domain und ist mit Vitest getestet. Die UI zeigt nur an.
      - Alle Schwellenwerte, Faktoren und Formeln stehen zentral in einer Konstanten-Datei, jeweils mit Quellenkommentar.
      - Jeder Schritt hat eine einzeilige Erklärung „Warum fragen wir das?“. Ergebnisse haben ein „Warum?“-Sheet mit Formel und Quelle.
      - Die Sprache ist neutral, wertschätzend und nie beschämend. Keine Wertungen wie „zu dick“. Ergebnisse werden als Bereich statt mit Scheingenauigkeit gezeigt.
      - Mobile-first, barrierearm (Labels, Fokusführung, Touch-Ziele ≥ 44 px), Hell- und Dunkelmodus, bestehende Komponenten wiederverwenden.
      - Keine neuen Runtime-Abhängigkeiten. Netzwerk nur für Open Food Facts und nur auf Nutzeraktion.
      - Der Fortschritt wird nach jedem Schritt gespeichert. Abbrechen und Fortsetzen ist möglich. Jeder Bereich lässt sich später im Profil erneut öffnen.
      - Bestehende Konventionen übernehmen: Rechtschreibung (ß oder ss, wie im Projekt), Undo-Toasts statt Dialogen, Fehlergrenzen pro Screen.
      - Kein medizinischer Rat. Hinweis im Zusammenfassungs-Screen.
      - Nach jeder Session sind npm run typecheck und npm test grün.

3. Liste am Ende offene Fragen an mich auf, statt Annahmen zu treffen.

KONZEPT (Zielbild):

Einstieg: Willkommen-Screen mit Wahl „Schnellstart (ca. 1 Minute)“ oder „Ausführlich (ca. 5 Minuten)“. Der Schnellstart fragt nur Gewicht, Größe, Geburtsjahr, Geschlecht, Ziel und Trainingstage. Alles andere bekommt Standardwerte und kann später ergänzt werden.

Bereich A – Körper & Ziel:
Gewicht, Größe, Geburtsjahr, Geschlecht (männlich/weiblich/keine Angabe), Kraftsport-Erfahrung in Jahren plus „aktuell pausiert?“, Alltagsaktivität, optional Taillenumfang. Danach ein Analyse-Screen mit BMI und WHtR, der sofort erklärt, warum der BMI bei Kraftsportlern wenig aussagt. Dann die Körperfett-Schätzung (vier Methoden). Daraus FFMI, Grundumsatz und Gesamtumsatz. Am Ende eine wissenschaftlich begründete Zielempfehlung (Fett verlieren / Recomposition / Muskelaufbau / Halten & Gesundheit) mit Tempo, Kalorien und Makros. Der Nutzer kann alles ändern. Sicherheitsgrenzen gelten für unter 18, Schwangerschaft/Stillzeit und Untergewicht.

Bereich B – Essen & Einkauf:
Ernährungsform, Allergene und Unverträglichkeiten (harte Ausschlüsse), Vorlieben pro Kategorie Protein/Kohlenhydrate/Fette in drei Stufen, Mahlzeiten pro Tag, Kochzeit, Meal-Prep, Haushaltsgröße, Budget. Wochenraster Tage × Mahlzeiten mit Zuhause/Mitnehmen/Auswärts/Auslassen. Vorrat: Grundvorrat-Checkliste plus Barcode-Scan im Serienmodus.

Bereich C – Training:
Erfahrungsstufe (geschätzt aus Jahren, Pause und FFMI, überschreibbar), optional aktuelle Arbeitsgewichte, Trainingstage und Wochentage, Dauer pro Einheit, Equipment, Beschwerden, Cardio-Option mit Empfehlung je Ziel, bis zu zwei Fokus-Muskelgruppen. Danach ein empfohlener Split als Wochenübersicht, den der Nutzer anpassen und bestätigen kann.

Abschluss: Zusammenfassung „Dein Plan“, danach werden die erste Woche und die Einkaufsliste sofort erzeugt. Eine Rückverfolgbarkeits-Prüfung stellt sicher, dass jede Eingabe tatsächlich wirkt.
```

---

## Prompt 1 – Grundgerüst: Flow, Datenmodell, Fortsetzen

```text
Lies zuerst docs/ONBOARDING_PLAN.md, insbesondere die Grundregeln, und halte dich daran.

Aufgabe: Baue das technische Grundgerüst des neuen Onboardings. Die Inhalte der einzelnen Schritte kommen in späteren Sessions. Heute reichen Platzhalter-Schritte.

Umfang:
1. Datenmodell: Lege OnboardingProfile laut Plan an (jedes Feld optional, mit source und updatedAt), dazu die Store-Aktionen und die Migration inklusive Versionsnummer. Bestehende Nutzerdaten bleiben vollständig erhalten.

2. Flow-Logik als reine Funktion in src/domain (z. B. onboarding/flow.ts):
   - Bereiche: welcome → A (Körper & Ziel) → B (Essen & Einkauf) → C (Training) → summary
   - Schnellstart-Pfad vs. ausführlicher Pfad: Die Schrittliste hängt vom Modus ab
   - Schritte können bedingt sein (z. B. Schwangerschaftsfrage nur bei „weiblich“ oder „keine Angabe“)
   - next / back / skipStep / skipSection / jumpTo
   - Der Fortschritt wird pro Bereich berechnet

3. UI-Gerüst:
   - Kopfzeile mit Fortschritt in drei Segmenten (A/B/C) und Zurück-Button
   - Fußzeile mit „Weiter“ (primär) und „Überspringen“ (sekundär, immer sichtbar)
   - Zeile „Warum fragen wir das?“ unter jedem Titel
   - Übergänge zwischen Schritten, die prefers-reduced-motion respektieren
   - Wiedereinstieg: Wer die App mitten im Onboarding schließt, landet beim nächsten Start am selben Schritt, mit Option „Später fortsetzen“

4. Einstiegspunkte: Im Profil kann jeder Bereich (A/B/C) einzeln erneut geöffnet werden. Die vorhandenen Werte sind dann vorausgefüllt.

5. Tests für die Flow-Logik (alle Pfade, bedingte Schritte, Überspringen, Fortsetzen) und für die Migration (alte Daten → neues Modell, beschädigte Daten).

Erfolgreich, wenn: Man das Onboarding mit Platzhaltern komplett durchklicken, abbrechen, fortsetzen und jeden Bereich aus dem Profil erneut öffnen kann. Typecheck und Tests sind grün.
```

---

## Prompt 2 – Bereich A: Körperdaten, Analyse & Körperfett

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Ersetze die Platzhalter in Bereich A, Schritte „Körperdaten“, „Analyse“ und „Körperfett“.

TEIL 1 – Eingaben (ein Thema pro Screen, große Zahleneingaben mit +/- Steppern):
- Gewicht in kg, eine Nachkommastelle, plausibel 30–300
- Größe in cm, plausibel 120–230
- Geburtsjahr (daraus das Alter)
- Geschlecht: männlich / weiblich / keine Angabe. Hinweis: „Die Formeln für den Energiebedarf unterscheiden nach biologischem Geschlecht. Ohne Angabe rechnen wir mit einem Mittelwert.“
- Kraftsport-Erfahrung: nie / unter 1 Jahr / 1–2 Jahre / 3–5 Jahre / über 5 Jahre, dazu der Schalter „Ich pausiere gerade (länger als 3 Monate)“
- Alltagsaktivität, vier Stufen mit Beispielen: überwiegend sitzend (< 5'000 Schritte) / leicht aktiv (5'000–8'000) / aktiv (8'000–12'000, stehender Beruf) / sehr aktiv (körperliche Arbeit, > 12'000)
- Optional: Taillenumfang in cm (auf Bauchnabelhöhe, ausgeatmet)
Unplausible Werte zeigen einen freundlichen Hinweis, blockieren aber nichts Optionales.

TEIL 2 – Analyse-Screen (reine Funktionen in src/domain/body.ts oder passend zum Plan):
- BMI = kg / m², mit WHO-Kategorie in neutraler Sprache
- Sofort darunter eine Karte: „Der BMI unterscheidet nicht zwischen Muskeln und Fett. Wer Kraftsport macht, wird oft als ‚übergewichtig‘ eingestuft, obwohl der Körperfettanteil niedrig ist. Aussagekräftiger ist dein Körperfettanteil.“ Die Karte wird hervorgehoben, wenn die Erfahrung ≥ 1 Jahr ist oder der BMI ≥ 25.
- Wenn die Taille bekannt ist: WHtR = Taille / Größe, Richtwert < 0,5. Ohne Taille: Hinweis auf den Schnur-Trick (siehe Teil 3).
- Button „Körperfett ergänzen (empfohlen)“ führt zu Teil 3, „Überspringen“ ist möglich.

TEIL 3 – Körperfett-Schätzung. Vier Methoden, nach Genauigkeit sortiert, jeweils mit Genauigkeitsangabe:
  a) „Ich kenne meinen Wert“ (Körperfettwaage, DEXA, Caliper): direkte Eingabe
  b) „Massband“ – US-Navy-Methode (±3–4 %), metrisch in cm:
     Männer: KFA = 495 / (1.0324 − 0.19077·log10(Taille − Hals) + 0.15456·log10(Größe)) − 450
     Frauen: KFA = 495 / (1.29579 − 0.35004·log10(Taille + Hüfte − Hals) + 0.22100·log10(Größe)) − 450
     Mit kurzer Messanleitung: Hals unterhalb des Kehlkopfs, Taille auf Bauchnabelhöhe (Männer) bzw. an der schmalsten Stelle (Frauen), Hüfte an der breitesten Stelle
  c) „Nur Taille“ – Relative Fat Mass (Woolcott & Bergman 2018):
     Männer: RFM = 64 − 20 · (Größe / Taille), Frauen: RFM = 76 − 20 · (Größe / Taille)
  d) „Ohne Hilfsmittel“ – visueller Vergleich (±5 %): geschlechtsspezifische Bereiche (z. B. Männer 8–10, 11–14, 15–19, 20–24, 25–30, > 30 %), jeweils mit einer selbst gezeichneten, neutralen SVG-Silhouette und Merkmalen in Worten (z. B. „Bauchmuskeln bei Licht sichtbar“, „leichter Bauchansatz, Konturen weich“). Keine externen oder fremden Bilder.
  Dazu der Schnur-Trick ohne Massband als Tipp: „Schneide eine Schnur in deiner Körpergröße ab und falte sie in der Mitte. Passt sie um deine Taille, liegt dein WHtR unter 0,5.“
  Empfehlung im UI: b) ist die beste Methode ohne Gerät, d) wenn gar nichts zur Hand ist.
  Bei keiner Angabe für Geschlecht: Mittelwert beider Formeln, Ergebnis als Bereich.
  Ergebnisse immer gerundet und mit Bereich anzeigen (z. B. „ca. 16 % (14–18 %)“). Die Methode wird als source gespeichert.

TEIL 4 – Abgeleitete Werte (rein, getestet):
- Fettfreie Masse FFM = Gewicht · (1 − KFA)
- FFMI = FFM / m², normalisiert: FFMI + 6.1 · (1.8 − Größe in m). Einordnung geschlechtsspezifisch, Schwellen in der Konstanten-Datei.
- Grundumsatz:
  Ohne KFA: Mifflin-St Jeor: 10·kg + 6.25·cm − 5·Alter + 5 (m) bzw. − 161 (w), bei „keine Angabe“ −78
  Mit KFA aus Methode a) oder b): Katch-McArdle: 370 + 21.6 · FFM
  Mit KFA aus c) oder d): Mittelwert beider Formeln
- Gesamtumsatz = Grundumsatz · Alltagsfaktor (1.2 / 1.375 / 1.5 / 1.65) + Trainingsaufschlag aus den geplanten Einheiten. Doppelzählung vermeiden, Aufteilung dokumentieren.
- In der UI als „Startwert“ kennzeichnen: „Wir passen ihn anhand deines Gewichtsverlaufs automatisch an.“ Prüfe, ob die bestehende Engine (docs/ADAPTIVE_ENGINE.md) diesen Startwert sauber übernimmt.

Tests mit Referenzwerten, u. a.:
- Mann, 80 kg, 180 cm, 30 Jahre: BMI ≈ 24.7, Mifflin = 1780 kcal
- Navy- und RFM-Formeln gegen veröffentlichte Beispielwerte
- Grenzfälle: fehlende Werte, „keine Angabe“, Extremwerte
```

---

## Prompt 3 – Bereich A: Zielempfehlung, Tempo, Kalorien & Makros

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Baue in Bereich A die Schritte „Gesundheit“ und „Ziel“.

TEIL 1 – Optionaler Gesundheits-Check (vor der Zielempfehlung):
- „Bist du schwanger oder stillst du?“ (nur bei weiblich oder keine Angabe)
- Bei Alter < 18: keine Frage, Regel greift automatisch
- „Möchtest du lieber ohne Kalorienzahlen arbeiten?“ → zahlenfreier Modus: Die App zeigt Portionen und Fortschrittsringe statt kcal-Zahlen. Das ist eine Einstellung, keine Diagnosefrage.
Alles optional. Kurzer Hinweis, dass die App keinen ärztlichen Rat ersetzt.

TEIL 2 – Zielempfehlung (reine Funktion recommendGoal, Schwellen in der Konstanten-Datei):
Ziele: Fett verlieren / Recomposition (Fett verlieren und Muskeln aufbauen) / Muskelaufbau (Lean Bulk) / Halten & Gesundheit.
Entscheidungslogik als Ausgangspunkt (bitte gegen die Literatur prüfen und mit Quellen kommentieren):
- KFA hoch (Männer ≥ 25 %, Frauen ≥ 33 %) → Fett verlieren; Recomposition als Alternative für Anfänger
- KFA mittel (Männer 15–25 %, Frauen 23–33 %) → Anfänger und Wiedereinsteiger: Recomposition; Fortgeschrittene: Fett verlieren, danach Aufbau
- KFA niedrig (Männer < 15 %, Frauen < 23 %) → Muskelaufbau
- Ohne KFA: Ersatz über WHtR/RFM, sonst BMI plus Erfahrung, mit sichtbar niedrigerer Sicherheit und Hinweis „Mit Körperfettangabe wird die Empfehlung genauer“
Ausgabe: { recommended, alternatives, reasons[], confidence: 'hoch' | 'mittel' | 'niedrig' }

Sicherheitsgrenzen (Guardrails, mit der bestehenden Engine abstimmen):
- Unter 18, schwanger oder stillend → kein Kaloriendefizit, Empfehlung „Halten & Gesundheit“ mit Training
- BMI < 18.5 oder KFA sehr niedrig (Männer < 8 %, Frauen < 15 %) → „Fett verlieren“ wird nicht angeboten, mit freundlicher Erklärung
- Kalorienziel nie unter dem Grundumsatz und nie unter 1'200 (w) bzw. 1'500 (m) kcal; Defizit maximal 25 % des Gesamtumsatzes

UI: Die Empfehlung ist groß mit „Warum?“ dargestellt, die Alternativen sind als Karten wählbar. Wählt der Nutzer eine Alternative, wird das respektiert und nur kurz eingeordnet, ohne Bevormundung.

TEIL 3 – Tempo und Ziel:
- Fett verlieren: sanft 0,5 % / normal 0,75 % / zügig 1 % des Körpergewichts pro Woche
- Muskelaufbau: Anfänger ca. +0,25–0,5 %/Woche, Fortgeschrittene ca. +0,1–0,25 %/Woche
- Recomposition: Erhaltung bis −10 %
- Optional ein Zielgewicht oder Ziel-KFA, daraus eine Prognose als Zeitraum („ca. Mitte März bis Ende April“), keine exakte Zahl

TEIL 4 – Kalorien & Makros (rein, getestet):
- Kalorien aus Gesamtumsatz und Tempo (≈ 7'700 kcal pro kg Fett als Näherung, dokumentiert)
- Protein 1,6–2,2 g/kg; im Defizit oberer Bereich; bei hohem KFA auf Basis der fettfreien Masse bzw. des Zielgewichts statt des aktuellen Gewichts
- Fett ≥ 0,8 g/kg und ≥ 20 % der Kalorien
- Kohlenhydrate: Rest
- Speichern als neue Zielversion über die bestehende versionierte Ziel-Logik in nutrition.ts

Tests: Entscheidungstabelle (alle Kombinationen), jede Guardrail, Makro-Summen ergeben die Kalorien, Prognose plausibel.
```

---

## Prompt 3b – Katalog taggen & Review

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln, Entscheidungen).

Diese Session hat zwei Phasen. Phase 2 beginnt erst, wenn ich ausdrücklich „Freigabe“ schreibe.

PHASE 1 – Vorschlag (nur docs/, kein Produktivcode):
Erstelle docs/CATALOG_TAGS_REVIEW.md mit drei Tabellen und je einer Spalte „unsicher“ samt Begründung.

1. Lebensmittel (alle bestehenden plus neue Grundvorrat-Einträge wie Salz und Pfeffer, als „neu“ markiert):
   - die 14 LMIV-Allergene; im Zweifel taggen, nie weglassen
   - Relevanz für Laktose-, Fruktoseintoleranz und Zöliakie
   - Tierart: Fleisch, Schwein, Fisch, Krebstiere, Weichtiere, Ei, Milch, Honig
   - Makro-Kategorie: berechneter Wert aus dem dominanten Kalorienanteil plus Override-Vorschlag, wo die Berechnung fachlich falsch liegt; mehrere Kategorien erlaubt
   - Grundvorrat ja/nein
2. Rezepte:
   - Allergene und Tierarten werden NICHT manuell getaggt, sondern aus den Zutaten abgeleitet. Zeige die abgeleiteten Werte zur Kontrolle.
   - Kochzeit in Minuten, transportfähig, Meal-Prep-geeignet, Haltbarkeit in Tagen
3. Übungen:
   - Gelenkbelastung 0/1/2 für Schulter, Knie, unteren Rücken, Handgelenk, Ellbogen
   - Prüfe für jede Übung mit Stufe 2 an einem Gelenk, ob es eine Alternative mit Stufe ≤ 1 für dieselbe Muskelgruppe gibt; Lücken auflisten
Am Ende: Liste aller Stellen, an denen sich durch die neuen Tags das heutige Filterverhalten ändern würde (z. B. Fisch nicht mehr als Fleisch). Dann STOPP und auf Freigabe warten.

PHASE 2 – Übernahme (nach „Freigabe“, inklusive meiner Korrekturen):
- Tags in src/data übernehmen, abgeleitete Rezept-Tags als reine Funktion
- Tests:
  - Rezept-Allergene sind genau die Vereinigung der Zutaten-Allergene
  - Jede Übung mit Stufe 2 hat eine Alternative mit Stufe ≤ 1
  - Vegetarisch/vegan filtern wie vorher, außer bei den in Phase 1 gelisteten, freigegebenen Korrekturen
- npm run typecheck und npm test grün
```

---

## Prompt 4 – Bereich B: Ernährungsform, Ausschlüsse & Vorlieben

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Baue in Bereich B die Schritte „Ernährungsform“, „Allergien & Unverträglichkeiten“, „Vorlieben“ und „Alltag“.

TEIL 1 – Harte Ausschlüsse (dürfen NIE im Plan, in Vorschlägen oder in der Einkaufsliste auftauchen):
- Ernährungsform: alles / pescetarisch / vegetarisch / vegan
- Die 14 Hauptallergene nach LMIV als Chips: glutenhaltiges Getreide, Krebstiere, Eier, Fisch, Erdnüsse, Soja, Milch, Schalenfrüchte (Nüsse), Sellerie, Senf, Sesam, Sulfite, Lupinen, Weichtiere
- Unverträglichkeiten getrennt davon: Laktose (laktosefreie Milchprodukte bleiben erlaubt), Fruktose, Zöliakie (strenger als „glutenarm“)
- Weitere Ausschlüsse: Schwein, Alkohol in Rezepten, plus Freitext mit Abgleich gegen den Katalog
Erweitere den Katalog um die nötigen Tags, falls sie fehlen (siehe Plan, Abschnitt Lücken).

TEIL 2 – Weiche Vorlieben (gewichten, nicht filtern):
- Drei Gruppen Protein / Kohlenhydrate / gesunde Fette, je Lebensmittel aus dem Katalog als Chip mit drei Zuständen: 👍 mag ich / neutral / 👎 mag ich nicht (Tippen wechselt zyklisch)
- Bereits durch harte Ausschlüsse verbotene Lebensmittel werden gar nicht angezeigt
- Der Planer verwendet ein Scoring: 👍 erhöht, 👎 senkt stark (nur als Notlösung, falls sonst nichts passt). Gewichte in der Konstanten-Datei.

TEIL 3 – Alltag:
- Mahlzeiten pro Tag (2–5) und welche (Frühstück, Mittag, Abend, Snack 1/2)
- Kochzeit unter der Woche bzw. am Wochenende: ≤ 15 / ≤ 30 / ≤ 45 / egal
- Meal-Prep: „Ich koche gern einmal für 2–3 Tage vor“ → der Planer bündelt Rezepte
- Haushaltsgröße: Wie viele Personen essen mit? Nur die Einkaufsmengen skalieren, die Nährwertziele gelten nur für den Nutzer.
- Budget: günstig / mittel / egal

TEIL 4 – Integration (das ist der wichtigste Teil):
- Der Planer bekommt alle obigen Werte als Parameter. Harte Ausschlüsse sind ein Filter vor dem Scoring.
- Machbarkeitsprüfung schon im Onboarding: Bleiben nach den Ausschlüssen zu wenige Rezepte pro Mahlzeit übrig (Schwelle in den Konstanten), erscheint ein Hinweis mit Vorschlag, statt später einen leeren Plan zu erzeugen.
- Tests:
  - Property-Test: Für viele zufällige Profile enthält kein erzeugter Wochenplan und keine Einkaufsliste ein ausgeschlossenes Allergen oder einen Verstoß gegen die Ernährungsform
  - 👎-Lebensmittel erscheinen nicht, solange Alternativen existieren
  - Die Kochzeit wird eingehalten, Meal-Prep bündelt, die Haushaltsgröße skaliert nur die Einkaufsmengen
```

---

## Prompt 5 – Bereich B: Wochenraster „Zuhause / Mitnehmen / Auswärts“

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Baue in Bereich B den Schritt „Deine typische Woche“.

UI:
- Raster mit 7 Tagen × den gewählten Mahlzeiten (aus Prompt 4). Auf dem Handy als Liste pro Tag oder als scrollbares Raster, je nachdem, was mit den bestehenden Komponenten besser lesbar ist.
- Jeder Slot hat vier Zustände, gewechselt per Tippen, mit Icon und Text (nicht nur Farbe):
  🏠 Zuhause – wird geplant und eingekauft
  🥡 Mitnehmen – wird geplant und eingekauft, nur transportfähige Rezepte, gut für Meal-Prep
  🍽️ Auswärts – kein Rezept, kein Einkauf, reserviertes Kalorienbudget
  ⏭️ Auslassen – Mahlzeit fällt weg, die Tageswerte verteilen sich auf die übrigen
- Schnellaktionen: „Mo–Fr Mittag auswärts“, „Mo–Fr Mittag mitnehmen“, „Zeile/Spalte kopieren“, „Alles zurücksetzen“
- Bei Auswärts optional: Art (Kantine / Restaurant / bei Freunden) und eine geschätzte Größe (klein / normal / groß) statt einer kcal-Zahl. Daraus ergibt sich das reservierte Budget (Anteile in der Konstanten-Datei).

Logik (rein, getestet):
- Das Raster ist eine wiederkehrende Vorlage. Im Planer kann eine einzelne Woche später abweichen, ohne die Vorlage zu ändern.
- Auswärts-Slots: Budget reservieren. Die übrigen Mahlzeiten des Tages werden so skaliert, dass das Tagesziel erreicht wird.
- Protein-Ausgleich: Auswärts-Mahlzeiten gelten als proteinarm (Annahme in den Konstanten), daher verschiebt der Planer Protein auf die Mahlzeiten zu Hause.
- Auswärts und Auslassen erzeugen keine Einkaufsposten. Mitnehmen erzeugt welche.
- Heute-Screen: Ein Auswärts-Slot erscheint als Karte mit „Wie geplant gegessen“ (ein Tap, Budget wird geloggt) oder „Anpassen“.

Tests:
- Für Auswärts- und Auslassen-Slots gibt es nie Einkaufsposten
- Tagesziel und Protein werden trotz Auswärts-Slots im Rahmen erreicht (Toleranz in den Konstanten)
- Mitnehmen wählt nur transportfähige Rezepte
- Wochen-Override ändert die Vorlage nicht
```

---

## Prompt 6 – Bereich B: Vorrat erfassen

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln) und analysiere den bestehenden Vorrat- und Barcode-Code in src/services und src/store.

Baue in Bereich B den Schritt „Was hast du schon zu Hause?“ mit zwei Wegen:

1. Grundvorrat-Checkliste (zuerst, weil schneller):
   - Häufige Basics aus dem Katalog, gruppiert (Öle & Fette, Gewürze, Getreide & Nudeln, Konserven, Milchprodukte, Tiefkühl)
   - Abhaken = vorhanden. Optional ein Füllstand: voll / halb / Rest
   - Nach den harten Ausschlüssen aus Prompt 4 gefiltert
   - Basics wie Salz, Pfeffer und Öl werden als „Grundvorrat“ markiert und erscheinen nur auf der Einkaufsliste, wenn sie als leer markiert wurden

2. Barcode-Scan im Serienmodus:
   - Kamera bleibt offen, mehrere Produkte nacheinander scannen, kurze Bestätigung pro Treffer (Ton/Vibration, wenn erlaubt)
   - Nachschlagen bei Open Food Facts nur in dieser Nutzeraktion. Packungsgröße übernehmen, Preise nie.
   - Zuordnung zu einem Katalog-Lebensmittel: automatischer Vorschlag über Kategorie und Name, der Nutzer bestätigt oder ändert. Die Zuordnung wird pro Barcode gemerkt.
   - Offline oder kein Treffer: Barcode speichern und später auflösen, oder manuell erfassen
   - Optional ein Mindesthaltbarkeitsdatum
   - Kamera-Berechtigung sauber behandeln (verweigert, nicht vorhanden, iOS Safari), immer mit manuellem Ausweg

Integration (getestet):
- Die Einkaufsliste zieht vorhandene Mengen ab
- Der Planer bevorzugt Rezepte, die Vorrat verbrauchen, besonders bei nahem MHD (Gewicht in den Konstanten)
- Bestehende Regel bleibt: Der Vorrat wird nie automatisch aus Gegessenem befüllt; Gegessenes mit Katalog-Zuordnung zieht weiterhin ab
- Gescannte Produkte, die gegen harte Ausschlüsse verstoßen, werden gespeichert, aber markiert und nie für den Plan verwendet

Tests: Abzug in der Einkaufsliste, Vorrat-Bevorzugung im Planer, Zuordnung merken, Offline-Fallback (Service gemockt), Ausschluss-Markierung.
```

---

## Prompt 7 – Bereich C: Erfahrung, Rahmen & Cardio

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Baue in Bereich C die Schritte „Erfahrung“, „Dein Rahmen“, „Cardio“ und „Fokus“.

TEIL 1 – Erfahrungsstufe (reine Funktion estimateTrainingLevel):
- Eingaben: Kraftsport-Jahre und Pause (aus Bereich A), normalisierter FFMI (falls KFA bekannt), Geschlecht
- Ausgabe: Anfänger / Fortgeschritten / Erfahren mit Begründung und Sicherheit
- Regeln als Ausgangspunkt: < 1 Jahr → Anfänger; 1–3 Jahre → Fortgeschritten; > 3 Jahre → Erfahren. Ein hoher normalisierter FFMI (geschlechtsspezifische Schwellen in den Konstanten) kann eine Stufe höher setzen, ein niedriger eine Stufe tiefer. Eine Pause > 6 Monate setzt eine Stufe tiefer, mit Hinweis „Muskelgedächtnis: Du baust schneller wieder auf als beim ersten Mal“.
- UI: Die Empfehlung ist vorausgewählt, der Nutzer kann sie mit einem Tap überschreiben.
- Optional für Fortgeschrittene und Erfahrene: aktuelle Arbeitsgewichte für 3–5 Grundübungen (Gewicht × Wiederholungen). Daraus werden die Startgewichte für die Progression in training.ts. Ohne Angabe gibt es in der ersten Einheit einen „Einstiegs-Satz“, aus dem das Startgewicht abgeleitet wird.

TEIL 2 – Rahmen:
- Trainingstage pro Woche (2–6) und welche Wochentage (Wochenleiste, Mehrfachauswahl)
- Dauer pro Einheit: 30 / 45 / 60 / 75+ Minuten
- Ort & Equipment: Studio / Zuhause mit Kurzhanteln / Zuhause mit Langhantel & Rack / nur Körpergewicht / Bänder (Mehrfachauswahl)
- Beschwerden (optional): Schulter, Knie, unterer Rücken, Handgelenk, Ellbogen, Freitext. Wirkung: Übungen werden durch gelenkschonende Alternativen ersetzt, nicht nur entfernt. Hinweis bei akuten Schmerzen: ärztlich abklären.

TEIL 3 – Cardio mit Empfehlung je Ziel:
- Optionen: kein zusätzliches Cardio / Schrittziel / Zone 2 (locker, Sprechen möglich) 2–3× 20–40 min / HIIT 1–2× kurz / Kombination
- Empfehlung bei Fett verlieren und Recomposition: Schrittziel plus 2× Zone 2. Erklärung im „Warum?“-Sheet: Fett verlierst du vor allem über das Kaloriendefizit. Ausdauertraining hilft zusätzlich, besonders beim viszeralen Bauchfett, und stärkt Herz und Kreislauf. WHO-Empfehlung: 150–300 Minuten moderate Bewegung pro Woche.
- Bei Muskelaufbau: leichtes Cardio für die Gesundheit, nicht vor Beintraining
- Bevorzugte Art: Gehen, Rad, Laufen, Rudern, Schwimmen, Crosstrainer
- Wenn Cardio die Kalorien beeinflusst: Trainingsaufschlag aus Prompt 2 aktualisieren

TEIL 4 – Fokus:
- Bis zu zwei Fokus-Muskelgruppen über eine selbst gezeichnete SVG-Körperkarte (vorne/hinten) plus Listenauswahl als barrierearmer Ersatz
- Hinweis: „Fokus heißt etwas mehr Volumen für diese Muskeln, der Rest wird weiter trainiert.“

Tests: estimateTrainingLevel (alle Kombinationen), Beschwerden ersetzen Übungen korrekt, Equipment-Filter, Cardio-Empfehlung je Ziel.
```

---

## Prompt 8 – Bereich C: Trainingsplan-Empfehlung & Wochenübersicht

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Baue in Bereich C den Schritt „Dein Trainingsplan“.

TEIL 1 – Plan-Generator (rein, getestet, z. B. domain/training/recommendPlan.ts). Regeln als Ausgangspunkt, bitte mit Quellen kommentieren:
- Split nach Tagen und Stufe:
  2 Tage → Ganzkörper A/B
  3 Tage → Ganzkörper A/B/C (Standard für Anfänger)
  4 Tage → Oberkörper/Unterkörper ×2
  5 Tage → Ober/Unter + Push/Pull/Beine (nur Fortgeschrittene und Erfahrene)
  6 Tage → Push/Pull/Beine ×2 (nur Erfahrene). Anfänger mit 5–6 Tagen bekommen 3–4 Krafttage plus Cardio- oder Mobilitätstage, mit Erklärung.
- Jeder Muskel wird mindestens 2× pro Woche trainiert
- Wochenvolumen (harte Sätze pro Muskel): Anfänger ca. 8–12, Fortgeschrittene 12–16, Erfahrene 14–20. Fokus-Muskeln +20–30 % innerhalb der Obergrenze.
- Wiederholungsbereiche: Grundübungen 6–12, Isolationsübungen 10–20, Intensität 1–3 Wiederholungen vor dem Muskelversagen (RIR)
- Die Einheit passt in die gewählte Dauer (Schätzung pro Satz inkl. Pause, Faktor in den Konstanten). Bei zu wenig Zeit: Supersätze oder weniger Übungen, nie stillschweigend kürzen.
- Equipment, Beschwerden und Fokus aus Prompt 7 werden berücksichtigt
- Planung über die Woche: keine schweren Einheiten für dieselbe Muskelgruppe an zwei Tagen hintereinander; Zone 2 an Ruhetagen oder nach dem Krafttraining; HIIT nicht am Tag vor dem Beintraining

TEIL 2 – Wochenübersicht-UI:
- 7 Tage, jeder Tag als Karte: Krafteinheit (Name + Hauptmuskeln) / Cardio / Ruhe
- Tage tauschen per Ziehen oder per „Tauschen“-Button (barrierearm)
- Split wechseln: Alternativen mit kurzer Begründung
- Pro Einheit aufklappbar: Übungen mit Sätzen/Wiederholungen; Übung tauschen aus den Alternativen des Katalogs
- „Warum dieser Plan?“-Sheet: Split-Logik, Volumen, Quellen
- Änderungen werden sofort validiert (z. B. Hinweis bei derselben Muskelgruppe an zwei Tagen hintereinander), aber nie blockiert

TEIL 3 – Übernahme:
- „Plan übernehmen“ setzt ihn als aktives Programm in der bestehenden Rotation (training.ts) und übernimmt die Startgewichte aus Prompt 7
- Die geplanten Tage fließen in den Trainingsaufschlag der Kalorien (Prompt 2/3) und in den Heute-Screen

Tests: Volumen pro Muskel je Stufe, Frequenz ≥ 2, Dauer eingehalten, Equipment und Beschwerden respektiert, Fokus erhöht das Volumen, Abstandsregeln, Übernahme in die Rotation.
```

---

## Prompt 9 – Zusammenfassung & Rückverfolgbarkeits-Prüfung

```text
Lies zuerst docs/ONBOARDING_PLAN.md (Grundregeln). Das ist die Abschluss-Session. Ziel: Jede Onboarding-Eingabe wirkt nachweislich in der App.

TEIL 1 – Zusammenfassung „Dein Plan“:
- Karten für: Körper (BMI, WHtR, KFA, FFMI als Bereiche), Ziel und Tempo mit Prognose, Kalorien und Makros (oder Portionen im zahlenfreien Modus), Essensrahmen (Ernährungsform, Ausschlüsse, Wochenraster kompakt, Vorrat-Anzahl), Trainingswoche
- Jede Karte hat „Ändern“ → springt direkt in den Schritt und zurück zur Zusammenfassung
- Werte mit source 'estimated' oder 'default' sind dezent markiert („geschätzt – ergänzen?“)
- Hinweis: „LifeFit ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung.“
- „Los geht’s“ erzeugt sofort den ersten Wochenplan und die Einkaufsliste und führt zu Heute

TEIL 2 – Nach dem Onboarding:
- Heute-Screen: höchstens eine dezente, wegklickbare Karte für fehlende, besonders wirksame Angaben (Priorität: KFA > Alltagsaktivität > Wochenraster > Vorrat). Nach dem Wegklicken 14 Tage Ruhe.
- Änderungen im Profil berechnen die betroffenen Werte neu, zeigen eine Vorher/Nachher-Vorschau und speichern beim Bestätigen eine neue Zielversion (mit Undo-Toast)

TEIL 3 – Rückverfolgbarkeit (das Wichtigste):
1. Erstelle docs/ONBOARDING.md mit einer Tabelle: Eingabe → konsumierende Funktion(en) → sichtbare Wirkung in der App → Test, der es absichert.
2. Gehe jedes Feld des OnboardingProfile durch. Wird ein Feld nirgends konsumiert, binde es an oder entferne es mit Begründung. Kein Feld darf ins Leere laufen.
3. Schreibe End-to-End-Tests über die Domänen-Ebene mit mindestens drei vollständigen Personas, z. B.:
   - Anfängerin, 28, KFA 30 %, vegetarisch, Nussallergie, Mo–Fr Mittag auswärts, 3 Trainingstage zuhause mit Kurzhanteln, Knieprobleme
   - Erfahrener, 35, KFA 13 %, isst alles, 👎 Fisch, Meal-Prep, Mittag mitnehmen, 5 Tage Studio, Fokus Schultern
   - Schnellstart-Nutzer: nur Pflichtminimum, alles andere Standardwerte
   Pro Persona prüfen: Ziel und Makros plausibel, Wochenplan ohne Ausschlüsse und mit Vorlieben, keine Einkaufsposten für Auswärts, Vorrat abgezogen, Trainingsplan passt zu Tagen, Dauer, Equipment und Beschwerden.
4. Prüfe die Grenzfälle: alles übersprungen, extreme Werte, Geschlecht „keine Angabe“, Alter 17 und 70+, Schwangerschaft, BMI < 18.5.

TEIL 4 – Dokumentation: FEATURES.md und README.md auf den neuen Stand bringen.

Erfolgreich, wenn: docs/ONBOARDING.md vollständig ist, jedes Feld eine Wirkung und einen Test hat, alle Personas grün sind und npm run typecheck && npm test && npm run build ohne Fehler laufen.
```

---

## Prompt 10 – Feinschliff (optional)

```text
Lies docs/ONBOARDING_PLAN.md und docs/ONBOARDING.md. Mache einen kritischen Review des gesamten Onboardings, als würdest du es zum ersten Mal auf einem kleinen Handy (375 px) nutzen, zuerst im hellen, dann im dunklen Modus.

Prüfe und behebe:
- Texte: kurz, klar, freundlich, einheitliche Anrede und Rechtschreibung, keine beschämenden Formulierungen, keine Scheingenauigkeit
- Ablauf: Gibt es Schritte, die man zusammenlegen oder streichen kann? Ist der Schnellstart wirklich in ca. 1 Minute machbar?
- Barrierefreiheit: Screenreader-Labels, Fokusreihenfolge, Kontraste, Zustände nicht nur über Farbe
- Tastatur und Eingabe: passende inputmode-Werte (decimal, numeric), Enter springt weiter, keine verdeckten Felder durch die Bildschirmtastatur
- Robustheit: Abbruch an jeder Stelle, App neu laden, Zurück-Button des Browsers, Fehlergrenzen
- Performance: zxing-wasm nur dynamisch laden, wenn der Scanner geöffnet wird

Liste zuerst alle Funde mit Priorität auf und warte auf meine Freigabe, bevor du etwas änderst.
```
