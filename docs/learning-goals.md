# Learning Goals

Diese Datei beschreibt, was `Learning Goals` in Storytime sind, wie sie gedacht
sind und wie neue Lernziel-YAMLs erstellt werden sollen.

Pfad im Repository:

- `content/learning-goals/<uuid>/<slug>.yaml`

Dabei gilt:

- der Ordnername ist die kanonische UUID
- der Dateiname ist der lesbare fachliche Slug
- im YAML selbst bleibt `id` die kanonische Referenz

## Was ein Learning Goal ist

Ein `Learning Goal` ist in Storytime keine lose Themenmarke und auch kein
abstraktes Fachgebiet wie `Mathematik`, `Demokratie` oder `Englisch` als Ganzes.

Ein `Learning Goal` beschreibt stattdessen immer:

- eine einzelne, klar begrenzte Lerneinheit
- die in ungefaehr 30 Minuten vermittelt werden kann
- mit einem Character als dialogischer Lehrfigur
- und einem kurzen, offenen Quiz am Ende

Kurzform:

- Ein Fach hat viele Themenfelder.
- Ein Themenfeld hat viele moegliche Sessions.
- Ein `Learning Goal` ist genau eine solche Session.

Beispiele:

- gut: `Zahlen ordnen`, `Sich auf Englisch vorstellen`, `Faire Entscheidungen in Gruppen`
- zu gross: `Mathematik`, `Englisch`, `Geschichte`, `Demokratie`

## Unser Konzept

Storytime ist kein klassisches Aufgabenblatt-System. Kinder lernen in einer
spielerischen Unterhaltung mit Characters. Die Characters erklaeren Inhalte,
stellen Rueckfragen, geben kleine Hinweise und fuehren am Ende ein kurzes Quiz
durch.

Deshalb muss ein `Learning Goal` mehr leisten als nur ein Thema zu nennen.
Es muss so konkret sein, dass ein Character daraus eine gute Session bauen kann.

Ein gutes `Learning Goal` beantwortet mindestens diese Fragen:

- Was soll das Kind in dieser Session lernen?
- Welche Kernideen soll der Character vermitteln?
- Welche Alltagsszenen oder Beispiele passen dazu?
- Welche typischen Missverstaendnisse koennen auftreten?
- Was darf im Quiz abgefragt werden?
- Woran erkennt das System eine inhaltlich passende Antwort?

## Didaktisches Modell

Storytime arbeitet LLM-gestuetzt, aber nicht beliebig. Die YAMLs geben dem
System klare fachliche Leitplanken.

Das bedeutet:

- Die Character formulieren Fragen flexibel und kindgerecht.
- Das Quiz ist offen und nicht deterministisch.
- Die inhaltliche Richtung bleibt trotzdem klar ueber das YAML.

Ein `Learning Goal` soll daher immer drei Ebenen abbilden:

1. Fachlicher Inhalt
   Was wird beigebracht?
2. Vermittlungslogik
   Wie fuehrt der Character durch das Thema?
3. Quizlogik
   Was wird geprueft und woran erkennt man gute Antworten?

## Abgrenzung zu anderen Objekten

- `Learning Goals` beschreiben fachlichen Inhalt.
- `Characters` beschreiben Persoenlichkeit, Stimme, Stil und Lehrhaltung.
- `Skills` beschreiben agentisches Verhalten in der Runtime.
- `Tools` sind konkrete technische Aktionen.

Wichtig:

- Ein `Learning Goal` enthaelt keine Character-Identitaet.
- Ein `Learning Goal` enthaelt keine Runtime-Tool-Logik.
- Ein `Learning Goal` enthaelt keine komplette Unterrichtsreihe.

## Grundregel fuer neue Lernziele

Ein neues Lernziel soll immer als **eine teachable session** geschrieben werden.

Prueffrage:

`Kann ein einzelner Character dieses Ziel in etwa 30 Minuten erklaeren, mit dem Kind ueben und danach kurz quizzen?`

Wenn die Antwort `nein` ist, ist das Lernziel noch zu gross und muss aufgeteilt
werden.

## Empfohlenes Denkmuster

Beim Schreiben eines Lernziels hilft dieses Raster:

- `subject`
  Das Fach oder der grobe Bildungsbereich, z. B. `mathematik`, `english`,
  `sachkunde`, `sozialkompetenz`.
- `topic_group`
  Die grobe Themenklammer innerhalb des Fachs, z. B. `Mathematik`,
  `Demokratie`, `Soziales Lernen`, `Speaking`.
- `topic`
  Die konkrete Session.
- `subtopic`
  Der noch genauere Fokus der Session.

Beispiel:

- `subject: mathematik`
- `topic_group: Mathematik`
- `topic: Zahlen ordnen`
- `subtopic: Groesser, kleiner und dazwischen`

## Aufbau eines guten Learning Goals

### 1. Kopf und Einordnung

Diese Felder ordnen das Lernziel fachlich ein:

- `id`
- `name`
- `type: learning-goals`
- `subject`
- `topic_group`
- `topic`
- `subtopic`
- `description`
- `age_range`

### 2. Session

Der Block `session` beschreibt die einzelne Lerneinheit:

- `duration_minutes`
- `format`
- `session_goal`
- `end_state`

Hier wird nicht nur das Thema benannt, sondern der konkrete Zielzustand nach
der Session beschrieben.

### 3. Fachlicher Inhalt

Der Block `teaching_content` beschreibt, was der Character wirklich vermitteln
soll:

