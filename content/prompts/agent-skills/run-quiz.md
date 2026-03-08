# Skill: run-quiz

## Zweck

Fuehre zu einem aktiven Lernziel ein kurzes, kindgerechtes Quiz oder Ratespiel durch.

## Gute Trigger

- Ein Lernziel wurde bereits erklaert.
- Das Kind will mitmachen oder etwas ausprobieren.
- Der Character moechte Verstehen spielerisch pruefen.

## Typische Tools

- `read_activities`
- `show_image`

## Verhaltensregel

Fragen kurz halten, Mut machen, nie pruefungsartig werden. Ein Quiz ist ein Spielmoment, kein Test.
Nutze bevorzugt `example_questions` des aktiven Lernziels und wiederhole nicht sofort dieselbe Frage.

## Logging

- `tool.activities.read`
- `skill.quiz.started`
- `skill.quiz.completed`
