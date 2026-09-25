# Adaptive Fitness Engine

Die Engine liest den App-Zustand und liefert priorisierte, erklärbare **Empfehlungen mit Aktionsvorschlägen**. Sie handelt nie selbst: Jede Änderung braucht einen Tap des Nutzers, und jede Änderung lässt sich rückgängig machen.

```
AppState + Optionen (Datum, Uhrzeit, verfügbare Zeit, Vorrat)
   │
   ▼
buildContext()      → Fakten des Tages (gegessen, geplant, freie Slots, Vorrat, Gewichtstrend, heutige Einheit …)
   │
   ▼
Regeln (pure Funktionen) → Recommendation[]  { title, message, reasons, facts, actions, priority, confidence }
   │
   ▼
Guardrails          → Safe-Mode, keine Defizit-Empfehlungen, Sicherheitshinweis
   │
   ▼
Ausgeblendete filtern → nach Priorität sortieren → Top N
```

Code: `src/domain/engine/` · Tests: `engine.test.ts` · UI: `features/today/CoachCard.tsx`

## Inputs

| Input | Quelle |
|---|---|
| Fitnessziel | `goal.type`, `goal.targetWeightKg` |
| Körperdaten | `profile` (Geschlecht, Alter, Größe, Erfahrung) + 7-Tage-Gewichtstrend |
| Kalorien-/Protein-Ziel | versionierte `targets` (gültig am Tag) |
| Ernährungsvorlieben | `nutritionProfile.diet`, `excluded` (harte Filter) |
| Verfügbare Lebensmittel | Einkaufsliste „Habe ich“/„Gekauft“ + optional `options.pantry` |
| Heutige Mahlzeiten | `logEntries` (gegessen) + `plannedMeals` mit Status `planned` |
| Trainingsplan, Trainingstage | `training` (Programm, Wochentage) → Rotation |
| Absolvierte Workouts, Fortschritt | `workouts` (erledigte Arbeitssätze, geschätztes 1RM) |
| Verfügbare Zeit | `coach.availableTime` (pro Tag, im Heute-Screen wählbar) |

## Regeln

Alle Schwellwerte stehen als benannte Konstanten im Code (`NUTRITION_RULES`, `TRAINING_RULES`, `BODY_RULES`, `SAFETY_THRESHOLDS`).

### Ernährung

| Regel | Auslöser | Empfehlung |
|---|---|---|
| **nutrition_gap** | offen = Ziel − gegessen − noch geplant; ≥ 150 kcal **oder** ≥ 15 g Protein | Titel „Heute fehlen noch 650 kcal und 50 g Protein“. Bis zu 3 Rezepte für den nächsten freien Slot, Portionen auf die Lücke skaliert. Scoring: Kalorien-Passung + 1,2 × Protein-Defizit + 0,08 je fehlender Zutat + 0,25 wenn in den letzten 2 Tagen gegessen + lange Zubereitung am Abend. Nur Protein offen → magere, fertige Eiweißquellen (Skyr, Quark …), bevorzugt aus dem Vorrat. |
| | Einschränkungen | Eine Mahlzeit ≤ 45 % des Tagesziels. Ab 21 Uhr nur Snack (≤ 20 %) mit dem Hinweis, dass der Rest kein Problem ist. Ab 20 Uhr keine Rezepte > 30 min. Slots gelten nur bis zu ihrer Uhrzeit (Frühstück bis 11, Mittag bis 15 Uhr). |
| **nutrition_over** | gegessen > Ziel + 10 % | Nur neutrale Info. **Nie** Ausgleich durch Weglassen, Fasten oder „abtrainieren“. |
| **protein_pattern** | ≥ 4 erfasste Tage der letzten 7, Ø Protein < 80 % des Ziels | Tausch kommender Mahlzeiten (3 Tage) gegen Rezepte mit gleichen Kalorien und ≥ 10 g mehr Protein. |
| **leftovers** | Verderbliche Zutaten übersprungener Mahlzeiten sind gekauft und nicht mehr eingeplant | Rezept, das die meisten davon verwertet, heute oder morgen einplanen. |

### Training

Übungen sind Muskelregionen zugeordnet (Hauptmuskel = 1 Satz, starker Mitspieler = 0,5). Eine Einheit **trifft** eine Region ab 4 effektiven Sätzen und hat sie als **Schwerpunkt** ab 6.

