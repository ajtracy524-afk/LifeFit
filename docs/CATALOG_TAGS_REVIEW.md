# Katalog-Tags – Review (Prompt 3b, Phase 1)

Stand: 02.10.2026. **Vorschlag, noch nicht übernommen.** Übernahme in `src/data` erst nach „Freigabe“ (E6, E9). Korrekturen bitte direkt in diese Datei oder als Liste im Chat.

So ist die Datei aufgebaut:
- Teil 1: Lebensmittel, Teil 2: Rezepte, Teil 3: Übungen
- Teil 4: Liste aller Stellen, an denen sich das heutige Filterverhalten ändern würde
- Teil 5: offene Fragen, die ich vor der Übernahme von dir brauche

Grundsätze dieses Vorschlags:
- **Allergene nach Zusammensetzung, im Zweifel getaggt.** Spuren („kann Spuren enthalten“) sind nicht getaggt, sondern in „unsicher“ vermerkt (offene Frage 1).
- **Unverträglichkeiten getrennt von Allergenen.** „ja“ = wird bei der Unverträglichkeit ausgeschlossen. „gering“ = enthält wenig, Vorschlag: nicht ausschließen (Ausnahmen in der Spalte „unsicher“). „unsicher“ = nur bei Verunreinigung relevant, Vorschlag: bei Zöliakie ausschließen, bei „glutenarm“/Gluten-Allergie nicht.
- **Tierart getrennt:** Fleisch, Schwein, Fisch, Krebstiere, Weichtiere, Ei, Milch, Honig. Vegetarisch/vegan/pescetarisch werden daraus abgeleitet statt einzeln gepflegt.
- **Makro-Kategorie als Hybrid (E6):** berechnet = Makro mit dem größten Energieanteil (Protein 4, Kohlenhydrate 4, Fett 9 kcal/g). Override nur, wo das fachlich falsch liegt; mehrere Kategorien erlaubt. „Gemüse & Obst“ und „Würze“ sind ein Vorschlag (offene Frage 2).
- **Rezepte bekommen keine eigenen Allergene oder Tierarten.** Sie werden aus den Zutaten abgeleitet; die Tabelle zeigt das Ergebnis nur zur Kontrolle.

## Teil 1 – Lebensmittel

51 bestehende Einträge und 2 neue. „heute“ = die heutigen Tags (`lactose | gluten | nuts | fish`, vegan/vegetarisch).

