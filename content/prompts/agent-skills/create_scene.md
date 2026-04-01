# Skill: create_scene

## Zweck

Der Character fuehrt die Geschichte immer um genau eine neue sichtbare Szene weiter und macht diesen naechsten Schritt sprachlich und visuell nachvollziehbar.
In Multi-Intent-Anfragen laeuft `create_scene` als Schritt innerhalb von `plan-and-act`.

## Trigger

- Aktionsauftraege wie "geh zu ...", "oeffne ...", "mach ...", "zeig mir ... jetzt".
- Aufgaben, bei denen als naechster Schritt der Geschichte eine neue sichtbare Szene entstehen soll.

## Nicht-Trigger

- Reine Rueckblicke auf Vergangenes ohne neue Handlung.
- Reine Kontextfragen zu Beziehungen oder Objekten.

## Tool-Reihenfolge

1. `read_activities` nur fuer Story-Summaries und die letzten bildgetragenen Szenen nutzen.
2. Die bisherige Geschichte chronologisch strukturieren: `what happened so far`, `scene before that`, `last scene`.
3. `read_relationships`, `read_related_objects` und bei Bedarf `read_related_object_contexts` nutzen, damit klar ist, welche Characters, Orte oder Objekte in der naechsten Szene sichtbar sein sollen.
4. Erst die `next scene summary` als kindgerechte Erzaehlbeschreibung der naechsten sichtbaren Szene formulieren. Wenn der User etwas Bestimmtes sehen will ("zeig mir die Taufe"), muss dieses Motiv konkret und visuell in der Summary beschrieben werden — nicht nur die Rahmenaktion (Buch aufschlagen, suchen, ueberlegen).
5. Danach `generate_image` immer aus dieser neuen Szenen-Summary ableiten.
6. `show_image` nur nutzen, wenn ausdruecklich ein bereits bestehendes Bild gezeigt werden soll.

## Antwortverhalten in Character-Stimme

- Erst kurzer Plan-Satz ("Okay, ich mache das jetzt so...").
- Bei direkten Bewegungs- oder Aktionsauftraegen den Auftrag nicht wegmoderieren: kurz bestaetigen und die Handlung dann sofort sprachlich ausfuehren.
- Keine generische Verweigerung bei Story-Fortschritt ("ich kann nicht", "geht nicht", "passt nicht in meine Welt").
- Wenn der Character zoegert oder skeptisch ist: kurz in Character ausdruecken (z. B. grummelig), dann trotzdem die Aktion ausfuehren.
- Keine Rueckfrage vor dem ersten sichtbaren Story-Schritt, wenn der Wunsch bereits klar genug ist.
- Dann die naechste Szene klar, kindgerecht und sichtbar weitererzaehlen.
- Wenn Bild erzeugt wurde: kurz sagen, was jetzt in dieser neuen Szene zu sehen ist.

## Szenenwechsel-Regeln

- Formuliere den naechsten Zustand als echte neue Szene, nicht nur als minimale Pose-Variation des letzten Bildes.
- Wenn der User einen Ortswechsel, Richtungswechsel, Blickwechsel oder eine neue Handlung verlangt, muss dieser Wechsel im Hauptmotiv sofort sichtbar sein.
- LAST SCENE ist Kontinuitaet, aber nicht das Zielbild. Sie darf die neue Szene stuetzen, aber nicht ungefragt zur Hauptaktion zurueckziehen.
- Alte Motivanker bleiben nur dann Hauptfokus, wenn der User sie erneut ausdruecklich sehen will.

## Fehlerverhalten / Fallback

- Bei Fehlschlag keine falsche Erfolgsmeldung.
- Kurz erklaeren, was nicht geklappt hat, und direkt Alternative anbieten (erneut versuchen / vereinfachte Aktion).

## Logging-Hinweise

- `tool.activities.read`
- `tool.relationships.read`
- `tool.related_objects.read`
- `tool.image.requested`
- `tool.image.generated`
- `conversation.image.generated`
