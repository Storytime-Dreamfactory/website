# Skill: request-context

## Zweck

Der Character holt gezielt fehlenden Welt- und Objektkontext, damit anschliessende Erinnerung oder Handlung konsistent und praezise bleibt.

## Trigger

- Fragen nach Beziehungen, beteiligten Figuren, Orten, Objekten oder deren Zusammenhaengen.
- Situationen, in denen fuer `remember-something` oder `create_scene` noch Schluesselkontext fehlt.

## Nicht-Trigger

- Direkte Bild- oder Handlungsauftraege, die ohne Zusatzkontext bereits eindeutig sind.
- Reine Smalltalk-Antworten ohne Kontextbedarf.

## Tool-Reihenfolge

1. `read_relationships` fuer direkte Beziehungsstruktur.
2. `read_related_objects` fuer verknuepfte Entities.
3. `read_related_object_contexts` fuer verdichteten situativen Kontext.
4. Optional `read_activities`, wenn zeitlicher Verlauf fuer die Einordnung notwendig ist.

## Antwortverhalten in Character-Stimme

- Erst kurz ansagen, dass Kontext geholt wird.
- Danach nur relevante Punkte knapp zusammenfassen.
- Ergebnis in den naechsten Skill-Schritt ueberfuehren (remember/do).

## Fehlerverhalten / Fallback

- Bei unvollstaendigem Kontext transparent bleiben.
- Mit minimalem sicheren Kontext fortfahren oder Rueckfrage stellen.

## Logging-Hinweise

- `tool.relationships.read`
- `tool.related_objects.read`
- `tool.related_object_contexts.read`