| Regel | Auslöser | Empfehlung |
|---|---|---|
| **training_time** | verfügbare Zeit < geschätzte Dauer | Kurzversion. Gekürzt wird in dieser Reihenfolge: Pausen der Zusatzübungen → Sätze der Zusatzübungen → Zusatzübungen streichen → Sätze der Grundübungen auf 2. Die ersten beiden Übungen bleiben immer. |
| **training_recovery** | Schwerpunkt der heutigen Einheit wurde gestern schon mit ≥ 6 Sätzen trainiert | Tausch gegen die nächste Vorlage der Rotation ohne diesen Schwerpunkt, sonst verschieben. |
| **training_frequency** | Region diese Woche schon ≥ 2× trainiert **und** Wochensätze inkl. heute > Obergrenze (Anfänger 14, Fortgeschrittene 20; Beine × 1,5, Arme × 1,2, Bauch × 0,8) | „Du hast diese Woche bereits zweimal Beine trainiert“ → alternative Vorlage oder reduzierte Version (Hauptübung bleibt). |
| **training_missed** | Geplante Einheit diese Woche verpasst, heute frei, keine Kollision mit gestern | Nachholen. |
| **training_undertrained** | Ab Donnerstag: große Region (Beine, Brust, Rücken, Schultern) 0× trainiert und von den restlichen Einheiten nicht abgedeckt | Vorlage, die die meisten fehlenden Regionen abdeckt. |
| **training_stall** | Geschätztes 1RM seit 3 Einheiten nicht über dem vorherigen Bestwert (+0,5 %) | Deload (~10 % weniger) oder anderer Wiederholungsbereich. Im Defizit: „Kraft halten ist ein gutes Ergebnis.“ |
| **training_program** | < 50 % der Einheiten in 3 Wochen erledigt → weniger Tage vorschlagen. Oder Muskelaufbau mit < 1,5× Frequenz pro Region, während ein anderes Programm bei gleichen Tagen ≥ 2× erreicht. | Plan anpassen. |

### Einkauf

| Regel | Auslöser | Empfehlung |
|---|---|---|
| **shopping_missing** | Zutaten geplanter Mahlzeiten (heute bis Sonntag), die nicht als „habe ich“ oder „gekauft“ markiert sind | „Für die geplanten Mahlzeiten fehlen noch 7 Lebensmittel“. Hohe Priorität, wenn etwas für heute oder morgen gebraucht wird. |

Die Einkaufsliste wird aus dem Plan **abgeleitet**. Nimmt der Nutzer einen Mahlzeitenvorschlag an, aktualisiert sie sich deshalb automatisch, ohne Sync-Code. Jeder Vorschlag nennt, wie viele Zutaten dadurch auf die Liste kommen.

### Körper

| Regel | Auslöser | Empfehlung |
|---|---|---|
| **body_rate** | Wochenrate in % des Körpergewichts außerhalb des Zielbands (Abnehmen −1,0 bis −0,2; Aufbau +0,05 bis +0,5; Halten ±0,3) | Kalorienziel um ±150 kcal ändern, Protein bleibt gleich. Nur wenn: ≥ 4 Wiegungen über ≥ 14 Tage, ≥ 8 erfasste Tage in den letzten 14 mit Ø ±10 % am Ziel, letzte Zieländerung ≥ 14 Tage her, nie unter der Kalorienuntergrenze. |

## Guardrails (nicht verhandelbar)

1. **Kein medizinischer Anspruch.** Die Engine gibt keine Diagnosen, keine Therapie- oder Medikamentenhinweise und keine Ernährung bei Krankheiten. Unter jeder Karte steht ein Hinweis.
2. **Safe-Mode.** Er greift bei: Alter < 18, BMI < 18,5 mit Abnehmziel, Gewichtsverlust > 1,5 %/Woche oder Ø Zufuhr < 60 % des Ziels an ≥ 4 erfassten Tagen. Dann fallen alle Empfehlungen weg, die weniger Essen bedeuten (`increasesDeficit`). Stattdessen erscheint ein neutraler Hinweis auf Ärztin/Arzt oder Ernährungsfachkraft, ohne Diagnose und ohne Zielzahl.
3. **Kalorienuntergrenze.** max(Grundumsatz × 1,1; 1500 kcal Männer / 1200 kcal Frauen) gilt für Formel **und** Anpassungen.
4. **Keine Kompensation.** Überessen führt nie zu Weglassen, Fasten oder Zusatztraining.
5. **Harte Filter.** Ernährungsform und Allergene werden nie „weggescored“.
6. **Nichts passiert automatisch.** Jede Aktion ist ein Vorschlag mit Rückgängig-Option. Zieländerungen sind versioniert, die Historie bleibt korrekt.
7. **Textprüfung.** `validateCoachText()` lehnt generierte Texte mit medizinischen oder restriktiven Begriffen ab. Dasselbe gilt für Zahlen ≥ 10, die nicht in den `facts` der Empfehlung stehen.