| # | Lebensmittel | heute | Allergene (LMIV) | Laktose | Fruktose | Zöliakie | Tierart | Anteile P · K · F (%) | berechnet | Override | Grundvorrat | unsicher |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Brokkoli `broccoli` | – · vegan | – | – | – | – | – | 44 · 42 · 14 | Protein | Gemüse & Obst | nein |  |
| 2 | Paprika `bell-pepper` | – · vegan | – | – | – | – | – | 13 · 78 · 9 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 3 | Zucchini `zucchini` | – · vegan | – | – | – | – | – | 34 · 47 · 19 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 4 | Tomaten `tomato` | – · vegan | – | – | – | – | – | 23 · 66 · 11 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 5 | Gurke `cucumber` | – · vegan | – | – | – | – | – | 21 · 63 · 16 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 6 | Zwiebeln `onion` | – · vegan | – | – | unsicher | – | – | 13 · 82 · 5 | Kohlenhydrate | Gemüse & Obst | nein | Fruktane statt freier Fruktose; viele mit Fruktosemalabsorption meiden Zwiebeln trotzdem. |
| 7 | Kartoffeln `potato` | – · vegan | – | – | – | – | – | 11 · 87 · 1 | Kohlenhydrate | – | nein |  |
| 8 | Süßkartoffeln `sweet-potato` | – · vegan | – | – | – | – | – | 7 · 92 · 1 | Kohlenhydrate | – | nein |  |
| 9 | Bananen `banana` | – · vegan | – | – | gering | – | – | 6 · 92 · 2 | Kohlenhydrate | Gemüse & Obst, Kohlenhydrate | nein | Reife Bananen enthalten mehr freie Fruktose; in üblichen Mengen meist verträglich. |
| 10 | Äpfel `apple` | – · vegan | – | – | ja | – | – | 2 · 94 · 4 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 11 | Avocado `avocado` | – · vegan | – | – | – | – | – | 5 · 9 · 86 | Fette | – | nein |  |
| 12 | Blattsalat / Rucola `lettuce` | – · vegan | – | – | – | – | – | 42 · 32 · 26 | Protein | Gemüse & Obst | nein |  |
| 13 | Haferflocken `oats` | Gluten · vegan | Gluten | – | – | ja | – | 15 · 67 · 18 | Kohlenhydrate | – | ja (heute Nachkaufen) | Hafer selbst enthält Avenin, handelsüblicher Hafer ist fast immer mit Weizen verunreinigt → Gluten getaggt (wie heute). |
| 14 | Basmatireis `rice` | – · vegan | – | – | – | – | – | 9 · 89 · 2 | Kohlenhydrate | – | ja (heute Nachkaufen) |  |
| 15 | Vollkornnudeln `pasta` | Gluten · vegan | Gluten | – | – | ja | – | 16 · 77 · 7 | Kohlenhydrate | – | ja (heute Nachkaufen) |  |
| 16 | Couscous `couscous` | Gluten · vegan | Gluten | – | – | ja | – | 14 · 82 · 4 | Kohlenhydrate | – | ja |  |
| 17 | Quinoa `quinoa` | – · vegan | – | – | – | unsicher | – | 16 · 69 · 15 | Kohlenhydrate | – | ja | Glutenfrei, aber Verunreinigung in der Verarbeitung möglich – nur für Zöliakie relevant. |
| 18 | Vollkornbrot `bread` | Gluten · vegan | Gluten, Sesam | – | – | ja | – | 14 · 79 · 7 | Kohlenhydrate | – | nein | Sesam: Vollkornbrot enthält häufig Saaten/Sesam – im Zweifel getaggt. Soja/Lupinenmehl kommt vor, aber selten → nicht getaggt. |
| 19 | Weizen-Wraps `wrap` | Gluten · vegan | Gluten | – | – | ja | – | 11 · 68 · 21 | Kohlenhydrate | – | nein |  |
| 20 | Reiswaffeln `rice-cakes` | – · vegan | – | – | – | unsicher | – | 8 · 85 · 7 | Kohlenhydrate | – | nein | Reis ist glutenfrei, Reiswaffeln laufen oft über Linien mit Dinkel-/Weizenwaffeln. |
| 21 | Hähnchenbrust `chicken` | – · Fleisch | – | – | – | – | Fleisch | 87 · 0 · 13 | Protein | – | nein |  |
| 22 | Rinderhack (5 % Fett) `beef-mince` | – · Fleisch | – | – | – | – | Fleisch | 68 · 0 · 32 | Protein | – | nein |  |
| 23 | Lachsfilet `salmon` | Fisch · Fleisch | Fisch | – | – | – | Fisch | 41 · 0 · 59 | Fette | Protein, Fette | nein |  |
| 24 | Eier `egg` | – · vegetarisch | Eier | – | – | – | Ei | 36 · 2 · 62 | Fette | Protein | nein (heute Nachkaufen) |  |
| 25 | Milch 1,5 % `milk` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 29 · 41 · 29 | Kohlenhydrate | Protein | ja (heute Nachkaufen) | Berechnet „Kohlenhydrate“ (Milchzucker); fachlich als Proteinquelle der Milchprodukte-Gruppe geführt. |
| 26 | Skyr natur `skyr` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 71 · 26 · 3 | Protein | – | nein (heute Nachkaufen) |  |
| 27 | Magerquark `quark` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 73 · 24 · 3 | Protein | – | nein (heute Nachkaufen) |  |
| 28 | Körniger Frischkäse `cottage` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 52 · 6 · 41 | Protein | – | nein |  |
| 29 | Feta `feta` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 25 · 1 · 74 | Fette | Protein | nein | Gereift, ca. 0,5–1 g Laktose/100 g. Vorschlag: bleibt bei Laktoseintoleranz ausgeschlossen (heutiges Verhalten). |
| 30 | Mozzarella light `mozzarella` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 47 · 2 · 50 | Fette | Protein | nein |  |
| 31 | Tofu natur `tofu` | – · vegan | Soja | – | – | – | – | 43 · 5 · 52 | Fette | Protein | nein |  |
| 32 | Thunfisch naturell (abgetropft) `tuna` | Fisch · Fleisch | Fisch | – | – | – | Fisch | 92 · 0 · 8 | Protein | – | nein |  |
| 33 | Kidneybohnen (abgetropft) `kidney` | – · vegan | – | – | – | – | – | 35 · 59 · 6 | Kohlenhydrate | Protein, Kohlenhydrate | nein |  |
| 34 | Kichererbsen (abgetropft) `chickpeas` | – · vegan | – | – | – | – | – | 26 · 54 · 20 | Kohlenhydrate | Protein, Kohlenhydrate | nein |  |
| 35 | Mais (abgetropft) `corn` | – · vegan | – | – | – | – | – | 16 · 70 · 15 | Kohlenhydrate | – | ja |  |
| 36 | Gehackte Tomaten `canned-tomato` | – · vegan | – | – | – | – | – | 23 · 68 · 9 | Kohlenhydrate | Gemüse & Obst | ja |  |
| 37 | Rote Linsen `lentils` | – · vegan | – | – | – | unsicher | – | 32 · 64 · 4 | Kohlenhydrate | Protein, Kohlenhydrate | ja | Linsen können Getreidekörner aus der Ernte enthalten – nur für Zöliakie relevant. |
| 38 | Beerenmischung (TK) `berries` | – · vegan | – | – | gering | – | – | 9 · 83 · 8 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 39 | Blattspinat (TK) `spinach` | – · vegan | – | – | – | – | – | 66 · 16 · 18 | Protein | Gemüse & Obst | nein |  |
| 40 | Edamame (TK) `edamame` | – · vegan | Soja | – | – | – | – | 38 · 24 · 38 | Fette | Protein | nein |  |
| 41 | Whey Protein `whey` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 82 · 6 · 12 | Protein | – | nein | Isolat ist fast laktosefrei, Konzentrat nicht → im Zweifel „ja“. |
| 42 | Olivenöl `olive-oil` | – · vegan | – | – | – | – | – | 0 · 0 · 100 | Fette | – | ja (heute Nachkaufen) |  |
| 43 | Erdnussbutter `peanut-butter` | Nüsse · vegan | Erdnüsse | – | – | – | – | 17 · 8 · 74 | Fette | – | ja | Spuren von Schalenfrüchten häufig („kann Spuren enthalten“) – siehe offene Frage 1. Protein ca. 17 % der Energie, deshalb nur „Fette“. |
| 44 | Mandeln `almonds` | Nüsse · vegan | Schalenfrüchte | – | – | – | – | 15 · 4 · 81 | Fette | – | nein |  |
| 45 | Honig `honey` | – · vegetarisch | – | – | ja | – | Honig | 0 · 100 · 0 | Kohlenhydrate | – | ja |  |
| 46 | Sojasauce `soy-sauce` | Gluten · vegan | Soja, Gluten | – | – | ja | – · Alkohol: unsicher | 57 · 43 · 0 | Protein | – (Würze) | ja | Natürlich gebraute Sojasauce enthält oft 1–3 % Alkohol aus der Gärung – siehe offene Frage 3. |
| 47 | Proteinriegel `protein-bar` | Laktose · vegetarisch | Milch, Soja, Gluten | ja | – | ja | Milch | 37 · 33 · 30 | Protein | – | nein | Generischer Eintrag ohne Rezeptur. Milch, Soja und Gluten sind die häufigsten Zutaten → getaggt. Nüsse/Erdnüsse kommen in vielen Sorten vor, im Zweifel …? Siehe offene Frage 1. |
| 48 | Vollkorntoast `toast` | Gluten · vegan | Gluten | – | – | ja | – | 15 · 70 · 15 | Kohlenhydrate | – | nein | Industrietoast enthält teils Sojamehl oder Sesam; seltener als bei Vollkornbrot → nicht getaggt. |
| 49 | Gouda `gouda` | Laktose · vegetarisch | Milch | gering | – | – | Milch | 29 · 0 · 71 | Fette | Protein | nein | Lange gereift praktisch laktosefrei (< 0,1 g/100 g). Würde bei Laktoseintoleranz neu erlaubt – siehe Filteränderungen. |
| 50 | Griechischer Joghurt 2 % `greek-yogurt` | Laktose · vegetarisch | Milch | ja | – | – | Milch | 51 · 23 · 26 | Protein | – | nein |  |
| 51 | Orange `orange` | – · vegan | – | – | gering | – | – | 9 · 89 · 2 | Kohlenhydrate | Gemüse & Obst | nein |  |
| 52 | **Salz (neu)** `salt` | – | – | – | – | – | – | – | – | – (Würze) | ja | Für Prompt 6 (Grundvorrat-Checkliste) und das Rezept „Edamame mit Meersalz“. |
| 53 | **Pfeffer (neu)** `pepper` | – | – | – | – | – | – | – | – | – (Würze) | ja | Mengen im Gramm-Bereich → keine Rolle für Makros. |

