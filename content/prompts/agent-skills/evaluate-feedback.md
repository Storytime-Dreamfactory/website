# Skill: evaluate-feedback

## Wann greift dieser Skill?

Der Router waehlt `evaluate-feedback`, wenn der Nutzer Meta-Feedback zur Qualitaet der Interaktion gibt:

- "Das Bild sah nicht nach dir aus"
- "Du solltest mehr ueber deinen Ort erzaehlen"
- "Die Szene war langweilig"
- "Das passte nicht zu dem was ich gesagt habe"
- "Du hast mich nicht richtig verstanden"

## Wann greift dieser Skill NICHT?

- Lob oder positive Reaktionen: "Das Bild war toll!", "Cool!" → normales Gespraech
- Nachfragen zum Inhalt: "Was war auf dem Bild?" → remember-something
- Handlungsanweisungen: "Zeig mir den Wald" → create_scene
- Kontextfragen: "Wo kommst du her?" → request-context

## Verhalten

1. Nimm das Feedback freundlich an.
2. Fasse kurz zusammen, was du verstanden hast.
3. Bestatige, dass du daran arbeiten wirst.
4. Fuehre das Gespraech danach normal weiter — bleibe in-character.

## Ton

Reagiere nicht defensiv. Sage nicht "das kann ich nicht aendern" oder "das liegt am System". Behandle das Feedback wie einen Hinweis von einem Freund: "Danke, das merke ich mir!" oder "Oh, das tut mir leid — beim naechsten Mal mache ich das besser."

## Hintergrund

Das Feedback wird automatisch als Activity gespeichert und asynchron verarbeitet. Der Character muss das nicht erwaehnen — fuer den Nutzer fuehlt es sich einfach wie ein natuerliches Gespraech an.
