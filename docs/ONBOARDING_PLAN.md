# Onboarding – Analyse & Plan

Stand: 01.10.2026 · Branch `feat/today-nutrition-phase1` · Commit `ff2408c` · 713 Tests grün.
Dieses Dokument ist die Grundlage aller folgenden Onboarding-Sessions. **Maßgeblich für Inhalt und Reihenfolge sind die Prompts in `docs/ONBOARDING_PROMPTS.md`** (Prompts 0–10). Dieser Plan ergänzt sie um Ist-Analyse, Datenmodell, Integrationspunkte, Risiken und die Entscheidungen vom 01.10.2026. Code wird erst ab Prompt 1 geschrieben.

> Hinweise:
> - `FEATURES.md` existiert im Repository nicht. Gelesen wurden `README.md`, `docs/ADAPTIVE_ENGINE.md` und der Code.
> - `docs/ONBOARDING_PROMPTS.md` lag nur unter `Downloads/` und wurde unverändert nach `docs/` kopiert.

---

## a) Ist-Zustand

### Ablauf heute (`src/features/onboarding/Onboarding.tsx`, ein Screen, 576 Zeilen)

Die Schritte stehen fest in `STEPS`:

| Schritt | Inhalt | Pflicht? |
|---|---|---|
| `welcome` | Begrüßung, „Los geht's“ | – |
| `goal` | Ziel: Muskelaufbau / Fett verlieren / Recomposition / Halten | ja |
| `body` | Name (optional), Geschlecht (m/w), Alter, Größe, Gewicht, Zielgewicht (optional), Körperfett (optional, „nur geschätzt“), Alltagsaktivität | Alter, Größe, Gewicht ja |
| `training` | Trainingsjahre, Freihantel-Erfahrung, Dauer pro Einheit, Fokus, Muskel-Prioritäten, dauerhafte Beschwerden (`TrainingProfileFields`), Trainingstage | ja |
| `nutrition` | Ernährungsform (alles / vegetarisch / vegan), 4 Ausschlüsse (Laktose, Gluten, Nüsse, Fisch), Mahlzeiten pro Tag (3 / 3 + Snack), Wassertagesziel (Startwert) | ja |
| `tastes` | Vorlieben und Abneigungen (`data/tastes.ts`, Frühstück/Hauptgerichte) | überspringbar |
| `style` | Mahlzeitenstil (leicht / ausgewogen / herzhaft) | ja |
| `program` | Equipment-Profil (Gym/Zuhause/ohne Geräte) + einzelne Geräte, Programmwahl (Empfehlung aus `recommendProgram`) | ja |
| `result` | Kalorien und Makros (`calculateTargets`), ±-Anpassung | ja |
| `creating` | speichert über `completeOnboarding`, plant die Woche (`fillWeek`) | – |

Es gibt keine Zwischenspeicherung. Der Zustand lebt in `useState`, und wer abbricht, beginnt von vorn. Nur ein Teil der Schritte lässt sich überspringen. Die Validierung blockiert „Weiter“.

### Gespeicherte Daten (`AppState`, ein localStorage-Key `lifefit:v1`, `schemaVersion: 2`)

| Typ / Feld | Inhalt | Verwendet in |
|---|---|---|
| `profile: Profile` | name, sex (`male`/`female`), age, heightCm, activity, experience, createdAt | `nutrition.calculateTargets`, `basalMetabolicRate`, `calorieFloor`, `engine/guardrails` (Alter, BMI), `trainingRules.weeklyCap`, `explain` |
| `goal: FitnessGoal` | type, startWeightKg, targetWeightKg?, startedAt | `calculateTargets`, `planRules.bodyRateRule`, `progress.goalProgress`, Engine |
| `nutritionProfile: NutritionProfile` | diet, excluded, slots, dislikedFoods?, favorites?, avoided?, mealStyle?, waterGoalMl?, waterReminders? | `recipeAllowed`/`foodAllowed` (harte Filter), `planner.suggestWeek`, `preferences.plannerAffinity`, `water.ts`, `nutrientReport` |
| `targets: NutritionTarget[]` | versioniert (`validFrom`), kcal/protein/carbs/fat | `targetForDate`, `dayTargetFor`, alle Tagesanzeigen |
| `training: TrainingSetup` | programId, weekdays, equipment, equipmentItems, trainingYears, freeWeights, sessionMinutes, focus, musclePriorities, limitations, liked/disliked | Rotation (`training.ts`), `exerciseLibrary.alternativesFor`, `sessionAdapt`, `planVersions` |
| `measurements: MeasurementEntry[]` | Körperfett (gemessen/geschätzt) | bisher nur gespeichert, keine Anzeige |
| `weights: WeightEntry[]` | Startgewicht aus dem Onboarding | `progress`, Engine |
| `plannerSettings` | priority, mealTimes, weeklyBudgetChf? | Planer, `schedule`, `costs` |
| `dayContexts` | pro Tag: timeBudget, mode (`normal`/`eating_out`), removedSlots | `excludedSlots`, Planer, Cascade |
| `pantry` | Vorrat pro Lebensmittel (g, updatedAt) | `pantryEstimate`, Einkauf, Planer |
| `products` | gescannte Produkte (Open Food Facts), lokaler Cache | Erfassung, Einkauf-Scan |

Persistenz: `store/persistence.ts`.
- `loadState` migriert v1 → v2 und führt danach einmalige Aufräumarbeiten aus (`migrateLegacy`: Euro-Budget, alte Tagesmodi, Workout-Namen, Auswärts-Markierung).
- Beschädigte oder unbekannte Daten werden nach `lifefit:corrupt-backup` gesichert, nie verworfen.
- `isSetupComplete` entscheidet, ob das Onboarding erscheint: profile, goal, nutritionProfile, training und targets müssen vorhanden sein.

---

## b) Lücken

### Lebensmittel- und Rezeptkatalog (`data/foods.ts` 51 Lebensmittel, `data/recipes.ts` 24 Rezepte)

| Merkmal | Heute | Lücke |
|---|---|---|
| Allergene (14 nach LMIV) | `Allergen = 'lactose' \| 'gluten' \| 'nuts' \| 'fish'`. Getaggt: Laktose 10×, Gluten 7×, Fisch 2×, Nüsse 2× | **10 Hauptallergene fehlen:** Krebstiere, Eier, Erdnüsse (heute unter „Nüsse“), Soja, Milch (Laktose ist eine Unverträglichkeit, keine Milcheiweißallergie), Sellerie, Senf, Sesam, Schwefeldioxid/Sulfite, Lupinen, Weichtiere. Eier, Tofu, Sojasauce, Erdnussbutter sind nicht korrekt getaggt. Rezepte haben keine eigenen Allergene, sie werden aus den Zutaten abgeleitet (gut, bleibt so). |
| Ernährungsform | `vegan`/`vegetarian` pro Lebensmittel, Ernährungsform `omnivore/vegetarian/vegan` | **Pescetarisch fehlt.** Fisch ist als `meat` erfasst; nur das Allergen `fish` unterscheidet Lachs/Thunfisch von Fleisch. Ein eigenes Merkmal `pescatarian` (oder `kind: 'meat' \| 'fish' \| …`) ist nötig. |
| Kategorie Protein/Kohlenhydrate/Fette | keine (nur Supermarkt-Kategorie `ShoppingCategory`) | Ableitbar als reine Funktion aus `per100` (Energieanteil des dominanten Makros). Kein Datenpflegeaufwand, Grenzfälle (z. B. Erdnussbutter, Hülsenfrüchte) per Override-Tabelle. |
| Kochzeit | `Recipe.prepMin` ✅ | – |
| Meal-Prep-Eignung | Tag `'Meal Prep'` bei 5 von 24 Rezepten, vom Planer als Rest-Logik genutzt (`MEAL_PREP_TAG`) | Freitext-Tags. Für die Onboarding-Frage ok, aber 5 Rezepte sind wenig. Besser typisiert (`mealPrep: boolean`). |
| Transportfähigkeit | Tag `'To go'` bei 2 Rezepten | Für „Mitnehmen“ im Wochenraster zu wenig. Merkmal `portable` + Pflege nötig. |