Zum Grundvorrat:
- „Grundvorrat“ ist die Checkliste aus Prompt 6 (lange haltbare Dinge, die man meist zu Hause hat).
- „Nachkaufen“ (`RESTOCK_MINIMUM_G`, heute 8 Einträge) bleibt davon getrennt.
- Eier, Magerquark und Skyr sind heute Nachkauf-Einträge. Sie sind aber zu kurz haltbar für eine Grundvorrat-Checkliste; Vorschlag: Nachkaufen bleibt, Grundvorrat nein. Milch (UHT) bleibt in beiden.

Was der Katalog heute nicht enthält, die Filter aber trotzdem kennen müssen:
- Krebstiere, Weichtiere, Sellerie, Senf, Lupinen, Sulfite, Schwein und Alkohol kommen in keinem Katalog-Eintrag vor.
- Die Filter wirken bei ihnen nur auf eigene und gescannte Produkte (Open-Food-Facts-Allergene) und auf den Freitext-Abgleich (Prompt 4).

## Teil 2 – Rezepte

24 Rezepte. Allergene, Tierarten und die Ernährungsform sind **abgeleitet** (Vereinigung der Zutaten nach Teil 1), nicht gepflegt. Die Spalte „heute“ zeigt die heutige Ableitung (vegan/vegetarisch) und die freien Tags.

Kriterien:
- **Transportfähig:** kalt essbar oder in der Mikrowelle aufwärmbar, übersteht 4–5 Stunden in einer Dose. Gekühlt nötig → in „unsicher“ vermerkt.
- **Meal-Prep:** lässt sich für 2–3 Tage vorkochen, ohne deutlich schlechter zu werden.
- **Haltbarkeit:** Tage im Kühlschrank nach dem Zubereiten; 0 = frisch essen.
- **Kochzeit:** aktive Minuten; die Rezept-Minuten sind die Wahrheit (E13).

