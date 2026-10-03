# Onboarding – Rückverfolgbarkeit

Jede Eingabe des Onboardings wirkt nachweislich in der App. Diese Datei verfolgt jedes Feld von `OnboardingProfile` (`src/domain/onboarding/types.ts`):

**Eingabe → verarbeitende Funktion(en) → sichtbare Wirkung → Test.**

Grundlagen und Entscheidungen (E1–E23) stehen in [ONBOARDING_PLAN.md](ONBOARDING_PLAN.md), die Arbeitsschritte in [ONBOARDING_PROMPTS.md](ONBOARDING_PROMPTS.md).

## So fließen die Antworten in die App

```
Bildschirm  →  setOnboardingAnswer / setFoodAnswer / setTrainingAnswer   (store/onboardingActions.ts)
               └─ Field<T> { value, source: user | estimated | default | migrated, updatedAt }
                    │
   neues Konto ─────┤  „Los geht’s“ / „Später fortsetzen“: defaultCoreSetup → completeOnboarding
                    │     profile · goal · targets (Version) · weights · measurements · nutritionProfile · training
                    │     + adoptPlan (Trainingsplan) + fillWeek (Wochenplan → Einkaufsliste)
                    │
   laufende App ────┘  sofort: Körper → profile / weights / measurements (mirrorBodyAnswer)
                              Essen → nutritionProfile / plannerSettings (+ Neuplanung verbotener Mahlzeiten)
                              Training → training-Setup (trainingSetupFrom)
                       Tagesziel: nur nach Bestätigung eine neue Zielversion (E10) – „Als neues Tagesziel übernehmen“,
                       im Profil mit Vorher/Nachher-Vorschau und Rückgängig.
```

- **Quelle sichtbar:** Werte mit `estimated` oder `default` sind auf „Dein Plan“ markiert („geschätzt – ergänzen?“). Standardwerte werden nie als Angaben der Person ausgegeben.
- **Fehlende Angaben:** Heute zeigt höchstens eine dezente Karte für die wirksamste fehlende Angabe (Körperfett > Alltagsaktivität > Wochenraster > Vorrat). Nach „Später“ ist 14 Tage Ruhe. Für Nutzer:innen des alten Onboardings ist das die Karte „Neue Angaben ergänzen“ (E8).
- **Schutz:** Unter 18, Schwangerschaft oder Stillzeit bedeuten nur „Halten“ und kein Defizit. Ein BMI unter 18,5 oder sehr wenig Körperfett schließen „Abnehmen“ aus. Das Defizit ist höchstens 25 % des Bedarfs und liegt nie unter der Kaloriengrenze.

## Bereich A – Körper, Gesundheit, Ziel