### Übungskatalog (`data/exercises.ts`, 55 Übungen – korrigiert von 61, E23)

| Merkmal | Heute | Lücke |
|---|---|---|
| Equipment | `equipment` (ein Wert pro Übung) + Mapping auf Einzelgeräte (`trainingProfile.availableEquipment`) | Ausreichend. Übungen mit mehreren Geräten (Bank + Hantel) werden nur über das Hauptgerät gefiltert. |
| Muskelgruppen primär/sekundär | `primary`, `secondary` ✅ + feines Muskelmodell (`data/muscles.ts`, 16 Muskeln mit Gewichtung) ✅ | – |
| Gelenkbelastung | `AREA_LOAD` (Schulter, Ellbogen, Handgelenk, unterer Rücken, Hüfte, Knie) als separate Liste, nur „belastet ja/nein“ | Keine Abstufung. Für die Onboarding-Frage „Beschwerden“ reicht das. Rücken heißt im Modell `lower_back`. |
| Alternativen | `alternatives` pro Übung ✅, `alternativesFor` filtert nach Equipment, Ausschlüssen und Vorlieben | – |

### Planer (`planner.suggestWeek` über `week/planning.planMeals`)

Heute verarbeitet er:
- Daten und Slots, Tagesziel (pro Tag), Ernährungsprofil (Filter, Vorlieben), bestehende Mahlzeiten
- Vorrat und Vorratsalter, Zeitbudget pro Tag, ausgeschlossene Slots pro Tag
- gelernte Vorlieben, CHF-Budget (anteilig), Priorität, Slot nach dem Training, Zufallsquelle

Es fehlen:
- **Haushaltsgröße.** Geplant wird für eine Person; der Einkauf müsste mit der Personenzahl multipliziert werden, die Nährwerte nicht.
- **Kochzeit als Profilwert.** Heute gibt es nur ein Zeitbudget pro Tag (`TimeBudget`). Ein Standardwert aus dem Onboarding wäre die Voreinstellung.
- **Meal-Prep-Präferenz** (Rezepte mit Meal-Prep-Tag bevorzugen, Reste an Folgetagen).
- **Wochenraster pro Slot.** Heute gibt es nur „Abendessen auswärts“ (`DayMode`) und „entfernt“ (`removedSlots`) pro Tag. Es fehlen „Mitnehmen“ (→ transportfähige Rezepte bevorzugen) und ein **wiederkehrendes Wochenmuster**, das neue Wochen vorbelegt.
- **Vorlieben pro Makro-Kategorie** (3 Stufen) als weiches Gewicht.

### Vorrat und Barcode heute

- **Vorrat** (`state.pantry`, `domain/week/pantry.ts`):
  - Pro Lebensmittel wird eine Menge in Gramm gespeichert. Gegessenes wird über `pantryEstimate` abgezogen.
  - Der Vorrat kommt in den Vorrat, wenn man auf der Einkaufsliste etwas als „gekauft“ oder „habe ich“ markiert, über einen gescannten Kauf (`ProductPurchaseSheet`) oder eine manuelle Korrektur im Detail-Sheet.
  - Nachkaufen gilt nur für Grundvorrat aus `data/basics.ts` (8 Lebensmittel mit Mindestmenge).
- **Barcode** (`services/barcodeScanner.ts` + `productLookup.ts`):
  - Kamera mit nativem BarcodeDetector, sonst Fallback auf zxing-wasm; die GTIN-Prüfziffer wird geprüft.
  - Danach eine Open-Food-Facts-Abfrage auf Nutzeraktion; das Ergebnis wird lokal in `products` gecacht.
  - Ein gescannter Kauf wirkt nur auf den Vorrat, wenn das Produkt einem Katalog-Lebensmittel zugeordnet ist.
  - **Ein Serienmodus fehlt**: Jeder Scan ist heute ein einzelner Ablauf mit Bestätigung.

### Weitere Lücken für das Zielbild

- **Geschlecht:** Es gibt nur `male`/`female`. „Keine Angabe“ fehlt; Mifflin-St Jeor braucht dafür eine dokumentierte Regel (siehe offene Fragen).
- **Geburtsjahr:** Heute wird das Alter gespeichert, es veraltet also. Besser speichert man das Geburtsjahr und leitet das Alter ab.
- **Taillenumfang, WHtR, FFMI:** fehlen. `MeasurementEntry.kind` kennt nur `body_fat`, ist aber erweiterbar (`waist`).
- **Körperfett-Methoden:** Heute gibt es nur „Wert + gemessen/geschätzt“. Die vier Methoden sind festzulegen (siehe offene Fragen).
- **Trainingspause** („aktuell pausiert?“): fehlt.
- **Erfahrungsstufe aus Jahren, Pause und FFMI:** Heute nur aus Jahren und Freihantel-Sicherheit (`experienceFrom`).
- **Aktuelle Arbeitsgewichte:** fehlen. Sinnvoll als erste Workout-Vorschläge (`progression.prescribe` nutzt heute nur die Historie).
- **Cardio-Option je Ziel:** Teilweise vorhanden (Programm „Kraft + Ausdauer“, `cardioRule`), aber ohne eigene Onboarding-Frage.
- **Split-Vorschau zum Anpassen:** Vorhanden ist `programPreview`. Es fehlt das Anpassen einzelner Tage vor dem Bestätigen.
- **Sicherheit:** Schwangerschaft und Stillzeit gibt es nicht. „Unter 18“ und Untergewicht gibt es nur in der Engine (`SAFETY_THRESHOLDS`), nicht im Onboarding.
- **Konstanten:** Heute gibt es mehrere Konstanten-Objekte (`NUTRITION_RULES`, `SAFETY_THRESHOLDS`, `ACTIVITY_BASE` …), aber ohne Quellenangaben, und Faktoren direkt im Code (`goalFactor`, `proteinPerKg`). Die Grundregel verlangt eine zentrale Datei mit Quellen.
- **Fortsetzen:** Es gibt keinen gespeicherten Fortschritt. Im Profil gibt es Einzel-Sheets (`goal`, `body`, `nutrition`, `training`, `water`, `budget`, `schedule`), aber keinen Weg „Bereich A erneut durchlaufen“.

### Zusätzliche Lücken aus den Prompts 2–8