| # | Rezept | heute | Allergene (abgeleitet) | Tierart → Ernährungsform | Laktose / Fruktose / Zöliakie relevant durch | Kochzeit min | transportfähig | Meal-Prep | Haltbarkeit (Tage) | unsicher |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Protein Overnight Oats `overnight-oats` | vegetarisch · Meal Prep, High Protein | Gluten, Milch | Milch, Honig → vegetarisch | L: whey, milk · F: honey · Z: oats | 5 | **ja** (heute nein) | ja | 2 | 5 min aktiv + Quellzeit über Nacht; Minuten = aktive Zeit. |
| 2 | Skyr-Bowl mit Beeren & Mandeln `skyr-bowl` | vegetarisch · Schnell, High Protein | Milch, Gluten, Schalenfrüchte | Milch, Honig → vegetarisch | L: skyr · F: honey · Z: oats | 5 | **ja** (heute nein) | nein | 0 | Transportfähig nur gekühlt; Toppings besser frisch. |
| 3 | Gemüse-Omelett mit Vollkornbrot `veggie-omelette` | vegetarisch · Vegetarisch | Eier, Milch, Gluten, Sesam | Ei, Milch → vegetarisch | L: feta · Z: bread | 15 | nein | nein | 0 |  |
| 4 | Porridge mit Banane & Erdnussbutter `pb-porridge` | vegetarisch · Warm | Gluten, Milch, Erdnüsse | Milch → vegetarisch | L: milk, whey · Z: oats | 10 | nein | nein | 1 | Lässt sich aufwärmen, wird aber fest – kein Meal-Prep vorgeschlagen. |
| 5 | Protein-Pancakes `protein-pancakes` | vegetarisch · Wochenende, High Protein | Gluten, Eier, Milch | Ei, Milch → vegetarisch | L: quark · Z: oats | 20 | **ja** (heute nein) | **ja** (heute nein) | 2 | Kalt essbar und gut aufzubacken; Beeren separat. |
| 6 | Rührei-Wrap mit Paprika `egg-wrap` | vegetarisch · To go | Gluten, Eier, Milch | Ei, Milch → vegetarisch | L: mozzarella · Z: wrap | 10 | ja | nein | 1 | Wrap weicht nach einem Tag durch. |
| 7 | Tofu-Scramble auf Toast `tofu-scramble` | vegan · Vegan | Soja, Gluten, Sesam | – → vegan | Z: bread | 15 | nein | nein | 1 |  |
| 8 | Tofu-Scramble mit Ofenkartoffeln `tofu-potato-scramble` | vegan · Vegan, Glutenfrei | Soja | – → vegan | – | **35** (heute 25) | **ja** (heute nein) | **ja** (heute nein) | 3 | Ofenkartoffeln brauchen realistisch 30–35 min → 25 auf 35 min. |
| 9 | Chicken-Reis-Bowl `chicken-rice-bowl` | Fleisch · Meal Prep, High Protein | Soja, Gluten | Fleisch → alles · Alkohol: unsicher | Z: soy-sauce | 25 | **ja** (heute nein) | ja | 3 |  |
| 10 | Ofenlachs mit Kartoffeln & Brokkoli `oven-salmon` | Fleisch · Omega-3 | Fisch | Fisch → pescetarisch | – | 35 | **ja** (heute nein) | **ja** (heute nein) | 2 | Fisch gegart höchstens 2 Tage; im Büro aufwärmen ist Geschmackssache. |
| 11 | Chili con Carne mit Reis `chili` | Fleisch · Meal Prep, High Protein | – | Fleisch → alles | – | 35 | **ja** (heute nein) | ja | 4 |  |
| 12 | Vollkorn-Pasta Bolognese `bolognese` | Fleisch · Klassiker, High Protein | Gluten | Fleisch → alles | Z: pasta | 30 | **ja** (heute nein) | **ja** (heute nein) | 3 |  |
| 13 | Hähnchen-Wraps `chicken-wraps` | Fleisch · To go, High Protein | Gluten, Milch | Fleisch, Milch → alles | L: cottage · Z: wrap | 20 | ja | nein | 1 | Füllung ist vorbereitbar, fertige Wraps weichen durch. |
| 14 | Thunfisch-Nudelsalat `tuna-pasta-salad` | Fleisch · Meal Prep, Kalt | Gluten, Fisch, Milch | Fisch, Milch → pescetarisch | L: feta · Z: pasta | 20 | **ja** (heute nein) | ja | 2 |  |
| 15 | Hähnchen mit Süßkartoffel & Zucchini `chicken-sweet-potato` | Fleisch · Ofengericht, High Protein | – | Fleisch → alles | – | 35 | **ja** (heute nein) | **ja** (heute nein) | 3 |  |
| 16 | Rote-Linsen-Dal mit Reis `lentil-dal` | vegan · Vegan, Meal Prep | – | – → vegan | Z: lentils | 30 | **ja** (heute nein) | ja | 4 |  |
| 17 | Tofu-Gemüse-Pfanne mit Reis `tofu-stir-fry` | vegan · Vegan | Soja, Gluten | – → vegan · Alkohol: unsicher | Z: soy-sauce | 25 | **ja** (heute nein) | **ja** (heute nein) | 3 |  |
| 18 | Couscous-Salat mit Kichererbsen & Feta `couscous-salad` | vegetarisch · Vegetarisch, Kalt | Gluten, Milch | Milch → vegetarisch | L: feta · Z: couscous | 15 | **ja** (heute nein) | **ja** (heute nein) | 3 |  |
| 19 | Quinoa-Bowl mit Edamame & Avocado `quinoa-edamame-bowl` | vegan · Vegan | Soja, Gluten | – → vegan · Alkohol: unsicher | Z: quinoa, soy-sauce | 20 | **ja** (heute nein) | **ja** (heute nein) | 2 | Avocado erst frisch dazugeben. |
| 20 | Quark mit Beeren `quark-berries` | vegetarisch · Schnell, High Protein | Milch | Milch, Honig → vegetarisch | L: quark · F: honey | 3 | **ja** (heute nein) | nein | 1 | Transportfähig nur gekühlt. |
| 21 | Proteinshake mit Banane `protein-shake` | vegetarisch · Nach dem Training | Milch | Milch → vegetarisch | L: whey, milk | 2 | **ja** (heute nein) | nein | 0 | Transportfähig als Pulver im Shaker, Milch frisch dazu. |
| 22 | Reiswaffeln mit Hüttenkäse `cottage-rice-cakes` | vegetarisch · Schnell | Milch | Milch → vegetarisch | L: cottage · Z: rice-cakes | 3 | **ja** (heute nein) | nein | 0 | Getrennt einpacken, sonst werden die Waffeln weich. |
| 23 | Edamame mit Meersalz `edamame-snack` | vegan · Vegan, Schnell | Soja | – → vegan | – | 5 | **ja** (heute nein) | **ja** (heute nein) | 3 | „Meersalz“ steht im Titel, ist aber keine Zutat → Salz (neu) als Zutat ergänzen? |
| 24 | Apfel mit Erdnussbutter `apple-pb` | vegan · Vegan, Schnell | Erdnüsse | – → vegan | F: apple | 2 | **ja** (heute nein) | nein | 0 |  |

Ergebnis: transportfähig 21 von 24 (heute 2), Meal-Prep 14 von 24 (heute 5).

### Vorschau Machbarkeit (für die Schwelle in Prompt 4)

Anzahl erlaubter Rezepte pro Mahlzeit nach den vorgeschlagenen Tags. Das zeigt, wo die Machbarkeitsprüfung aus Prompt 4 anschlagen würde.

