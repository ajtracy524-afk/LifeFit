# LifeFit – Funktionen

Stand: Onboarding abgeschlossen (Prompt 9). Die Rückverfolgung jeder Onboarding-Angabe bis zur sichtbaren Wirkung und zum Test steht in [docs/ONBOARDING.md](docs/ONBOARDING.md).

## Onboarding

- **Zwei Wege:** Schnellstart (Pflichtminimum, ca. 1 Minute) oder ausführlich. „Ohne Angaben starten“ ist ebenfalls möglich. Jeder Schritt hat „Warum fragen wir das?“, „Überspringen“ und „Später fortsetzen“. Die App merkt sich den Schritt und setzt nach einem Neustart dort fort.
- **Bereich A – Körper und Ziel:**
  - Gewicht, Größe, Geburtsjahr, Geschlecht („keine Angabe“ möglich), Krafttrainings-Erfahrung, Alltagsaktivität, Taillenumfang.
  - Körperfett nach Genauigkeit: gemessen, US Navy, RFM oder Bildvergleich, immer als Bereich.
  - Analyse mit BMI, WHtR, KFA und FFMI in neutraler Sprache.
  - Gesundheits-Check: Schwangerschaft/Stillzeit, zahlenfreier Modus.
  - Zielempfehlung mit Begründung, Sicherheitsstufe und „Warum?“, außerdem Tempo, Zielgewicht oder Ziel-Körperfett und eine Prognose als Zeitraum.
- **Bereich B – Essen und Einkauf:**
  - Ernährungsform; die 14 LMIV-Allergene mit Spuren-Option; Unverträglichkeiten (Laktose mit laktosefreiem Tausch, Fruktose, Zöliakie); kein Schwein / kein Alkohol (Gärungsalkohol wählbar); eigene Ausschlüsse als Freitext.
  - Vorlieben 👍/👎, Mahlzeiten pro Tag, Kochzeit werktags und am Wochenende, Meal-Prep, Haushaltsgröße, Budget.
  - Typische Woche pro Mahlzeit: zuhause, mitnehmen, auswärts oder auslassen.
  - Vorrat: Checkliste und Serien-Scan per Barcode.
- **Bereich C – Training:**
  - Erfahrung und Pause, Trainingsniveau (geschätzt, änderbar), Arbeitsgewichte.
  - Tage, Dauer, Trainingsort und Ausrüstung.
  - Beschwerden zweistufig je Gelenk.
  - Cardio, Fokus-Muskeln (Körperkarte).
- **Dein Trainingsplan:** Der Plan-Generator wählt Split, Volumen pro Muskel, Frequenz, Zeit, Ausrüstung und schonende Alternativen bei Beschwerden. Wochenübersicht mit Tauschen, Split-Wechsel, Übungsersatz und „Warum dieser Plan?“ mit Quellen.
- **Dein Plan (Zusammenfassung):**
  - Karten für Körper (Bereiche), Ziel und Tempo mit Prognose, Kalorien und Makros (oder Portionen), Essensrahmen und Trainingswoche.
  - „Ändern“ springt in den Schritt und zurück zur Zusammenfassung. Geschätzte Werte sind markiert („geschätzt – ergänzen?“).
  - „Los geht’s“ erzeugt sofort Wochenplan, Einkaufsliste und Trainingsplan.
- **Nach dem Onboarding:**
  - Auf Heute erscheint höchstens eine dezente Karte für die wirksamste fehlende Angabe (Körperfett > Alltagsaktivität > Wochenraster > Vorrat), nach „Später“ ist 14 Tage Ruhe.
  - Übernommene Werte aus älteren Versionen werden einmal zur Bestätigung angeboten (Ausschlüsse, Meal-Prep).
  - Jeder Bereich lässt sich im Profil erneut öffnen, die Antworten sind vorausgefüllt.

## Heute