| Prompt | Lücke im heutigen Code |
|---|---|
| 2 | Alltagsfaktoren heute `ACTIVITY_BASE` 1,25 / 1,35 / 1,45 / 1,6 + 0,04 je Trainingstag. Prompt 2 verlangt 1,2 / 1,375 / 1,5 / 1,65 + Trainingsaufschlag ohne Doppelzählung. Katch-McArdle fehlt. |
| 3 | Makros heute: Fett ≥ 25 % und ≥ 0,8 g/kg; Protein fest 2,0 bzw. 1,8 g/kg (max. 220 g). Prompt 3: Fett ≥ 20 %, Protein 1,6–2,2 g/kg, bei hohem KFA auf Basis FFM/Zielgewicht. Kalorienuntergrenze heute max(Grundumsatz × 1,1; 1500/1200). Zahlenfreier Modus fehlt (kcal-Zahlen erscheinen in vielen Screens). Prognose als Zeitraum fehlt. |
| 4 | Mahlzeiten 2–5 inkl. „Snack 2“: `MealSlot` kennt nur 4 Slots (kein zweiter Snack). Kochzeit ≤ 15 / ≤ 30 / ≤ 45 / egal, getrennt für Werktag und Wochenende: `TimeBudget` hat nur `low` (15 min) / `normal` (35 min) / `high`. Budget günstig / mittel / egal: heute ein CHF-Betrag (`weeklyBudgetChf`) und `PlanPriority 'save'`. Weitere Ausschlüsse Schwein und Alkohol: keine Tags, der Katalog enthält heute beides nicht (aber eigene und gescannte Produkte können es enthalten). Freitext-Ausschlüsse mit Katalogabgleich fehlen. Eine Machbarkeitsprüfung (genug Rezepte pro Slot) fehlt. |
| 5 | „Auslassen – Tageswerte verteilen sich auf die übrigen“ widerspricht dem heutigen „Entfernt“ (`removedSlots`, Anteil bleibt reserviert, siehe Vorschlag V4). Ein Protein-Ausgleich bei Auswärts-Slots fehlt. Art und Größe des Auswärtsessens fehlen. Die Heute-Karte „Wie geplant gegessen“ fehlt. |
| 6 | Salz und Pfeffer gibt es im Katalog nicht (Öl ja). Füllstand voll/halb/Rest, MHD, „Barcode später auflösen“ und die gemerkte Zuordnung Barcode → Katalog-Lebensmittel für den Vorrat fehlen (heute nur über `ProductPurchaseSheet` im Einkauf). |
| 7 | Gelenkbelastung nur ja/nein (`AREA_LOAD`). Eine Körperkarte als SVG gibt es nicht. Einstiegs-Satz für das Startgewicht fehlt (`prescribe` liefert ohne Historie „Erstes Mal – wähle ein Gewicht“). |
| 8 | Die Programme sind kuratiert (`PROGRAMS`), es gibt keinen Generator. Eigene Programme und Routinen gibt es (`customPrograms`, `routines`), damit kann ein generierter Plan in die bestehende Rotation, ohne zweite Logik. |

---

## Entscheidungen (01.10.2026)

Antworten auf die offenen Fragen aus Prompt 0 (E1–E14) und auf das Katalog-Review aus Prompt 3b (E15–E23, 02.10.2026). Sie gelten für alle folgenden Sessions und gehen bei Widersprüchen dem übrigen Plan vor.