| Profil | Frühstück | Mittag | Abend | Snack |
|---|---|---|---|---|
| alles, keine Ausschlüsse | 9 | 12 | 12 | 6 |
| pescetarisch | 9 | 7 | 7 | 6 |
| vegetarisch | 9 | 5 | 6 | 6 |
| vegan | **2** | 3 | 5 | **2** |
| Milch-Allergie | **2** | 8 | 10 | **2** |
| Laktoseintoleranz | **2** | 8 | 10 | **2** |
| Zöliakie | **2** | 3 | 4 | 4 |
| Soja-Allergie | 7 | 9 | 7 | 5 |
| Eier-Allergie | 6 | 11 | 11 | 6 |
| vegan + Soja-Allergie | **0** | **1** | **1** | **1** |
| vegan + Zöliakie | **1** | **0** | **1** | **2** |
| vegetarisch + Laktose + Eier | **2** | 3 | 5 | **2** |

Fett = höchstens 2 Rezepte. Bei veganen Profilen mit Soja-Allergie bleibt beim Frühstück fast nichts übrig. Das ist ein Katalog-Thema (zu wenige Rezepte), kein Tag-Fehler; Prompt 4 zeigt dafür den Hinweis.

## Teil 3 – Übungen

55 Übungen. Gelenkbelastung **0 = keine, 1 = gering, 2 = hoch** (E6). Prompt 3b verlangt fünf Gelenke. **Hüfte** ist zusätzlich bewertet, weil die heutige Liste `AREA_LOAD` sie kennt und Beschwerden dort sonst nicht mehr wirken würden.

Die Stufen sind eine Orientierung für die Auswahl von Alternativen, keine Aussage, dass eine Übung sicher ist, und keine Diagnose (wie heute).