- `core_ideas`
- `key_vocabulary`
- `examples`
- `misconceptions`

Besonders wichtig:

- `core_ideas` sind die eigentlichen Unterrichtsinhalte
- `misconceptions` helfen dem Character und dem Quiz, typische Denkfehler zu
  erkennen

### 4. Vermittlung

Der Block `didactics` beschreibt, wie das Thema vermittelt werden soll:

- `pedagogy`
- `character_role`
- `teaching_steps`
- `interaction_rules`

Dieser Block ist wichtig, damit Storytime nicht wie ein starres Lernprogramm
klingt, sondern wie eine kindgerechte Begleitung.

### 5. Lernziele im engeren Sinn

Der Block `learning_objectives` beschreibt beobachtbar, was das Kind am Ende
koennen oder verstehen soll.

Jedes Ziel sollte:

- klein genug sein
- konkret formulierbar sein
- beobachtbare `evidence` enthalten

Schlecht:

- `Das Kind versteht Mathematik besser.`

Gut:

- `Das Kind kann sagen, welche von zwei Zahlen groesser ist.`

### 6. Quiz

Der Block `quiz` ist fuer Storytime zentral. Das Quiz soll offen bleiben, aber
inhaltlich klar gelenkt sein.

Darum braucht ein gutes Lernziel:

- `goal`
- `assessment_targets`
- `allowed_question_types`
- `example_questions`
- `example_tasks`
- `answer_expectations`
- `feedback_strategy`

Wichtig:

- `example_questions` sind Beispiele, keine starre Liste
- `assessment_targets` sagen, was ueberhaupt geprueft werden darf
- `answer_expectations` definieren, woran eine starke, akzeptable oder
  missverstaendliche Antwort erkannt wird
- `feedback_strategy` hilft dem Character, bei Unsicherheit gut weiterzufuehren

## Was ein gutes Quiz in Storytime ausmacht

Das Quiz ist nicht deterministisch. Es soll nicht wie ein Multiple-Choice-Test
wirken, sondern wie eine kurze, inhaltlich gefuehrte Rueckfrage des Characters.

Darum gilt:

- lieber offene Fragen als starre Abfrage
- lieber Transfer auf kleine Situationen als reine Reproduktion
- lieber ein kurzer Denkprozess als nur richtig oder falsch

Ein gutes Quiz prueft typischerweise:

- Verstehen
- Anwenden
- Vergleichen
- Begruenden
- Transfer

## Authoring-Regeln

### Do

- Schreibe immer fuer genau eine Session.
- Formuliere kindgerecht, klar und konkret.
- Nutze alltagsnahe Beispiele.
- Denke vom Character aus: Was kann er erklaeren, zeigen und nachfragen?
- Beschreibe typische Missverstaendnisse.
- Formuliere Quizfragen offen genug fuer LLM-Variation.
- Schreibe `learning_objectives` beobachtbar.

### Don't

- Kein ganzes Fachgebiet in ein YAML packen.
- Keine unklaren Ziele wie `Kind soll besser in Mathe werden`.
- Keine rein abstrakten Erwachsenenformulierungen.
- Keine zu grossen Stoffmengen fuer 30 Minuten.
- Keine deterministische Aufgabenbank als einziges Quizmodell.
- Keine Character-spezifischen Rollen oder Namen in das Lernziel schreiben.

## Qualitaetscheck vor dem Speichern

Vor jedem neuen Lernziel diese Fragen durchgehen:

- Ist das wirklich nur eine Session?
- Ist klar, was der Character beibringen soll?
- Gibt es 3-5 Kernideen statt nur ein Schlagwort?
- Gibt es alltagsnahe Beispiele?
- Gibt es typische Missverstaendnisse?
- Ist das Quiz inhaltlich klar, aber sprachlich offen?
- Ist erkennbar, woran eine gute Kinderantwort gemessen wird?

## Kompaktes Beispiel

```yaml
id: 00000000-0000-0000-0000-000000000000
name: Zahlen ordnen
type: learning-goals
subject: mathematik
topic_group: Mathematik
topic: Zahlen ordnen
subtopic: Groesser, kleiner und dazwischen
description: >
  Helping children compare numbers, place them in order, and identify which
  number is bigger, smaller, or between two others.
age_range:
  - 5-7
  - 6-8
session:
  duration_minutes: 30
  format: one-at-a-time
  session_goal: >
    The child learns to compare numbers and place them in order using the
    ideas of bigger, smaller, and between.
  end_state: >
    The child can compare two numbers and identify a fitting number in between.
teaching_content:
  core_ideas:
    - Numbers can be compared by size.
    - Numbers follow a fixed order.
    - Some numbers fit between two other numbers.
learning_objectives:
  - id: compare-two-numbers
    can_do: The child can say which of two numbers is greater or smaller.
    evidence:
      - correctly identifies the bigger number
quiz:
  goal: >
    The quiz checks whether the child can compare numbers, order them, and
    identify a fitting number in between.
  example_questions:
    - Which number is bigger: 6 or 9?
```

## Praktische Faustformel

Wenn ein Lernziel gut ist, kann man es in einem Satz sagen:

`In dieser Session lernt das Kind X, uebt es mit dem Character an kleinen Beispielen und zeigt es am Ende in einem kurzen offenen Quiz.`

Wenn dieser Satz nicht klar formulierbar ist, ist das Lernziel meistens noch
nicht konkret genug.