- Tagesring, Makros, nächste Aktion (Mahlzeit, Training, Wasser) mit „Gegessen“ in einem Tap.
- Tagesplan in zeitlicher Reihenfolge mit Training, „Warum dieses Gericht?“ und Ersetzen (Vorschlag, Suche, manuell, zuletzt genutzte Ersatzgerichte).
- Wasser in Flaschen, Tagesziele, Aktivität, Tagestyp (Training/Ruhe, Cardio-Tag).
- Coach-Karte der Adaptive Engine, Tagesrückblick („Dein gestriger Tag“), Wochenfortschritt, Nährstoff-Auswertung.
- Schwangerschaft wird regelmäßig nachgefragt („Gilt das noch?“).

## Ernährung

- Wochenplan pro Tag mit Ampel, Budgetzeile in CHF, Auswärts-Budget.
- Erfassen über:
  - Vorschlag oder „Wie gestern“,
  - Suche (eigene Produkte und Gerichte, Katalog, FoodData Central, auf Tap Open Food Facts),
  - Barcode mit Kamera,
  - manuell (nur Kalorien nötig, im zahlenfreien Modus die Portionsgröße).
- Eigene Gerichte aus Zutaten, eigene Produkte mit Packungspreis.
- „Was kann ich kochen?“ aus dem Vorrat.
- Nährstoff-Auswertung mit Referenzwerten (NRV), fehlende Daten werden nie als 0 gezeigt.

## Planung und Einkauf

- Wochen-Autopilot: Check-in → Vorschau → „Woche erstellen“ (Training, Mahlzeiten, Einkauf), mit Rückgängig.
- Kaskade: Training verschieben oder auslassen, wenig Zeit, auswärts essen. Tagesziele, Portionen und Einkauf passen sich an, eine Zusammenfassung erklärt die Änderung.
- Einkaufsliste wird aus dem Plan abgeleitet, abzüglich Vorrat. Grundvorrat wird nachgekauft, Mengen für den Haushalt skaliert, Preise geschätzt (CHF).
- Vorrat mit Füllstand und Mindesthaltbarkeit. Abhaken füllt den Vorrat, Gegessenes leert ihn nicht automatisch.

## Training

- Rotation nach Wochentagen, Programme (auch der eigene Plan aus dem Onboarding), Routinen-Editor, Übungsbibliothek mit Körperkarte.
- Session mit Startgewichten, Progression, Supersätzen und Pausentimer; Anpassung bei Beschwerden am Tag.
- Rekorde, Verlauf, Volumen pro Muskel.

## Fortschritt

- Gewichtstrend (7 Tage), Zielfortschritt und Prognose.
- Wochenstatistik: Ø Kalorien bzw. Ø Essen in Mahlzeiten, Protein, Plan-Treue, Training. Dazu Wasserwoche und Rekorde.

## Profil

- Körperdaten, Ziel und Kalorien, Training: Änderungen zeigen Vorher/Nachher. Die neue Zielversion entsteht erst nach Bestätigung, mit Rückgängig; ältere Versionen bleiben unverändert.
- Ernährung, Budget, Tagesablauf, Wasser-Erinnerungen, „Was LifeFit gelernt hat“ (zurücksetzbar), Export, alles löschen.

## Zahlenfreier Modus

Portionen und Ringe statt kcal-Zahlen, in der ganzen App: Heute, Ernährung, Fortschritt, Coach- und Rückblick-Texte, Änderungsmeldungen, Erfassen, Rezepte, Profil und „Dein Plan“. Protein bleibt in Gramm. Werte von der Verpackung werden weiter eingegeben (zum Rechnen), aber nicht als Zahl zurückgezeigt.

## Daten und Sicherheit

- Alles lokal (`localStorage`), versionierte Migrationen, beschädigte Daten werden gesichert.
- Netzwerk nur auf Nutzeraktion (Barcode, Online-Suche). Preise kommen nie aus fremden Quellen.
- Schutzregeln:
  - Unter 18 sowie in Schwangerschaft und Stillzeit gibt es nur „Halten“ und kein Defizit.
  - Bei einem BMI unter 18,5 oder sehr wenig Körperfett wird kein Abnehmen angeboten.
  - Das Defizit beträgt höchstens 25 % des Bedarfs, die Kaloriengrenze wird nie unterschritten.
- Hinweis: LifeFit ersetzt keine ärztliche oder ernährungswissenschaftliche Beratung.