| # | Übung | Hauptmuskel | Schulter | Knie | unterer Rücken | Handgelenk | Ellbogen | Hüfte | heute „belastet“ | unsicher |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bankdrücken `bench-press` | Brust | **2** | 0 | 1 | 1 | 1 | 0 | Schulter, Handgelenk |  |
| 2 | Kurzhantel-Bankdrücken `db-bench-press` | Brust | 1 | 0 | 0 | 1 | 1 | 0 | – | Kurzhanteln erlauben einen schulterfreundlicheren Weg als die Stange. |
| 3 | Schrägbankdrücken (KH) `incline-db-press` | Brust | **2** | 0 | 0 | 1 | 1 | 0 | Schulter |  |
| 4 | Brustpresse (Maschine) `chest-press` | Brust | 1 | 0 | 0 | 0 | 1 | 0 | – |  |
| 5 | Liegestütze `push-up` | Brust | 1 | 0 | 0 | **2** | 1 | 0 | Handgelenk | Handgelenk in starker Streckung; mit Griffen/Fäusten weniger. |
| 6 | Cable Fly `cable-fly` | Brust | 1 | 0 | 0 | 0 | 0 | 0 | – |  |
| 7 | Dips `dips` | Brust | **2** | 0 | 0 | 1 | **2** | 0 | Schulter, Ellbogen, Handgelenk |  |
| 8 | Schulterdrücken (KH) `overhead-press` | Schultern | **2** | 0 | 1 | 1 | 1 | 0 | Schulter |  |
| 9 | Schulterpresse (Maschine) `machine-shoulder-press` | Schultern | **2** | 0 | 0 | 0 | 1 | 0 | Schulter |  |
| 10 | Seitheben `lateral-raise` | Schultern | 1 | 0 | 0 | 0 | 0 | 0 | – |  |
| 11 | Face Pulls `face-pull` | Schultern | 1 | 0 | 0 | 0 | 1 | 0 | – |  |
| 12 | Reverse Fly (KH) `rear-delt-fly` | Schultern | 1 | 0 | 1 | 0 | 0 | 0 | – |  |
| 13 | Trizepsdrücken am Kabel `triceps-pushdown` | Trizeps | 0 | 0 | 0 | 0 | 1 | 0 | Ellbogen | Kabel mit Seil gilt als die ellbogenfreundlichste Trizepsübung → 1 statt heute „belastet“. |
| 14 | Trizepsstrecken über Kopf `overhead-triceps-extension` | Trizeps | 1 | 0 | 0 | 0 | **2** | 0 | Ellbogen |  |
| 15 | Enges Bankdrücken `close-grip-bench` | Trizeps | 1 | 0 | 1 | **2** | **2** | 0 | Schulter, Ellbogen, Handgelenk |  |
| 16 | Langhantelrudern `barbell-row` | Rücken | 1 | 0 | **2** | 1 | 1 | 0 | unterer Rücken |  |
| 17 | Kurzhantelrudern einarmig `db-row` | Rücken | 1 | 0 | 1 | 0 | 1 | 0 | – |  |
| 18 | Latzug `lat-pulldown` | Rücken | 1 | 0 | 0 | 0 | 1 | 0 | – |  |
| 19 | Klimmzüge `pull-up` | Rücken | **2** | 0 | 0 | 1 | **2** | 0 | Schulter, Ellbogen |  |
| 20 | Klimmzüge mit Unterstützung `assisted-pull-up` | Rücken | 1 | 0 | 0 | 0 | 1 | 0 | – |  |
| 21 | Rudern am Kabel `cable-row` | Rücken | 1 | 0 | 1 | 0 | 1 | 0 | – |  |
| 22 | Rudern am Körpergewicht `inverted-row` | Rücken | 1 | 0 | 0 | 1 | 1 | 0 | – |  |
| 23 | Rudern mit Band `band-row` | Rücken | 1 | 0 | 0 | 0 | 0 | 0 | – |  |
| 24 | Bizepscurls (KH) `biceps-curl` | Bizeps | 0 | 0 | 0 | 1 | **2** | 0 | Ellbogen, Handgelenk |  |
| 25 | Hammercurls `hammer-curl` | Bizeps | 0 | 0 | 0 | 0 | 1 | 0 | – | Neutralgriff entlastet Ellbogen und Handgelenk. |
| 26 | Bizepscurls am Kabel `cable-curl` | Bizeps | 0 | 0 | 0 | 1 | **2** | 0 | Ellbogen |  |
| 27 | Bizepscurls mit Band `band-curl` | Bizeps | 0 | 0 | 0 | 0 | 1 | 0 | Ellbogen | Geringe Last am Anfang der Bewegung. |
| 28 | Kniebeugen `squat` | Quadrizeps | 1 | **2** | **2** | 1 | 0 | **2** | unterer Rücken, Hüfte, Knie |  |
| 29 | Goblet Squat `goblet-squat` | Quadrizeps | 0 | 1 | 1 | 0 | 0 | 1 | Knie | Leichter und aufrechter als die Langhantel-Kniebeuge; Knie bleibt aber gebeugt unter Last. |
| 30 | Kniebeugen ohne Gewicht `bodyweight-squat` | Quadrizeps | 0 | 1 | 0 | 0 | 0 | 1 | Knie |  |
| 31 | Beinpresse `leg-press` | Quadrizeps | 0 | 1 | 1 | 0 | 0 | 1 | Knie | Bewegungsumfang einstellbar; ohne Begrenzung eher 2. |
| 32 | Beinstrecker `leg-extension` | Quadrizeps | 0 | **2** | 0 | 0 | 0 | 0 | Knie |  |
| 33 | Bulgarische Split Squats `split-squat` | Quadrizeps | 0 | **2** | 0 | 0 | 0 | 1 | Hüfte, Knie |  |
| 34 | Ausfallschritte (KH) `lunges` | Quadrizeps | 0 | **2** | 0 | 0 | 0 | 1 | Hüfte, Knie |  |
| 35 | Kreuzheben `deadlift` | Beinbeuger | 0 | 1 | **2** | 1 | 0 | **2** | unterer Rücken, Hüfte |  |
| 36 | Rumänisches Kreuzheben `romanian-deadlift` | Beinbeuger | 0 | 0 | **2** | 1 | 0 | **2** | unterer Rücken, Hüfte |  |
| 37 | Rumänisches Kreuzheben (KH) `db-romanian-deadlift` | Beinbeuger | 0 | 0 | 1 | 1 | 0 | 1 | – | Gleiche Bewegung, deutlich weniger Last als mit der Stange. |
| 38 | Beinbeuger (Maschine) `leg-curl` | Beinbeuger | 0 | 1 | 0 | 0 | 0 | 0 | – |  |
| 39 | Hip Thrust `hip-thrust` | Po | 0 | 0 | 1 | 0 | 0 | **2** | Hüfte |  |
| 40 | Glute Bridge `glute-bridge` | Po | 0 | 0 | 0 | 0 | 0 | 1 | – |  |
| 41 | Kettlebell Swing `kb-swing` | Po | 1 | 0 | **2** | 1 | 0 | **2** | unterer Rücken, Hüfte |  |
| 42 | Wadenheben `calf-raise` | Waden | 0 | 0 | 1 | 0 | 0 | 0 | – | Stehende Wadenmaschine lädt die Wirbelsäule axial; sitzend wäre 0. |
| 43 | Wadenheben ohne Gerät `standing-calf-raise` | Waden | 0 | 0 | 0 | 0 | 0 | 0 | – |  |
| 44 | Hängendes Beinheben `hanging-leg-raise` | Rumpf | **2** | 0 | **2** | 1 | 1 | 0 | unterer Rücken |  |
| 45 | Unterarmstütz (Plank) `plank` | Rumpf | 1 | 0 | 1 | 0 | 1 | 0 | – |  |
| 46 | Dead Bug `dead-bug` | Rumpf | 0 | 0 | 0 | 0 | 0 | 0 | – |  |
| 47 | Crunch am Kabel `cable-crunch` | Rumpf | 0 | 0 | 1 | 0 | 0 | 0 | – |  |
| 48 | Ergometer – Zone 2 `zone2-bike` | Ausdauer | 0 | 1 | 0 | 0 | 0 | 1 | – |  |
| 49 | Lockerer Lauf – Zone 2 `zone2-run` | Ausdauer | 0 | **2** | 1 | 0 | 0 | 1 | Knie | Laufen belastet die Knie stoßartig; für Geübte eher 1. |
| 50 | Zügiges Gehen `brisk-walk` | Ausdauer | 0 | 1 | 0 | 0 | 0 | 0 | – |  |
| 51 | Rudergerät `rowing` | Ausdauer | 1 | 1 | 1 | 0 | 0 | 0 | – | Mit sauberer Technik 1, bei Rundrücken eher 2. |
| 52 | HIIT – Intervalle (Rad) `hiit-bike` | Ausdauer | 0 | 1 | 0 | 0 | 0 | 1 | – |  |
| 53 | Seilspringen `jump-rope` | Ausdauer | 0 | **2** | 0 | 0 | 0 | 0 | Knie |  |
| 54 | Mobility-Flow Ganzkörper `mobility-flow` | Rumpf | 1 | 1 | 1 | 1 | 0 | 0 | – |  |
| 55 | Hüft-Mobility `hip-mobility` | Po | 0 | 1 | 0 | 0 | 0 | 1 | – |  |

### Alternativen für Übungen mit Stufe 2

Für jede Übung mit Stufe 2 an einem Gelenk: Gibt es eine Alternative mit Stufe ≤ 1 an diesem Gelenk und **demselben Hauptmuskel**?
- „in den Alternativen“ = schon in der Liste `alternatives` der Übung
- „nur im Katalog“ = vorhanden, aber nicht verknüpft; Vorschlag: in Phase 2 zu `alternatives` hinzufügen
- **Lücke** = keine passende Übung im Katalog