| Eingabe | Verarbeitet in | Sichtbare Wirkung | Test |
|---|---|---|---|
| `body.weightKg` | `defaultCoreSetup` → `completeOnboarding` (Gewichtseintrag); `mirrorBodyAnswer`; `calculateTargets` | Gewicht unter Fortschritt, Tagesziel, BMI/FFMI auf „Dein Plan“ | `trace.test.ts › body.weightKg`; Personas |
| `body.heightCm` | `defaultCoreSetup` → `profile.heightCm`; `mirrorBodyAnswer`; `applyProfileChange` | Tagesziel, BMI/WHtR auf „Dein Plan“, Profil › Körperdaten | `trace.test.ts › body.heightCm`; `app.test.tsx › Prompt 9 › profile` |
| `body.birthYear` | `defaultCoreSetup` → `profile.age`; `asksPregnancy`; `recommendGoal` (unter 18) | Tagesziel, Schutzregel „Halten“ unter 18, Schwangerschaftsfrage | `trace.test.ts › body.birthYear`; `edgeCases.test.ts › age 17 / age 72` |
| `body.sex` | `profile.sex`; Energieformel (keine Angabe = Mittelwert, E2); `asksPregnancy` | Tagesziel, Schwangerschaftsfrage, Referenzbereiche | `trace.test.ts › body.sex`; `edgeCases.test.ts › sex "keine Angabe"` |
| `body.trainingExperience` | `levelOf` → `estimateTrainingLevel` → `profile.experience`; `recommendGoal` | Zielempfehlung, Trainingsplan (Split, Volumen), Aufbautempo | `trace.test.ts › body.trainingExperience`; `training7.test.ts` |
| `body.trainingPaused` | `recommendGoal` (einsteigerähnlich); Folgefrage `training.pausedLong` | Zielempfehlung, Frage „länger als 6 Monate?“ | `trace.test.ts › body.trainingPaused` |
| `body.activity` | `profile.activity` → `energyEstimate`; `mirrorBodyAnswer`; `applyProfileChange` | Tagesziel; Heute-Karte fragt, solange ein Standardwert gilt | `trace.test.ts › body.activity`; `summary.test.ts › priority` |
| `body.waistCm` | `whtr`, `rfmEstimate`, `recommendGoal` | WHtR auf „Dein Plan“ und in „Deine Werte“, Zielempfehlung | `trace.test.ts › body.waistCm`; `goal.test.ts` |
| `body.neckCm`, `body.hipCm` | `navyEstimate` → `body.bodyFat` | Körperfett-Schätzung (Navy) als Bereich | `trace.test.ts › body.neckCm / body.hipCm`; `app.test.tsx › body fat: four methods` |
| `body.bodyFat` | Messwert `body_fat` (`completeOnboarding`, `mirrorBodyAnswer`); `targetOptionsFor` (Katch-McArdle, Proteinbezug); `levelOf` (FFMI) | Tagesziel, KFA/FFMI-Bereiche auf „Dein Plan“, Heute-Karte verschwindet | `trace.test.ts › body.bodyFat`; `personas.test.ts › after the onboarding` |
| `health.pregnancy` | `recommendGoal` (gesperrt), `calculateTargets` (`pregnant`, kein Defizit), `PregnancyRecheck` | Ziel nur „Halten“, regelmäßige Nachfrage auf Heute | `trace.test.ts › health.pregnancy`; `edgeCases.test.ts › pregnancy` |
| `health.numberFree` | `isNumberFree`, `portionText`, `dayPortions`, `portionKcal`, `withoutKcal`, `numberFreeReport`; `summaryOf`, `previewLines` | Keine kcal-Zahlen: Heute, Ernährung, Fortschritt (Ø Essen in Mahlzeiten), Coach- und Rückblick-Texte, Änderungs-Toasts, Erfassen/Ersetzen/Gerichte/Rezepte, Nährstoff-Auswertung, Profil, „Dein Plan“; manuelles Erfassen über Portionsgröße. Protein in Gramm bleibt (E14) | `trace.test.ts › health.numberFree`; `numberFree.test.ts`; `app.test.tsx › number-free mode (E14)` |
| `goal.type` | `defaultCoreSetup` (Empfehlung, wenn nichts gewählt); `applyGoalAsTarget` | Ziel, Tagesziel, Prognose | `trace.test.ts › goal.type` |
| `goal.pace` | `targetOptionsFor` → `goalCalories` | Höhe von Defizit oder Überschuss, Prognose | `trace.test.ts › goal.pace` |
| `goal.targetWeightKg` | `goal.targetWeightKg` → `goalProgress`, `forecast`, Proteinbezug | Zielfortschritt unter Fortschritt, Prognose | `trace.test.ts › goal.targetWeightKg` |
| `goal.targetBodyFat` | `goalWeightOf` → `goal.targetWeightKg` (wenn kein Zielgewicht) | wie Zielgewicht; Prognose | `trace.test.ts › goal.targetBodyFat` |

## Bereich B – Essen und Einkauf

