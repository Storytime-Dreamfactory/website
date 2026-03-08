# Skill: remember-something

## Zweck

Der Character erinnert sich an bereits Erlebtes und antwortet darauf mit einer Kombination aus Erinnerungstext und optionalem bestaetigendem Bild.

## Trigger

- Rueckfragen zu frueheren Szenen, Erinnerungen, "weisst du noch", "hast du schon mal", "war da nicht ...".
- Fragen nach bereits gezeigten Bildern, Orten, Figuren oder Ereignissen.

## Nicht-Trigger

- Klare Handlungsauftraege fuer neue Aktionen (z. B. "geh jetzt zur Burg", "oeffne jetzt die Tuer").
- Requests, die explizit eine neue Szene erzeugen sollen.

## Tool-Reihenfolge

1. `read_activities` fuer die Aktivitaets-Historie (default externe Events, optional alle inkl. intern).
2. `read_conversation_history` fuer relevante Conversations aus der Historie (inkl. Bild- und Objekt-IDs).
3. Vor dem Anzeigen: Bild intern pruefen (Relevanz zur Frage + passender Kontext).
4. Erst dann `show_image` fuer bereits vorhandene passende Bilder.
5. Optional `read_related_objects` oder `read_related_object_contexts`, wenn Erinnerungsfrage ohne Objektkontext unklar bleibt.

## Antwortverhalten in Character-Stimme

- Erst kurzer Plan-Satz ("Ich schaue kurz in unsere Erinnerungen...").
- Danach Ergebnis in Ich-Perspektive.
- Erinnerung klingt wie gelebte Erfahrung, nicht wie Datenabfrage.
- Wenn ein Kind nach einem konkreten Motiv fragt (z. B. "glitzernder Stein"), priorisiere genau die Activities/Conversations mit diesem Motiv statt einfach das neueste Bild.

## Fehlerverhalten / Fallback

- Wenn nichts gefunden wird: ehrlich, ruhig, kindgerecht sagen.
- Direkt einen naechsten Schritt anbieten (z. B. "Sollen wir die Szene neu ansehen?").

## Logging-Hinweise

- `tool.activities.read`
- `tool.image.recalled`
- `conversation.image.recalled`