| Übung | Gelenk (Stufe 2) | in den Alternativen | nur im Katalog | Ergebnis |
|---|---|---|---|---|
| Bankdrücken `bench-press` | Schulter | db-bench-press, chest-press, push-up | cable-fly | ok |
| Schrägbankdrücken (KH) `incline-db-press` | Schulter | db-bench-press, chest-press | push-up, cable-fly | ok |
| Liegestütze `push-up` | Handgelenk | db-bench-press, chest-press, dips | bench-press, incline-db-press, cable-fly | ok |
| Dips `dips` | Schulter | push-up | db-bench-press, chest-press, cable-fly | ok |
| Dips `dips` | Ellbogen | push-up | bench-press, db-bench-press, incline-db-press, chest-press, cable-fly | ok |
| Schulterdrücken (KH) `overhead-press` | Schulter | – | lateral-raise, face-pull, rear-delt-fly | verknüpfen |
| Schulterpresse (Maschine) `machine-shoulder-press` | Schulter | – | lateral-raise, face-pull, rear-delt-fly | verknüpfen |
| Trizepsstrecken über Kopf `overhead-triceps-extension` | Ellbogen | triceps-pushdown | – | ok |
| Enges Bankdrücken `close-grip-bench` | Handgelenk | triceps-pushdown | overhead-triceps-extension | ok |
| Enges Bankdrücken `close-grip-bench` | Ellbogen | triceps-pushdown | – | ok |
| Langhantelrudern `barbell-row` | unterer Rücken | db-row, cable-row, inverted-row | lat-pulldown, pull-up, assisted-pull-up, band-row | ok |
| Klimmzüge `pull-up` | Schulter | assisted-pull-up, lat-pulldown, inverted-row | barbell-row, db-row, cable-row, band-row | ok |
| Klimmzüge `pull-up` | Ellbogen | assisted-pull-up, lat-pulldown, inverted-row | barbell-row, db-row, cable-row, band-row | ok |
| Bizepscurls (KH) `biceps-curl` | Ellbogen | hammer-curl, band-curl | – | ok |
| Bizepscurls am Kabel `cable-curl` | Ellbogen | band-curl | hammer-curl | ok |
| Kniebeugen `squat` | Knie | goblet-squat, leg-press | bodyweight-squat | ok |
| Kniebeugen `squat` | unterer Rücken | goblet-squat, leg-press, split-squat | bodyweight-squat, leg-extension, lunges | ok |
| Kniebeugen `squat` | Hüfte | goblet-squat, leg-press, split-squat | bodyweight-squat, leg-extension, lunges | ok |
| Beinstrecker `leg-extension` | Knie | leg-press | goblet-squat, bodyweight-squat | ok |
| Bulgarische Split Squats `split-squat` | Knie | goblet-squat, leg-press | bodyweight-squat | ok |
| Ausfallschritte (KH) `lunges` | Knie | goblet-squat | bodyweight-squat, leg-press | ok |
| Kreuzheben `deadlift` | unterer Rücken | db-romanian-deadlift | leg-curl | ok |
| Kreuzheben `deadlift` | Hüfte | db-romanian-deadlift | leg-curl | ok |
| Rumänisches Kreuzheben `romanian-deadlift` | unterer Rücken | db-romanian-deadlift, leg-curl | – | ok |
| Rumänisches Kreuzheben `romanian-deadlift` | Hüfte | db-romanian-deadlift, leg-curl | – | ok |
| Hip Thrust `hip-thrust` | Hüfte | glute-bridge | hip-mobility | ok |
| Kettlebell Swing `kb-swing` | unterer Rücken | hip-thrust | glute-bridge, hip-mobility | ok |
| Kettlebell Swing `kb-swing` | Hüfte | – | glute-bridge, hip-mobility | verknüpfen |
| Hängendes Beinheben `hanging-leg-raise` | Schulter | dead-bug, cable-crunch, plank | mobility-flow | ok |
| Hängendes Beinheben `hanging-leg-raise` | unterer Rücken | dead-bug, cable-crunch, plank | mobility-flow | ok |
| Lockerer Lauf – Zone 2 `zone2-run` | Knie | zone2-bike, brisk-walk | rowing, hiit-bike | ok |
| Seilspringen `jump-rope` | Knie | hiit-bike | zone2-bike, brisk-walk, rowing | ok |

Zusammenfassung: 3 Fälle lassen sich durch Verknüpfen lösen, 0 sind echte Lücken.

## Teil 4 – Wo sich das heutige Filterverhalten ändern würde

Verglichen wird der heutige Filter (`foodAllowed`/`recipeAllowed`, `loadsArea`) mit den vorgeschlagenen Tags. Ausgangslage:
- Bestandsnutzer bekommen durch die Migration (Prompt 1, E5) „Nüsse“ → Erdnüsse + Schalenfrüchte, „Laktose“ → Laktoseintoleranz, „Gluten“ → Gluten, „Fisch“ → Fisch.
- Die neuen Allergene (Eier, Soja, Milch, Sesam …) wirken nur, wenn jemand sie neu auswählt. Für Bestandsnutzer ändert sich dadurch nichts.

### Lebensmittel und Rezepte