| Eingabe | Verarbeitet in | Sichtbare Wirkung | Test |
|---|---|---|---|
| `food.diet` | `nutritionProfileFrom` → `hardExclusionsOf` | Wochenplan, Vorschläge, Ersatz ohne Ausgeschlossenes | `trace.test.ts › food.diet`; Persona 1 |
| `food.allergens` | `hardExclusionsOf` (harter Filter, LMIV) | dito; Produkte mit Allergen markiert | `trace.test.ts › food.allergens`; `areaB.test.ts`; Persona 1 |
| `food.tracesOk` | `hardExclusionsOf` (Spuren erlaubt, E15) | Produkte mit „kann Spuren enthalten“ bleiben erlaubt | `trace.test.ts › food.tracesOk`; `catalogTags.test.ts` |
| `food.intolerances` | `hardExclusionsOf`, `usableFood` (laktosefreier Tausch, E20) | Wochenplan mit laktosefreien Varianten | `trace.test.ts › food.intolerances`; `catalogTags.test.ts` |
| `food.exclusions` | `noPork` / `noAlcohol` | kein Schwein / Alkohol im Plan | `trace.test.ts › food.exclusions` |
| `food.fermentationAlcoholOk` | `hardExclusionsOf` (E17) | Sojasauce und Essig bleiben trotz „kein Alkohol“ | `trace.test.ts › food.fermentationAlcoholOk` |
| `food.customExclusions` | `matchCatalog` → `excludedFoods` / `excludedText` | Lebensmittel aus dem Katalog verschwinden, Freitext prüft Produkte | `trace.test.ts › food.customExclusions` |
| `food.preferences` | `likedFoods` / `dislikedFoods` → `foodScorer` (weich, E23) | Gemochtes öfter, Abgelehntes praktisch nie | `trace.test.ts › food.preferences`; Persona 2 |
| `food.meals` | `nutritionProfile.slots` | Mahlzeiten pro Tag im Wochenplan | `trace.test.ts › food.meals` |
| `food.cookingTime` | `plannerSettings.cookingTime` → `maxPrepFor` (E13) | Rezepte passen zur Kochzeit (Werktag / Wochenende) | `trace.test.ts › food.cookingTime`; `areaB.test.ts` |
| `food.mealPrep` | `mealPrepEnabled` → Planer (Bündeln, Aufwärmtage) | Vorkochen-Gerichte an Folgetagen, kürzere Kochzeit | `trace.test.ts › food.mealPrep`; Persona 2 |
| `food.householdSize` | `plannerSettings.householdSize` → `weekShopping` | Mengen auf der Einkaufsliste | `trace.test.ts › food.householdSize`; `areaB.test.ts` |
| `food.budget` | `plannerSettings.priority` („günstig“ → sparen) | Günstigere Rezepte, Budgetzeile | `trace.test.ts › food.budget` |
| `food.weekTemplate` | `nutritionProfile.weekTemplate` → `slotPlanOn`, `planTargetOn`, `fillWeek` | Auswärts: kein Rezept und kein Einkauf, reserviertes Budget; Mitnehmen: nur transportable Rezepte | `trace.test.ts › food.weekTemplate`; `weekTemplate.test.ts`; Personas 1 und 2 |
| Vorrat (Checkliste, Scan) | `PantryItem` (kein Profilfeld) → `weekShopping` | Was zuhause ist, wird von der Einkaufsliste abgezogen | `pantryOnboarding.test.ts`; Persona 1 |

## Bereich C – Training

