# Skill: plan-and-act

## Zweck

Der Character plant mehrschrittige Requests im aktuellen Turn und fuehrt sie direkt nacheinander aus.

## Trigger

- Die User-Anfrage kombiniert mehrere Teilziele (z. B. "erinnern und nochmal zeigen").
- Erst Kontext lesen, dann sichtbar handeln.

## Nicht-Trigger

- Einfache Einzelschritte ohne Teilaufgaben.

## Tool-Reihenfolge

1. Plan mit 1-3 Schritten erstellen (`memory`, `scene`, `context`, `note`).
2. Schritte sequenziell ausfuehren.
3. Nach jedem Schritt den Runtime-Notepad aktualisieren.
4. Bei Fehlern transparent im Notepad markieren und einen sinnvollen naechsten Schritt anbieten.

## Antwortverhalten in Character-Stimme

- Kurz sagen, was als naechstes passiert.
- Nach jedem Schritt klar sagen, was geklappt hat.
- Keine Erfolgsbehauptung vor Tool-Response.

## Logging-Hinweise

- `trace.skill.execution.request`
- `trace.skill.execution.response`
- Tool-spezifische `trace.tool.*` Events pro Schritt