| # | Thema | Entscheidung |
|---|---|---|
| E1 | Prompts | `docs/ONBOARDING_PROMPTS.md` ist maßgeblich für Inhalt und Reihenfolge. Meine Risikohinweise und der Aufwand fürs Katalog-Taggen sind in die passenden Prompts eingearbeitet (Abschnitt e). Technisch bessere Aufteilungen stehen als **Vorschläge** in Abschnitt g und werden nicht stillschweigend umgesetzt. |
| E2 | Geschlecht „keine Angabe“ | Grundumsatz mit dem Mittelwert der Mifflin-Konstanten (**−78**), angezeigt als **Bereich** zwischen männlicher und weiblicher Berechnung. Kalorienuntergrenze die vorsichtigere: **1'500 kcal**, zusätzlich nie unter dem Grundumsatz. Ist der Gesamtumsatz so tief, dass kaum ein Defizit möglich ist, wird **„Halten“** empfohlen, mit dem Hinweis, dass die Angabe des Geschlechts die Berechnung genauer macht. |
| E3 | Körperfett-Methoden | **Keine Schätzung aus dem BMI.** Die vier Methoden: (a) eigener Messwert, (b) Navy-Formel mit Massband, (c) RFM aus Taille und Größe, (d) visuelle Schätzung als Bereich. Formeln laut Prompt 2. **Ohne jede KFA-Angabe wird kein KFA-Wert erfunden.** Die Zielempfehlung nutzt dann WHtR/RFM oder BMI + Erfahrung mit Sicherheit „niedrig“ (Prompt 3). Hinweis: RFM braucht die Taille; „nur Taille“ ohne KFA-Wert heißt, die Empfehlung stützt sich auf WHtR. |
| E4 | Schwangerschaft/Stillzeit | **Defizit gesperrt und Ziel fest auf „Halten & Gesundheit“**; andere Ziele sind nicht wählbar, solange die Angabe aktiv ist. Kein Mehrbedarf berechnet, stattdessen Verweis auf Hebamme oder Arzt. Der **zahlenfreie Modus** wird als Option angeboten. Die Angabe wird **alle 3 Monate** dezent nachgefragt („Gilt das noch?“). |
| E5 | Allergen-Migration | Immer die **strengere Auslegung**: altes „Nüsse“ → **Erdnüsse + Schalenfrüchte**. **Laktoseintoleranz und Milcheiweißallergie getrennt.** Altes „Laktose“ bleibt Laktoseintoleranz; ein unklarer Milch-Eintrag wird Milcheiweißallergie. Umgedeutete Werte bekommen **`source: 'migrated'`** (Typ erweitert) und werden beim nächsten Öffnen **einmal zur Bestätigung** gezeigt. Test: Nach der Migration ist **kein Lebensmittel erlaubt, das vorher ausgeschlossen war**. |
| E6 | Katalog-Taggen | Erlaubt, mit Freigabe-Schritt: zuerst **`docs/CATALOG_TAGS_REVIEW.md`** (eine Tabelle pro Eintrag mit allen Tags und der Spalte „unsicher“ + Begründung), übernommen wird **erst nach Freigabe**. Allergene **im Zweifel taggen, nie weglassen**. Makro-Kategorie als **Hybrid**: berechnet aus dem dominanten Kalorienanteil + optionales Override; **mehrere Kategorien erlaubt** (z. B. Hülsenfrüchte: Protein + Kohlenhydrate); berechnete Kategorien stehen ebenfalls in der Review. **Fleisch, Fisch, Krebstiere, Weichtiere getrennte Tags.** **Transportfähig und Meal-Prep für alle Rezepte neu bewerten.** Gelenkbelastung bei Übungen als **Stufe 0/1/2** pro Gelenk (keine/gering/hoch), damit Beschwerden zu einer gelenkschonenderen Alternative führen statt nur zum Entfernen. |
| E7 | Vorlieben, Wochenraster | Vorlieben für **einzelne Lebensmittel**, optisch gruppiert nach Protein / Kohlenhydrate / Fette, mit **Schnellaktion pro Untergruppe** (z. B. „alle Milchprodukte 👎“). Das Wochenraster ist eine **wiederkehrende Vorlage**; einzelne Wochen können im Planer abweichen, ohne die Vorlage zu ändern (Prompt 5). |
| E8 | Altes Onboarding | Bleibt aktiv; das neue entsteht hinter einem internen Schalter (**`?onboarding=v2`**, nur im Dev-Modus). Die **Migration auf Version 3** muss mit dem weiter aktiven alten Onboarding funktionieren und **idempotent** sein. Wer das alte Onboarding abgeschlossen hat, sieht das neue nicht noch einmal, bekommt nach dem Umstieg aber eine **dezente, wegklickbare Karte „Neue Angaben ergänzen“** (KFA, Wochenraster, Vorrat …). **Entfernen des alten Onboardings samt Schalter gehört zu Prompt 9.** |
| E9 | Katalog-Review (V1) | Eigene Session **Prompt 3b** zwischen Prompt 3 und 4, wörtlich in `docs/ONBOARDING_PROMPTS.md` eingefügt. Sie umfasst **Lebensmittel, Rezepte und Übungen** (Gelenkstufen 0/1/2) in **einem** Review (`docs/CATALOG_TAGS_REVIEW.md`). Phase 2 (Übernahme in `src/data`) erst nach ausdrücklicher „Freigabe“. Die Gelenkstufen sind damit **nicht** mehr Teil von Prompt 7; dort werden sie nur genutzt. |
| E10 | Eine Energieberechnung (V2) | Die Alltagsfaktoren aus Prompt 2 **ersetzen** die bisherige Berechnung in `calculateTargets` (`ACTIVITY_BASE` + 0,04 je Trainingstag entfällt). **Bestehende Zielversionen sind Snapshots und bleiben unverändert.** Eine neue Version entsteht nur durch eine Neuberechnung, die der Nutzer **bestätigt**. Test: alte Zielversionen sind nach Migration und Neuberechnung **bytegleich**. |
| E11 | Makros und Untergrenzen (V3) | Die Makroregeln aus Prompt 3 ersetzen `macrosForCalories` und die festen Protein-Faktoren. **Kalorienuntergrenze = max(Grundumsatz × 1,1; 1'200 kcal w / 1'500 kcal m / 1'500 kcal „keine Angabe“).** Zusätzlich **Defizit maximal 25 % des Gesamtumsatzes**. Die strengste Regel gewinnt. **Schwangerschaft/Stillzeit und unter 18 gehen allen anderen Regeln vor.** Alles in der Konstanten-Datei mit Quellenkommentar. |
| E12 | „Auslassen“ vs. „Entfernt“ (V4) | Zwei getrennte Zustände. **„Auslassen“** (Wochenvorlage, geplant, z. B. Intervallfasten): Der Anteil wird auf die übrigen Mahlzeiten des Tages **verteilt**. **„Entfernt“** (spontan im Planer, heutiges Verhalten): Der Anteil **bleibt reserviert**, weil der Nutzer vermutlich etwas anderes isst. Beim Entfernen im Planer zeigt der Undo-Toast zusätzlich die Aktion **„Auf andere Mahlzeiten verteilen“**. Die UI-Bezeichnungen machen den Unterschied klar. |
| E13 | Snack 2 und Kochzeit (V5) | Beides in **Prompt 4**. **Die Minutenwerte der Rezepte sind die Wahrheit**; die UI-Stufen sind ≤ 15 / ≤ 30 / ≤ 45 / egal. **Bestehende Einstellungen werden auf die nächste strengere Stufe migriert**: `low` (15 min) → ≤ 15, `normal` (35 min) → ≤ 30. **„Viel Zeit“ (`high`) → ≤ 45, falls die alte Stufe eine Obergrenze hatte; nur ohne Obergrenze → egal.** In Prompt 4 anhand des alten Codes prüfen (Stand 01.10.2026: `TIME_BUDGETS.high.maxPrepMin = Number.POSITIVE_INFINITY`, also ohne Obergrenze → egal). |
| E14 | Zahlenfreier Modus (V6) | In **Prompt 3** werden **Heute und Ernährung** zahlenfrei. **Alle übrigen Screens** (Fortschritt, Wochenstatistik, Engine-Texte, Einkauf, Zusammenfassung) ziehen **spätestens in Prompt 9** nach, **bevor der Schalter fällt** (Checkliste Prompt 9). Bis dahin bleibt die Option hinter dem v2-Schalter. |
| E15 | Spuren (Review 3b) | Eigenes Feld **`traces`**, getrennt von den Allergenen: Erdnussbutter → Schalenfrüchte; Proteinriegel → Erdnüsse, Schalenfrüchte; Vollkorntoast → Sesam, Soja. Der Filter schließt Spuren **standardmäßig mit aus**. In Prompt 4 bekommt jedes gewählte Allergen den Schalter **„Spuren sind für mich okay“**. |
| E16 | Vorlieben-Gruppen | **„Gemüse & Obst“** ist die vierte Gruppe bei den Vorlieben (per Override). **Würze** (Sojasauce, Salz, Pfeffer) erscheint nicht bei den Vorlieben; ihre Allergene werden weiterhin gefiltert. |
| E17 | Alkohol | Untertyp `alcohol: 'fermentation' \| 'added'`; Sojasauce = `fermentation`. Der Ausschluss „Alkohol“ schließt standardmäßig **beides** aus. Der Schalter **„Alkohol aus Fermentation ist für mich okay“** lockert das. |
| E18 | Meal-Prep | Die Reste-Logik nutzt **alle 14 Meal-Prep-Rezepte**, aber **nur bei „Ich koche gern vor“**. Neue Nutzer: Standard nein. Bestandsnutzer: ja mit `source: 'migrated'` und **einmaliger Bestätigung** samt kurzer Erklärung (umgesetzt in 3b als Heute-Karte hinter `?onboarding=v2`). Keine Legacy-Liste der 5 alten Rezepte. |
| E19 | Salz und Pfeffer | Grundvorrat-Einträge **und** Zutat, wo ein Rezept sie braucht. Als Grundvorrat stehen sie nur auf der Einkaufsliste, wenn sie im Vorrat **als leer markiert** sind. (Umsetzung 3b: gilt ebenso für Currypulver und Essig; im Planer kein Einkauf, keine Kosten, kein „neues Lebensmittel“.) |
| E20 | Laktose | Gouda bei Laktoseintoleranz erlaubt (Laktose „gering“), Feta bleibt ausgeschlossen; dieselbe Regel gilt für künftige gereifte Hartkäse. **Austausch statt Ausschluss:** laktosefreie Varianten von Milch, Magerquark, Skyr, griechischem Joghurt (gleiche Nährwerte, Milch-Allergen bleibt). Bei Laktoseintoleranz bleiben Rezepte erlaubt, die Einkaufsliste nimmt die Variante; bei Milcheiweißallergie kein Austausch. Reine, getestete Funktion (`catalogTags.substituteFood`). |
| E21 | Übungs-Verknüpfungen | overhead-press und machine-shoulder-press → lateral-raise, face-pull, rear-delt-fly; kb-swing (Hüfte) → glute-bridge. **Mobility-Übungen nie als Alternative für Kraftübungen.** Keine echten Lücken → keine neuen Übungen. |
| E22 | Beschwerden in zwei Stufen (Prompt 7) | **„leicht“** ersetzt Übungen mit Stufe 2 am betroffenen Gelenk, **„deutlich“** ersetzt Stufe ≥ 1. Bestandsnutzer mit Beschwerden werden auf **„deutlich“** migriert (keine der 11 Übungen aus Review Teil 4 fällt für sie weg). **Hüfte** kommt in die Liste der Beschwerden. Test: Für jede Kombination aus zwei betroffenen Gelenken gibt es pro Hauptmuskel eine Alternative unter der Schwelle an **beiden** Gelenken; sonst wird eine Lücke gemeldet (Hinweis im UI statt stilles Entfernen). |
| E23 | Weitere Korrekturen | Whey + Soja (Sojalecithin); Proteinriegel Fruktose „ja“ (Zuckeralkohole); Hafer ist nach LMIV selbst glutenhaltiges Getreide. Transportfähig dreistufig `'yes' \| 'chilled' \| 'no'`, Skyr-Bowl und Quark mit Beeren = gekühlt, „Mitnehmen“ zeigt dann „Kühlung nötig“ (Prompt 5). Versteckte Zutaten in Titeln/Zubereitung ergänzt (Liste im Review, Phase 2). 55 Übungen statt 61. Backlog: siehe unten. „Mag ich nicht“ wird mit Prompt 4 weich; Test: ein 👎-Lebensmittel erscheint nur ohne Alternative. |

---

## c) Datenmodell (angepasst an E2–E8)

### Grundbaustein

```ts
/** Where a value came from – the UI can say "geschätzt", "Standardwert" or "bitte bestätigen". */
type FieldSource = 'user' | 'estimated' | 'default' | 'migrated';
interface Field<T> {
  value: T;
  source: FieldSource;
  updatedAt: string; // ISO
  /** 'migrated' values: when the user confirmed them (then source becomes 'user'). */
  confirmedAt?: string;
}
```

### `OnboardingProfile` (neu, `AppState.onboarding`)

```ts
interface OnboardingProfile {
  version: 1;
  mode?: 'quick' | 'full';
  progress: {
    step?: OnboardingStepId;                                 // resume here
    completed: Partial<Record<'A' | 'B' | 'C', string>>;     // ISO when finished
    skipped: OnboardingStepId[];
    finishedAt?: string;
    /** Finished via the old onboarding – no new run, only the "Neue Angaben ergänzen" card (E8). */
    legacy?: true;
  };
  body: {
    weightKg?: Field<number>;
    heightCm?: Field<number>;
    birthYear?: Field<number>;
    sex?: Field<'male' | 'female' | 'unspecified'>;
    trainingExperience?: Field<'never' | 'lt1' | '1to2' | '3to5' | 'gt5'>;
    trainingPaused?: Field<boolean>;                         // > 3 months
    activity?: Field<ActivityLevel>;                         // 4 levels, see Prompt 2
    waistCm?: Field<number>;
    neckCm?: Field<number>;
    hipCm?: Field<number>;
    bodyFat?: Field<{ method: 'measured' | 'navy' | 'rfm' | 'visual'; percent: number; range: [number, number] }>;
  };
  health: {
    pregnancy?: Field<'no' | 'pregnant' | 'breastfeeding'>;  // re-asked every 3 months (E4)
    numberFree?: Field<boolean>;                             // zahlenfreier Modus
  };
  goal: {
    type?: Field<'fat_loss' | 'recomp' | 'muscle_gain' | 'maintain'>;
    pace?: Field<'gentle' | 'normal' | 'brisk'>;
    targetWeightKg?: Field<number>;
    targetBodyFat?: Field<number>;
    overrides?: Field<Partial<Macros>>;
  };
  food: {
    diet?: Field<'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan'>;
    allergens?: Field<LmivAllergen[]>;                       // 14 nach LMIV
    intolerances?: Field<Array<'lactose' | 'fructose' | 'celiac'>>;
    exclusions?: Field<Array<'pork' | 'alcohol'>>;
    customExclusions?: Field<string[]>;                      // Freitext, gegen den Katalog abgeglichen
    preferences?: Field<Record<string /* foodId */, 'like' | 'dislike'>>; // neutral = fehlt
    meals?: Field<MealSlot[]>;                               // 2–5, siehe Vorschlag V5 (Snack 2)
    cookingTime?: Field<{ weekday: CookingTime; weekend: CookingTime }>; // '15' | '30' | '45' | 'any'
    mealPrep?: Field<boolean>;
    householdSize?: Field<number>;
    budget?: Field<'low' | 'medium' | 'any'>;
    weekTemplate?: Field<Record<Weekday, Partial<Record<MealSlot, SlotPlan>>>>;
  };
  training: {
    level?: Field<Experience>;                               // estimateTrainingLevel, überschreibbar
    workingWeights?: Field<Record<string /* exerciseId */, { kg: number; reps: number }>>;
    weekdays?: Field<number[]>;
    sessionMinutes?: Field<30 | 45 | 60 | 75>;
    equipment?: Field<EquipmentItem[]>;
    complaints?: Field<{ areas: BodyArea[]; note?: string }>;
    cardio?: Field<{ kind: 'none' | 'steps' | 'zone2' | 'hiit' | 'mix'; types: CardioType[] }>;
    focusMuscles?: Field<MuscleGroup[]>;                     // max. 2
    plan?: Field<{ programId: string; weekdays: number[] }>; // aus Prompt 8
  };
  /** One-time hints: confirmation of migrated values, the "Neue Angaben ergänzen" card (dismissed until …). */
  notices?: { confirmMigrated?: string; completeCard?: { dismissedUntil?: string } };
}

type SlotPlan =
  | { kind: 'home' }
  | { kind: 'togo' }
  | { kind: 'out'; place?: 'canteen' | 'restaurant' | 'friends'; size?: 'small' | 'normal' | 'large' }
  | { kind: 'skip' };
```

**Eine Quelle der Wahrheit:** `OnboardingProfile` speichert die **Antworten** samt Herkunft. Die rechnenden Werte bleiben in den bestehenden Strukturen (`profile`, `goal`, `nutritionProfile`, `training`, `targets`, `plannerSettings`, `dayContexts`, `pantry`, `measurements`). Eine reine Funktion `applyOnboarding(state, profile) → AppState` überträgt die Antworten. Es gibt keine zweite Berechnungslogik.

### Migration (`schemaVersion` 2 → 3, idempotent, E5 + E8)

- **Wann:** `loadState` erkennt `schemaVersion === 2` (und v1 über v2). `migrateToV3` ist eine **reine, idempotente** Funktion. Ein zweiter Lauf ändert nichts, und sie läuft nach jedem Laden erneut (wie `migrateLegacy`), damit Daten, die das **weiter aktive alte Onboarding** schreibt, ebenfalls übernommen werden.
- **Kernwerte aus Bestandsdaten:**
  - `profile.age` → `birthYear` (`estimated`)
  - Geschlecht, Größe, Aktivität, Trainingsprofil, Slots, Budget → `user`
  - Körperfett aus `measurements` → `bodyFat` (`measured` oder `visual`)
- **Allergene (E5):** `nuts` → `peanuts` + `tree_nuts`; `lactose` → Unverträglichkeit `lactose`; `fish` → `fish`; `gluten` → `gluten`. Alle umgedeuteten Werte bekommen `source: 'migrated'`. Die alten Werte in `nutritionProfile.excluded` werden erst ersetzt, wenn die Filter die neuen Tags kennen (Prompt 4). Bis dahin bleiben beide bestehen, und der Filter nimmt die Vereinigung.
- **Fertige Nutzer:** `progress.finishedAt = profile.createdAt`, `legacy: true` → kein neuer Durchlauf, nach dem Umstieg die Karte „Neue Angaben ergänzen“ (E8).
- **Halb fertige Nutzer:** Start beim ersten fehlenden Bereich, vorhandene Werte vorbelegt.
- **Schreiben** erst bei der nächsten Änderung, Laden schreibt nie. **Beschädigte Daten** → `lifefit:corrupt-backup` wie bisher. Ein kaputtes `onboarding`-Feld wird aus den Kerndaten neu abgeleitet, ohne Verlust der Kerndaten.
- **Tests:**
  - v1 → v3; v2 fertig / halb fertig / leer → v3
  - Idempotenz (`migrate(migrate(x)) === migrate(x)`)
  - altes Onboarding nach der Migration abgeschlossen → Werte übernommen
  - kaputtes JSON, unbekannte Version, kaputtes `onboarding`
  - **kein vorher ausgeschlossenes Lebensmittel ist danach erlaubt** (über den ganzen Katalog)

---

## d) Integrationspunkte (Eingabe → konsumierende Funktion)

| Eingabe | Konsument in `src/domain` |
|---|---|
| Gewicht | `weights` (Startwert), Grundumsatz/Gesamtumsatz (neu `body/energy`), `calorieFloor`, `water.waterStartValue`, `progress.*`, Engine `bodyRateRule` |
| Größe, Geburtsjahr, Geschlecht | neu `body/analysis` (BMI, WHtR, RFM, Navy, FFMI), `body/energy` (Mifflin, bei „keine Angabe“ −78 als Bereich), `engine/guardrails.computeSafety` |
| Erfahrung, Pause | `estimateTrainingLevel` (Prompt 7, ersetzt/erweitert `trainingProfile.experienceFrom`), `trainingRules.weeklyCap`, Plan-Generator |
| Alltagsaktivität | `body/energy` (Faktoren 1,2 / 1,375 / 1,5 / 1,65, siehe V2) |
| Taille, Hals, Hüfte | `body/analysis` (WHtR, Navy, RFM), `measurements` (`kind: 'waist'`) |
| Körperfett | `body/analysis.ffmi`, `body/energy` (Katch-McArdle bei a/b, Mittelwert bei c/d), `recommendGoal`, `estimateTrainingLevel` |
| Schwangerschaft/Stillzeit, Alter < 18 | `recommendGoal` (nur „Halten & Gesundheit“), `computeSafety` (Safe-Mode), Nachfrage alle 3 Monate |
| Zahlenfreier Modus | Anzeige-Schicht (kcal → Portionen/Ringe), siehe V6 zum Umfang |
| Ziel, Tempo, Zielgewicht/-KFA | `recommendGoal`, `calorieTarget` (7'700 kcal/kg), `macroTargets`, `targets` (versioniert), `planRules.bodyRateRule` (Zielband), Prognose als Zeitraum |
| Ernährungsform (inkl. pescetarisch), Allergene, Unverträglichkeiten, Schwein/Alkohol, Freitext | `nutrition.foodAllowed` / `recipeAllowed` (harter Filter vor dem Scoring), `planner`, `cookable`, `suggestProteinFoods`, Einkaufsliste, Vorrat-Markierung (Prompt 6), Machbarkeitsprüfung |
| Vorlieben pro Lebensmittel | `preferences.plannerAffinity` / Planer-Scoring (Gewichte in den Konstanten) |
| Mahlzeiten | `nutritionProfile.slots` → Planer, `schedule`, `dayGoals` |
| Kochzeit Werktag/Wochenende | Standard für `dayContexts.timeBudget` je Wochentag (V5) |
| Meal-Prep | Planer bündelt (`MEAL_PREP_TAG` → typisiertes Merkmal, `LEFTOVER_DAYS`) |
| Haushaltsgröße | `buildShoppingList` / `weekShopping` / `costs` (Mengen × Personen; Nährwerte unverändert) |
| Budget | `plannerSettings.priority` (`'save'` bei „günstig“) und optional `weeklyBudgetChf` |
| Wochenvorlage | `planMeals` beim Anlegen einer Woche: Auswärts → `mode`/reserviertes Budget, Auslassen → Anteil auf die übrigen Mahlzeiten verteilen (E12), Mitnehmen → nur transportfähige Rezepte; Wochen-Abweichung in `dayContexts`, Vorlage unverändert |
| Grundvorrat-Checkliste | `pantry.setPantryQuantity` (Füllstand → Menge), `basics` (Mindestmengen, Grundvorrat-Flag) |
| Barcode-Serienmodus | `services/productLookup` + `pantry.addToPantry`, Zuordnung Barcode → foodId gemerkt (`products`) |
| Arbeitsgewichte | Startwerte für `adaptive/progression.prescribe` (sonst Einstiegs-Satz) |
| Tage, Dauer, Equipment, Beschwerden, Fokus, Cardio | Plan-Generator (Prompt 8) → eigenes Programm (`customPrograms`/`routines`) → bestehende Rotation; `alternativesFor` mit Gelenkstufen; `cardioRule`; Trainingsaufschlag im Gesamtumsatz |
| Abschluss | `completeOnboarding` → `fillWeek` → `weekShopping`; `onboarding/trace.ts` + `docs/ONBOARDING.md` (Prompt 9) |

---

## e) Umsetzungsreihenfolge (nach `docs/ONBOARDING_PROMPTS.md`) mit Risiken

Reihenfolge: **1 → 2 → 3 → 3b → 4 → 5 → 6 → 7 → 8 → 9 → (10)**. Nach jeder Session sind `npm run typecheck` und `npm test` grün, das neue Onboarding bleibt bis Prompt 9 hinter `?onboarding=v2`.

| Prompt | Inhalt (laut Prompt-Datei) | Ergänzungen aus diesem Plan | Risiken |
|---|---|---|---|
| 1 | Grundgerüst: `OnboardingProfile`, Store-Aktionen, Migration mit Version, Flow-Logik, UI-Rahmen, Fortsetzen, Einstieg pro Bereich im Profil, Platzhalter | `source` inkl. `'migrated'`; Migration v3 idempotent und parallel zum alten Onboarding (E8); neues Onboarding nur über `?onboarding=v2` (Dev); Allergen-Migration (E5) als reine Funktion schon hier, die Filterumstellung erst in Prompt 4; Test „kein vorher ausgeschlossenes Lebensmittel ist danach erlaubt“ | Fertige Nutzer dürfen das Onboarding nicht erneut sehen; beide Onboardings schreiben dieselben Kerndaten |
| 2 | Körperdaten, Analyse (BMI, WHtR), Körperfett (4 Methoden), FFM/FFMI, Grundumsatz, Gesamtumsatz | Zentrale Konstanten-Datei mit Quellen anlegen; „keine Angabe“ als Bereich (E2); kein KFA ohne Angabe, keine BMI-Schätzung (E3); Silhouetten selbst als SVG; **E10:** die neuen Alltagsfaktoren ersetzen `ACTIVITY_BASE` in `calculateTargets`, Test: alte Zielversionen bytegleich | Bestandsnutzer: neue Formel wirkt erst bei bestätigter Neuberechnung; prüfen, ob die Engine (`bodyRateRule`) den Startwert sauber übernimmt |
| 3 | Gesundheits-Check, `recommendGoal`, Guardrails, Tempo, Kalorien & Makros, Prognose | **E11:** Makroregeln ersetzen `macrosForCalories`; Untergrenze max(BMR × 1,1; 1'200 w / 1'500 m / 1'500 keine Angabe), Defizit ≤ 25 % des Gesamtumsatzes, strengste Regel gewinnt; Schwangerschaft/Stillzeit und < 18 gehen vor (E4: nur „Halten & Gesundheit“, Nachfrage alle 3 Monate); E2 (Halten bei geringem Spielraum); **E14:** zahlenfreier Modus für **Heute und Ernährung** | Abstimmung mit `SAFETY_THRESHOLDS`/Safe-Mode (eine Regel, keine zweite) |
| **3b** | **Katalog taggen & Review** (neu, E9): Phase 1 `docs/CATALOG_TAGS_REVIEW.md` für 51 Lebensmittel (+ neue Grundvorrat-Einträge wie Salz, Pfeffer), 24 Rezepte (abgeleitete Allergene/Tierarten, Kochzeit, transportfähig, Meal-Prep, Haltbarkeit) und 55 Übungen (Gelenkstufen 0/1/2 für Schulter, Knie, unteren Rücken, Handgelenk, Ellbogen, Alternativen-Lücken), Liste geänderter Filterwirkungen; **STOPP bis „Freigabe“**; Phase 2 Übernahme + Tests | Makro-Kategorie als Hybrid (berechnet + Override, mehrere erlaubt, E6); Allergene im Zweifel taggen; Fleisch/Fisch/Krebstiere/Weichtiere getrennt | **Größter Datenaufwand**; Tierart „Fisch“ statt „Fleisch“ verändert vegetarisch/pescetarisch-Filter (in Phase 1 auflisten); fehlende schonende Alternativen für Übungen mit Stufe 2 |
| 4 | Ernährungsform, harte Ausschlüsse (14 LMIV + Unverträglichkeiten + Schwein/Alkohol + Freitext), Vorlieben, Alltag, Planer-Integration, Machbarkeitsprüfung, Property-Test | Filter nutzen die Tags aus 3b; Allergen-Filterumstellung + einmalige Bestätigung migrierter Werte (E5); Vorlieben pro Lebensmittel, gruppiert, Schnellaktion pro Untergruppe (E7); **E13:** `MealSlot` „Snack 2“; Kochzeit-Stufen ≤ 15 / ≤ 30 / ≤ 45 / egal auf Basis der Rezept-Minuten, Migration `low`→≤ 15, `normal`→≤ 30, `high`→≤ 45 bei Obergrenze, sonst egal (E13; `TIME_BUDGETS.high.maxPrepMin` im alten Code prüfen, heute unbegrenzt); **aus 3b schon vorhanden:** reine Filterfunktion `catalogTags.isExcluded`/`recipeAllowedBy` (Spuren, Alkohol, Zöliakie, Schwein, Ernährungsform, Austausch), Planer-Parameter `mealPrep`; **offen in 4:** UI-Schritte, Umstellung von `foodAllowed`/`recipeAllowed` auf die Tags, Schalter „Spuren okay“ (E15) und „Alkohol aus Fermentation okay“ (E17), Bestätigung der migrierten Allergene (E5), „Mag ich nicht“ weich (E23) | Strenge Filter dürfen keine leeren Wochen erzeugen (Machbarkeitsprüfung); „Snack 2“ berührt Planer, Schedule, Engine, Tagesziele |
| 5 | Wochenraster „typische Woche“ als Vorlage, Auswärts-Budget, Protein-Ausgleich, Heute-Karte | Vorlage + Wochen-Abweichung über das bestehende `dayContexts`/`excludedSlots` erweitern (pro Slot statt nur Abendessen), keine zweite Slot-Logik; **E12:** „Auslassen“ (Vorlage) verteilt den Anteil auf die übrigen Mahlzeiten, „Entfernt“ (spontan im Planer) hält ihn reserviert; Undo-Toast beim Entfernen mit Aktion „Auf andere Mahlzeiten verteilen“; UI-Texte machen den Unterschied klar; Test: Wochen-Override ändert die Vorlage nicht | Bestehende `removedSlots` bleiben „Entfernt“ (Migration nicht nötig); transportfähige Rezepte evtl. weiterhin knapp (Ergebnis aus 3b) |
| 6 | Grundvorrat-Checkliste, Barcode-Serienmodus, Vorrat-Bevorzugung, MHD, Ausschluss-Markierung | Grundvorrat-Flags und neue Einträge (Salz, Pfeffer) kommen aus 3b; Zuordnung Barcode → Lebensmittel gemerkt; bestehende Regel „Vorrat nie aus Gegessenem“ bleibt | Kamera-Rechte/iOS Safari, Offline; Produkte ohne Katalog-Zuordnung wirken nicht auf den Plan (klar sagen) |
| 7 | `estimateTrainingLevel`, Arbeitsgewichte/Einstiegs-Satz, Rahmen, Beschwerden → schonende Alternativen, Cardio je Ziel, Fokus mit SVG-Körperkarte | Beschwerden **nutzen** die Gelenkstufen aus 3b (E9, kein Taggen mehr in dieser Session); Stufe 2 am betroffenen Gelenk → Alternative mit Stufe ≤ 1 für dieselbe Muskelgruppe; `AREA_LOAD` wird durch die Stufen ersetzt; **E22:** Beschwerden zweistufig („leicht“ → Stufe 2 ersetzen, „deutlich“ → Stufe ≥ 1), Bestandsnutzer → „deutlich“, Hüfte in die Liste, Test für alle Gelenk-Paare mit Lücken-Hinweis im UI | Alternativen müssen dieselbe Muskelregion treffen (heute geprüft in `sessionAdapt`) |
| 8 | Plan-Generator, Wochenübersicht mit Tauschen/Ändern, „Warum?“, Übernahme in die Rotation | Generierter Plan als eigenes Programm (`customPrograms`/`routines`) → bestehende Rotation, `planVersions` (Start); Volumen über `muscles.muscleVolume`; Trainingsaufschlag im Gesamtumsatz über die eine Rechnung (E10) | Rotation und Plan-Versionen nicht brechen; Dauer-Schätzung mit `estimateMinutes` vereinheitlichen |
| 9 | Zusammenfassung „Dein Plan“, Heute-Karte für fehlende Angaben, Profil-Änderungen mit Vorher/Nachher, Rückverfolgbarkeit (`docs/ONBOARDING.md`), Personas, Grenzfälle, Doku | siehe **Checkliste Prompt 9** unten | Testlaufzeit (App-Tests heute ca. 50 s) |
| 10 | Feinschliff-Review (optional), erst Funde auflisten, dann nach Freigabe ändern | zxing-wasm dynamisch laden (prüfen, ob schon der Fall) | – |

### Checkliste Prompt 9 (vor dem Entfernen des Schalters)

- [ ] **Zahlenfreier Modus in allen übrigen Screens** (E14): Fortschritt, Wochenstatistik, Engine-Texte, Einkauf, Zusammenfassung. Erst wenn alle nachgezogen sind, darf der Schalter fallen.
- [ ] Jedes Feld des `OnboardingProfile` hat eine Wirkung und einen Test (`docs/ONBOARDING.md`, `onboarding/trace.ts`); kein Feld läuft ins Leere.
- [ ] Personas und Grenzfälle laut Prompt 9 grün (inkl. „keine Angabe“, Alter 17 und 70+, Schwangerschaft, BMI < 18,5).
- [ ] Karte „Neue Angaben ergänzen“ für Bestandsnutzer (E8) = dieselbe Heute-Karte wie für fehlende Angaben (Priorität KFA > Alltagsaktivität > Wochenraster > Vorrat, nach Wegklicken 14 Tage Ruhe).
- [ ] Migrierte Werte (`source: 'migrated'`) wurden zur Bestätigung angeboten (E5).
- [ ] Profil-Änderungen: Vorher/Nachher-Vorschau, neue Zielversion nur nach Bestätigung, alte Versionen bytegleich (E10).
- [ ] **Altes Onboarding (`Onboarding.tsx`) und Schalter `?onboarding=v2` entfernen** (E8). Die App-Tests zum alten Onboarding (ca. 10) werden auf den neuen Flow umgestellt, ohne sie abzuschwächen.
- [ ] `FEATURES.md` neu anlegen, `README.md` aktualisieren.
- [ ] `npm run typecheck`, `npm test`, `npm run build` grün.

---

## f) Grundregeln (gelten für alle folgenden Sessions)

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

Projektkonvention dazu: Das Projekt schreibt **ß** (z. B. „Größe“, „Süßkartoffeln“) und rechnet in **CHF**. Tausender in Texten der Prompts mit Apostroph („1'500“), in der App heute über `fmt.int` mit Punkt („1.500“). Die App-Konvention bleibt bestehen.

---

## g) Vorschläge zur Aufteilung – entschieden

Alle sechs Vorschläge sind angenommen (01.10.2026) und als E9–E14 im Abschnitt „Entscheidungen“ verbindlich; dort stehen auch die Bedingungen. Die Tabelle bleibt als Begründung stehen.

| # | Vorschlag | Warum | Entscheidung |
|---|---|---|---|
| V1 | **Katalog-Review als eigene Session vor Prompt 4** („Prompt 3b“): `docs/CATALOG_TAGS_REVIEW.md` für Lebensmittel, Rezepte **und** die Gelenkstufen der 55 Übungen in einem Durchgang. Übernahme der Lebensmittel-/Rezept-Tags dann zu Beginn von Prompt 4, der Übungs-Tags in Prompt 7. | Prompt 4 braucht deine Freigabe mitten in der Session; mit einem eigenen Review-Schritt bleibt jede Session in sich abschließbar und grün. Ein gemeinsamer Review spart dir einen zweiten Prüfdurchgang. | angenommen → E9 (Prompt 3b, inkl. Übungen) |
| V2 | **Energieberechnung zusammenführen:** Die Faktoren aus Prompt 2 (1,2 … 1,65 + Trainingsaufschlag) **ersetzen** `ACTIVITY_BASE` in `calculateTargets`. Bestehende Zielversionen bleiben unverändert; neue Zielversionen (Onboarding, Profiländerung) nutzen die neue Formel. | Sonst gäbe es zwei Gesamtumsatz-Rechnungen (Grundregel: keine doppelte Logik). | angenommen → E10 (alte Versionen bytegleich) |
| V3 | **Makro- und Untergrenzen-Regeln vereinheitlichen:** Prompt 3 (Fett ≥ 20 %, Protein 1,6–2,2 g/kg) ersetzt `macrosForCalories`. Bei der Untergrenze bleibt die heutige, strengere Regel „Grundumsatz × 1,1“ und wird mit E2 kombiniert: max(Grundumsatz × 1,1; 1'500 m bzw. bei „keine Angabe“; 1'200 w). | Eine Regel für Formel, Onboarding und Engine-Anpassungen. Prompt 3 sagt „nie unter dem Grundumsatz“, die bestehende Regel ist etwas vorsichtiger; ich würde sie behalten. | angenommen → E11 (+ Defizit ≤ 25 %, Schwangerschaft/< 18 vorrangig) |
| V4 | **„Auslassen“ (Prompt 5) und „Entfernt“ (heute) unterscheiden:** Auslassen in der Vorlage = Slot fällt weg, sein Anteil verteilt sich auf die übrigen Mahlzeiten. „Entfernt“ im Wochenplan bzw. auf Heute = bewusst nicht geplant, Anteil bleibt reserviert (aktuelles Verhalten). | Prompt 5 und das heutige Verhalten widersprechen sich; zwei klar benannte Zustände vermeiden Überraschungen. | angenommen → E12 (+ Undo-Aktion „Auf andere Mahlzeiten verteilen“) |
| V5 | **„Snack 2“ und Kochzeit-Stufen:** „Snack 2“ als neuer `MealSlot` (`snack2`) mit Uhrzeit; Kochzeit ≤ 15 / ≤ 30 / ≤ 45 / egal als Standard je Werktag/Wochenende auf die bestehenden `TIME_BUDGETS` abbilden, ergänzt um eine Stufe 30 min. | `MealSlot` ist breit verwendet (Planer, Schedule, Engine); das betrifft viele Dateien und sollte bewusst in Prompt 4 passieren, nicht nebenbei. | angenommen → E13 (Rezept-Minuten sind die Wahrheit, Migration auf strengere Stufe) |
| V6 | **Zahlenfreier Modus schrittweise:** in Prompt 3 Einstellung + Heute/Ernährung (Ring, Chips, Tagesbilanz), weitere Screens in Prompt 9/10. | kcal-Zahlen stehen heute in vielen Screens; alles in Prompt 3 würde die Session sprengen. | angenommen → E14 (übrige Screens spätestens in Prompt 9) |

---

## Backlog

- **Katalog erweitern (E23)** für vegan + Soja-Allergie, vegan + Zöliakie und Zöliakie allgemein. Ziel: ≥ 4 Rezepte pro Mahlzeit (Stand: Machbarkeitstabelle in `docs/CATALOG_TAGS_REVIEW.md`). Dabei glutenfreie Haferflocken prüfen. Neue Rezepte durchlaufen dasselbe Review.
- **Auswärts-Extremtage (aus Prompt 5):** Liegt der grösste Teil der Tagesenergie auswärts (z. B. Kantine mittags + grosses Restaurantessen abends), ist das Protein-Tagesziel mit der Annahme „auswärts proteinarm“ nicht erreichbar (Rest bräuchte > 50 % Protein). Der Planer trifft die Kalorien und verschiebt Protein nach Hause, so weit es geht. Offen: ein Hinweis im UI für solche Tage.
- **Planer „Sparen“ (aus 3b):** Untergrenze 90 % Protein pro Tag als Stufen-Strafe (`PROTEIN_FLOOR`, Gewicht `proteinFloor` nur bei „Sparen“), geprüft an den gerundeten Portionen. Anlass: Durch die neuen Zutaten fiel ein Testtag auf 89,7 %. Bei Bedarf auf andere Prioritäten ausweiten.

## Offene Punkte

- **E13, Auslegung aus Prompt 4 (Rückfrage):** Im alten Code gibt es **keine gespeicherte Kochzeit-Einstellung**, nur Tages-Overrides (`dayContexts`: „Wenig Zeit“ = 15 min, „Viel Zeit“ = ohne Grenze). Diese behalten ihre Bedeutung (≤ 15 bzw. egal). „Normal“ ist jetzt die Kochzeit-Antwort (Werktag/Wochenende); **ohne Antwort bleiben 35 min wie bisher** – Bestandsnutzer werden nicht automatisch auf ≤ 30 gesetzt. Falls doch gewünscht: Migration `cookingTime = { weekday: '30', weekend: '30' }` mit `source: 'migrated'` und einmaliger Bestätigung.

- **Beschwerden im Training-Check (aus Prompt 7):** Beschwerden, die nur beim Start einer Einheit gemeldet werden, gelten als „leicht“ (Stufe 2 wird ersetzt); dauerhafte aus dem Profil behalten ihre Stufe, ältere ohne Stufe gelten als „deutlich“ (E22). Rückfrage: soll „heute gemeldet“ strenger sein?

- **Trainingsaufschlag mit Zusatztagen (aus Prompt 8):** Cardio- und Mobilitätstage, die Anfänger mit 5–6 Tagen statt Krafttagen bekommen, stehen in der Rotation und zählen im Trainingsaufschlag wie Krafteinheiten (Mobilität etwas zu hoch, Zone 2 etwas zu tief). Zone 2/HIIT aus der Cardio-Wahl liegen an Ruhetagen () und zählen über den Cardio-Aufschlag. Offen: getrennte Zählung, falls genauer gewünscht.

Nächster Schritt: **Prompt 9**.