| Eingabe | Verarbeitet in | Sichtbare Wirkung | Test |
|---|---|---|---|
| `training.level` | `profile.experience` | Split, Volumen, Progression | `trace.test.ts › training.level`; `recommendPlan.test.ts` |
| `training.pausedLong` | `levelOf` (eine Stufe tiefer) | Wiedereinstieg mit weniger Volumen | `trace.test.ts › training.pausedLong` |
| `training.weekdays` | `trainingSetupFrom` → Rotation; Trainingszuschlag | Trainingstage auf Heute und unter Training, Tagesziel | `trace.test.ts › training.weekdays`; Personas |
| `training.sessionMinutes` | `trainingSetupFrom`; Plan-Generator (Zeitbudget); Zuschlag | Einheiten passen in die Zeit, Kürzungen werden genannt | `trace.test.ts › training.sessionMinutes`; `recommendPlan.test.ts › duration`; Persona 1 |
| `training.places` | `placesToItems` → `equipmentItems` | Nur Übungen mit vorhandener Ausrüstung | `trace.test.ts › training.places`; Persona 1 |
| `training.equipment` | migrierte Ausrüstungsliste, gilt ohne `places` | dito | `trace.test.ts › training.equipment` |
| `training.complaints` | `limitations` → `jointLoad`, `gentleAlternative` (E21, E22) | Keine belastenden Übungen, schonende Alternativen | `trace.test.ts › training.complaints`; `recommendPlan.test.ts`; Persona 1 |
| `training.cardio` | `training.cardio`, `cardioDays`, `cardioSurcharge` | Cardio-Tage auf Heute, Zuschlag im Tagesziel | `trace.test.ts › training.cardio`; `planAdopt.test.ts › cardio` |
| `training.focusMuscles` | `musclePriorities` → mehr Volumen im Plan | Schwerpunkt-Muskeln mit mehr Sätzen | `trace.test.ts › training.focusMuscles`; Persona 2 |
| `training.workingWeights` | `workingWeights` → `startWeight` (Epley) | Startgewichte der ersten Einheit | `trace.test.ts › training.workingWeights`; `planAdopt.test.ts › start weights` |
| `training.planDraft` | `currentPlanDraft` → `adoptPlan` | Der bearbeitete Plan (Tage getauscht, Übung ersetzt) wird übernommen | `app.test.tsx › Prompt 8`; Personas |
| `training.plan` | `adoptPlan` (Programm und Routinen der Rotation) | Training und Heute zeigen den Plan; „Los geht’s“ übernimmt ihn nicht doppelt | `planAdopt.test.ts`; `app.test.tsx › Prompt 9 › summary` |

## Rahmen

| Feld | Verarbeitet in | Sichtbare Wirkung | Test |
|---|---|---|---|
| `mode` | `stepsFor` (Schnellstart oder ausführlich) | Anzahl der Schritte | `flow.test.ts` |
| `progress` (Schritt, übersprungen, Bereiche fertig, `returnTo`) | `flowStateOf`, `next`, `editFromSummary` | Fortsetzen am selben Schritt; „Ändern“ auf „Dein Plan“ führt zurück zur Zusammenfassung | `flow.test.ts`; `summary.test.ts`; `app.test.tsx › frame` |
| `notices.completeCard` | `missingHint` | 14 Tage Ruhe nach „Später“ | `summary.test.ts`; `app.test.tsx › Heute card` |

## Entfernte Felder

- `goal.overrides` (manuelle Makros): Das Feld wurde nirgends geschrieben oder gelesen. Manuelle Werte setzt man im Profil unter „Ziel & Kalorien“ (Zielversion mit `method: 'manual'`).
- `notices.confirmMigratedAt`: Das Feld wurde nie geschrieben. Übernommene Werte bestätigt man über `source: 'migrated'` (Bestätigung im jeweiligen Schritt, `MealPrepConfirm` auf Heute).

## End-to-End (Domänen-Ebene)

`src/store/personas.test.ts` spielt drei Personas über dieselben Store-Aktionen wie die Bildschirme durch, bis „Los geht’s“:

1. **Anfängerin, 28 Jahre, 30 % KFA:** vegetarisch, Nussallergie, Mo–Fr mittags auswärts, 3 Tage zuhause mit Kurzhanteln, Knieprobleme.
2. **Erfahrener, 35 Jahre, 13 % KFA:** isst alles, 👎 Fisch, Meal-Prep, Mittag zum Mitnehmen, 5 Tage im Studio, Fokus Schultern.
3. **Schnellstart:** nur das Pflichtminimum.

Geprüft wird bei jeder Persona:
- Ziel und Makros sind plausibel.
- Der Wochenplan enthält nichts Ausgeschlossenes und berücksichtigt die Vorlieben.
- Für Mahlzeiten auswärts gibt es keine Einkaufsposten.
- Der Vorrat wird abgezogen.
- Der Trainingsplan passt zu Tagen, Dauer, Ausrüstung und Beschwerden.

`src/store/edgeCases.test.ts` deckt die Grenzfälle ab: alles übersprungen, extreme Werte, „keine Angabe“, 17 und 72 Jahre, Schwangerschaft, BMI unter 18,5.
