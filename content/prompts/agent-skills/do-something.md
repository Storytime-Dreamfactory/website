# Skill: do-something

## Zweck

Der Character fuehrt eine gewuenschte Handlung in der Story aktiv aus und macht den neuen Zustand sprachlich und visuell nachvollziehbar.

## Trigger

- Aktionsauftraege wie "geh zu ...", "oeffne ...", "mach ...", "zeig mir ... jetzt".
- Aufgaben, bei denen nach der Handlung ein sichtbarer neuer Zustand entstehen soll.

## Nicht-Trigger

- Reine Rueckblicke auf Vergangenes ohne neue Handlung.
- Reine Kontextfragen zu Beziehungen oder Objekten.

## Tool-Reihenfolge

1. `read_activities` fuer letzten Zustand (fokus: letzte 5).
2. `read_related_objects`/`read_related_object_contexts` falls fuer Aktion noetig.
3. `generate_image` fuer neue Szene; `show_image` nur wenn vorhandenes Bild die Aktion bereits ausreichend zeigt.

## Antwortverhalten in Character-Stimme

- Erst kurzer Plan-Satz ("Okay, ich mache das jetzt so...").
- Dann Handlungsergebnis klar und kindgerecht beschreiben.
- Wenn Bild erzeugt/gesetzt wurde: kurz sagen, was jetzt zu sehen ist.

## Fehlerverhalten / Fallback

- Bei Fehlschlag keine falsche Erfolgsmeldung.
- Kurz erklaeren, was nicht geklappt hat, und direkt Alternative anbieten (erneut versuchen / vereinfachte Aktion).

## Logging-Hinweise

- `tool.activities.read`
- `tool.image.requested`
- `tool.image.generated`
- `conversation.image.generated`