- **Gluten:** Proteinriegel wäre **neu ausgeschlossen**.
- **Laktoseintoleranz:** Gouda wäre **neu erlaubt** (Laktose „gering“).
- **Fisch ist nicht mehr „Fleisch“:** Lachs und Thunfisch bekommen die Tierart Fisch. Vegetarisch und vegan filtern dadurch **wie heute** (Fisch bleibt ausgeschlossen); neu ist nur „pescetarisch“, das Fisch erlaubt und Fleisch ausschließt.
- **Honig:** bleibt vegetarisch, nicht vegan (wie heute), jetzt über die Tierart „Honig“ statt über ein Einzel-Flag.
- **Zöliakie strenger als Gluten:** Zusätzlich zu allen Gluten-Einträgen wären Quinoa, Reiswaffeln und rote Linsen ausgeschlossen („unsicher“ wegen Verunreinigung). Betrifft keine Bestandsnutzer (Zöliakie gab es nicht).
- **„Mag ich nicht“ (`dislikedFoods`) wird weich:** Heute schließt `foodAllowed` diese Lebensmittel hart aus. Prompt 4 macht daraus ein Gewicht („nur als Notlösung“). Das ist eine gewollte Änderung aus Prompt 4, aber eine Verhaltensänderung für Bestandsnutzer, die Lebensmittel auf „mag ich nicht“ gesetzt haben.
- **Meal-Prep:** Heute nutzt der Planer den freien Tag „Meal Prep“ (5 Rezepte) für Reste an den Folgetagen (`LEFTOVER_DAYS = 2`). Mit dem typisierten Merkmal wären es 14 Rezepte. Der Planer würde also deutlich öfter Reste einplanen, auch für Nutzer ohne Meal-Prep-Wunsch. Vorschlag: In Prompt 4 die Reste-Logik nur bei „Ich koche gern vor“ voll nutzen, sonst wie heute nur die 5 bisherigen Rezepte (oder gar nicht) – offene Frage 4.
- **Transportfähig:** Der Tag „To go“ wird heute nirgends im Code ausgewertet. Die neue Bewertung wirkt erst mit dem Wochenraster (Prompt 5) und ändert heute nichts.
- **Kochzeit:** Nur „Tofu-Scramble mit Ofenkartoffeln“ ändert sich (25 → 35 min). Mit dem Zeitbudget `low` (≤ 15) oder `normal` (≤ 35, nach E13 ≤ 30) fällt es aus kurzen Tagen heraus.
- **Neue Einträge Salz und Pfeffer:** Sie tauchen in keinem Rezept und keiner Einkaufsliste auf, solange sie nicht als Zutat ergänzt werden (offene Frage 5).

### Übungen

Heute: Eine Übung „belastet“ ein Gelenk oder nicht (`AREA_LOAD`). Neu (Prompt 7): Erst Stufe 2 führt zu einer Alternative mit Stufe ≤ 1. Unterschiede:

- Bankdrücken – Handgelenk: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Dips – Handgelenk: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Trizepsdrücken am Kabel – Ellbogen: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Enges Bankdrücken – Schulter: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Bizepscurls (KH) – Handgelenk: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Bizepscurls mit Band – Ellbogen: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Goblet Squat – Knie: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Kniebeugen ohne Gewicht – Knie: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Beinpresse – Knie: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Bulgarische Split Squats – Hüfte: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Ausfallschritte (KH) – Hüfte: heute „belastet“, neu Stufe 1 → wird bei Beschwerden **nicht mehr ersetzt**.
- Hängendes Beinheben – Schulter: heute nicht gelistet, neu Stufe 2 → wird bei Beschwerden **neu ersetzt**.

Die Stufen ändern erst etwas, wenn Prompt 7 `loadsArea` auf die Stufen umstellt. Bis dahin bleibt `AREA_LOAD` aktiv.

## Teil 5 – Offene Fragen vor der Freigabe

1. **Spuren:** Sollen „kann Spuren enthalten“-Allergene (z. B. Schalenfrüchte in Erdnussbutter, Nüsse in Proteinriegeln) mitgetaggt werden? Vorschlag: nein für Erdnussbutter. Beim generischen Proteinriegel zusätzlich Erdnüsse + Schalenfrüchte taggen, weil die Sorte unbekannt ist.
2. **Makro-Gruppen:** Prompt 4 kennt drei Gruppen (Protein / Kohlenhydrate / gesunde Fette). Vorschlag:
   - Gemüse & Obst bekommen eine eigene vierte Gruppe in den Vorlieben. Sonst würden Brokkoli und Spinat rechnerisch unter „Protein“ landen.
   - Würze (Sojasauce, Salz, Pfeffer) erscheint gar nicht in den Vorlieben.
3. **Alkohol in Rezepten:** Gilt natürlich gebraute Sojasauce (1–3 % Alkohol) als „Alkohol“? Vorschlag: ja, bei „kein Alkohol“ ausschließen (im Zweifel strenger).
4. **Meal-Prep-Merkmal:** Reste-Logik mit allen 14 Meal-Prep-Rezepten nur bei „Ich koche gern vor“? Ohne diese Angabe nur wie heute (5 Rezepte)? Vorschlag: ja.
5. **Salz und Pfeffer als Zutaten:** Nur als Grundvorrat-Einträge anlegen (Vorschlag), oder auch in die Rezepte aufnehmen? In Rezepten würden sie auf jeder Einkaufsliste stehen.
6. **Gouda bei Laktoseintoleranz** neu erlauben (natürlich laktosefrei) oder wie heute ausschließen? Vorschlag: erlauben, analog zu „laktosefreie Milchprodukte bleiben erlaubt“ aus Prompt 4. Feta bleibt ausgeschlossen.
7. **Übungs-Lücken** (siehe Teil 3): neue Übungen in Phase 2 anlegen oder nur dokumentieren und in Prompt 7 mit Hinweis lösen?

---

**STOPP.** Phase 2 (Übernahme in `src/data`, abgeleitete Rezept-Tags als reine Funktion, Tests) beginnt erst nach „Freigabe“, inklusive deiner Korrekturen und Antworten auf Teil 5.
