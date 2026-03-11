# Agent Skills

Dieses Verzeichnis definiert den **Standard fuer Agent-Skills**.

## Was ein Skill ist

Ein Skill ist ein wiederverwendbares Verhaltens-Playbook fuer Runtime-Agents:

- Er beschreibt **Ablauf und Prioritaeten** eines Character-Verhaltens.
- Er definiert **welche Tools in welcher Reihenfolge** genutzt werden.
- Er steuert **wie der Character spricht**, waehrend Tools laufen und nachdem Ergebnisse vorliegen.

Ein Skill ist **kein Tool** und **kein Fachinhalt**, sondern reine Verhaltenslogik.

## Runtime- und Router-Vertrag

Der Router waehlt den Skill. Die Runtime fuehrt ihn aus.

- Skill-IDs muessen stabil, eindeutig und router-tauglich sein.
- Jeder Skill braucht klare Trigger und klare Ausschluesse.
- Skill-Beschreibung darf keine widerspruechlichen Tool-Entscheidungen enthalten.
- Skill-Text muss deterministisch genug sein, dass Runtime-Execution konsistent bleibt.

## Skill-Grenzen

Ein guter Skill hat enge Grenzen:

- **Startbedingung:** Wann wird dieser Skill aktiviert?
- **Stopbedingung:** Wann ist der Skill abgeschlossen?
- **Nicht-Zustaendig:** Welche Anfragen gehoeren explizit in andere Skills?
- **Tool-Budget:** Welche Tools sind erlaubt, optional oder verboten?

## Tool-Zusammenspiel

Skills orchestrieren Tools, sie ersetzen Tools nicht.

- Erst Kontext lesen, dann handeln.
- Keine Erfolgsbehauptung vor Tool-Response.
- Bei Fehlern ehrlich bleiben, kindgerecht erklaeren, sinnvollen naechsten Schritt anbieten.
- Wenn ein bestehendes Bild reicht, bestehendes Bild verwenden statt blind neu zu generieren.

## Was einen guten Skill ausmacht

- Klarer Zweck in einem Satz.
- Eindeutige Trigger (positive und negative Beispiele).
- Konkrete Schrittfolge (1, 2, 3 ...).
- Klare Tool-Reihenfolge und Fallbacks.
- Kurze, in-Character Formulierungen fuer Plan-Satz und Ergebnis-Satz.
- Logging-Hinweise auf relevante Activity-/Trace-Typen.

## Standard-Iteration (Empfehlung)

Nutze `remember-something` als Standard-Muster fuer neue Tool-orchestrierte Skills.

Empfohlene Reihenfolge in der Umsetzung:

1. Intent stabil machen (Router-Fallbacks fuer natuerliche Formulierungen, nicht nur JSON-Flags).
2. Skill-Flow als feste Kette definieren: `context -> select -> inspect -> act`.
3. Kontext-Tools zuerst hart machen (`read_activities`, dann `read_conversation_history`, inkl. IDs).
4. Aktion strikt machen (`show_image` mit preselected Bild-ID/URL, kein stiller latest-Fallback).
5. Degraded Fallback einbauen (wenn Routing leer ist, trotzdem sinnvollen Skill ausfuehren).
6. Trace transparent machen (vor/nach Degraded-Entscheidung sichtbar loggen).
7. Mit Eval-Szenario iterieren (z. B. "glitzernder Stein"), dann erst finalisieren.

Wichtig in der Iteration:

- Nicht nur auf "funktioniert irgendwie" testen, sondern auf Reihenfolge und Determinismus.
- Immer erst vorhandenen Kontext auswerten; keine vorzeitige Tool-Erfolgsbehauptung.
- Default-Scope fuer Retrieval klar halten (`external`) und `all` nur explizit.
- Objekt- und Bild-IDs immer durchreichen, damit Folgetools deterministisch arbeiten.
- Wenn Memory leer ist, klaren Fallback liefern (z. B. Charakterbild) statt `null`.

## Dateikonvention

Jede Skill-Datei in diesem Ordner soll enthalten:

1. Zweck
2. Trigger
3. Nicht-Trigger
4. Tool-Reihenfolge
5. Antwortverhalten in Character-Stimme
6. Fehlerverhalten/Fallback
7. Logging-Hinweise

## Aktuelle Skills

- `remember-something`
- `create_scene`
- `request-context`