## LLM vs. deterministisch

**Grundsatz:** Zahlen, Entscheidungen und Sicherheit sind Code. Sprache, unscharfe Eingaben und Kreativität darf ein LLM übernehmen, aber nur innerhalb der Fakten, die die Engine liefert.

### Muss deterministisch bleiben

| Teil | Warum |
|---|---|
| Kalorien-, Makro- und Portionsrechnung, Rezept-Nährwerte | Muss exakt, reproduzierbar und testbar sein. LLMs verrechnen sich. |
| Tageslücke, Überschreitung, Wochenmittel, Gewichtstrend | Grundlage aller Aussagen, braucht eine einzige Wahrheit. |
| Diät- und Allergenfilter | Sicherheitsrelevant, darf nie probabilistisch sein. |
| Sicherheitsregeln, Safe-Mode, Kalorienuntergrenze, Abkühlzeiten | Darf nicht per Prompt umgehbar sein. |
| Einkaufsliste (Ableitung, Mengen, Packungen) | Mengenlogik, muss exakt zum Plan passen. |
| Trainingslast pro Region, Erholung, Frequenz, Progression, Rekorde, Zeitkürzung | Nachvollziehbare Regeln, direkt aus den Logdaten. |
| Auswahl und Ranking der Empfehlungen, Ausblenden | Stabil und erklärbar („Warum?“). |
| Ausführen von Aktionen | Nur typisierte, geprüfte Aktionen über den Store. |

### Sinnvoll mit LLM-Unterstützung

| Teil | Wie | Absicherung |
|---|---|---|
| **Formulierung und Ton** der Empfehlungen (motivierend, kurz, persönlich) | LLM bekommt `title`, `facts` und `reasons` als JSON und formuliert nur um | `validateCoachText()`. Bei Verstoß wird der Template-Text gezeigt. Keine neuen Zahlen. |
| **Freitext-Erfassung** („2 Brötchen mit Käse und ein Latte“) | LLM extrahiert Lebensmittel und Mengen und bildet sie auf Katalog-IDs ab | Ausgabe als JSON-Schema. Nährwerte kommen immer aus dem Katalog. Der Nutzer bestätigt. |
| **Rezeptideen aus Resten** oder neue Rezepte | LLM schlägt eine Kombination aus erlaubten, vorhandenen Lebensmitteln vor | Zutaten nur aus dem Katalog. Makros und Portionen rechnet die Engine. Diätfilter läuft danach erneut. |
| **Rückfragen und Erklärungen** („Warum 150 kcal mehr?“) | LLM erklärt anhand von `facts` und Regelbeschreibung | Nur Fakten aus dem Kontext. Bei Gesundheitsfragen feste Antwort mit Verweis auf Fachleute. |
| **Wochenrückblick** als Fließtext | Zusammenfassung von `weekStats` und Empfehlungen | Wie oben, keine neuen Zahlen. |
| **Präferenzen aus Verhalten** (oft getauschte Rezepte, bevorzugte Zeiten) | LLM oder einfache Statistik leitet Tags ab, z. B. „mag keine Linsen“ | Nur als weiches Gewicht im Scoring, nie als harter Filter ohne Bestätigung. |
| **Übungsersatz bei fehlendem Gerät** | LLM schlägt Alternativen vor | Nur aus dem Übungskatalog, gleiche Region, der Nutzer bestätigt. |

### Integrationsvertrag (für später)

```
runEngine(state)  ──►  Recommendation { id, facts, reasons, title, message }
                          │
                          ├─► LLM: "Formuliere freundlich, ≤ 2 Sätze, nutze nur diese Fakten: {facts}"
                          │         └─► validateCoachText(text, facts)
                          │               ok  → anzeigen
                          │               nok → Template-Text anzeigen (+ Log)
                          └─► actions bleiben unverändert (das LLM erzeugt nie Aktionen)
```

Die App funktioniert damit vollständig offline und ohne LLM. Das LLM verbessert nur die Sprache und die Eingabe.
