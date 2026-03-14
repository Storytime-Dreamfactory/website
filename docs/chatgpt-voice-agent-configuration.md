# ChatGPT Voice Agent Configuration (Realtime API)

Diese Datei ist eine kompakte Referenz fuer die Konfiguration eines Voice Agents mit der OpenAI Realtime API (`/v1/realtime/sessions` und `session.update`).

## Kernidee

Die Sprachkonfiguration sitzt in der Session. Du definierst dort:

- welche Stimme gesprochen wird,
- wie Audio rein/raus formatiert wird,
- wie Turn Detection (VAD) funktioniert,
- ob und wie transkribiert wird,
- wie stark der Agent variiert (`temperature`) und
- welche Tools/Modi aktiviert sind.

## Relevante Session-Felder (Voice)

### 1) Stimme und Ausgabe

- `voice`  
  Eingebaute Stimmen: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`, `marin`, `cedar`  
  Optional auch Custom Voice Object: `{ "id": "voice_1234" }`  
  Hinweis: Stimme kann nach erster Audio-Ausgabe nicht mehr frei gewechselt werden.

- `speed`  
  Sprechgeschwindigkeit, typischer Bereich `0.25` bis `1.5`, Standard `1.0`.

- `modalities` bzw. `output_modalities`  
  Realtime-Antwortmodus, typischerweise `["audio"]` oder `["text"]`.

- `max_response_output_tokens` / `max_output_tokens`  
  Token-Limit pro Antwort (`1..4096` oder `"inf"`).

### 2) Audio-Formate

- `input_audio_format`  
  `pcm16` | `g711_ulaw` | `g711_alaw`

- `output_audio_format`  
  `pcm16` | `g711_ulaw` | `g711_alaw`

### 3) Turn Detection (Server VAD)

- `turn_detection.type`  
  aktuell `server_vad`

- `turn_detection.threshold`  
  VAD-Schwelle (`0.0..1.0`), hoeher = unempfindlicher.

- `turn_detection.prefix_padding_ms`  
  Audio vor Sprechbeginn, das noch einbezogen wird.

- `turn_detection.silence_duration_ms`  
  Wie lange Stille bis Turn-Ende angenommen wird.

- `turn_detection.create_response`  
  Ob automatisch eine Antwort erzeugt wird, wenn Turn endet.

- `turn_detection.interrupt_response`  
  Ob laufende Agent-Antwort bei neuem User-Sprechen unterbrochen wird.

### 4) Eingabe-Transkription

- `input_audio_transcription.model`  
  z. B. `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `whisper-1`.

- optional je nach API-Version auch im `audio.input.transcription`-Objekt:  
  `language`, `prompt` usw.

### 5) Tools und Verhalten

- `instructions`  
  Systemverhalten fuer Tonalitaet, Stil, Safety, Dialogfuehrung.

- `tools`  
  Function-Tools fuer Runtime-Aktionen.

- `tool_choice`  
  `auto`, `none`, `required` oder gezielter Function-Call.

- `temperature`  
  Sampling-Temperatur (typisch Realtime: `0.6..1.2`, Standard oft `0.8`).

- `tracing`  
  Aktiviert Tracing fuer Diagnose/Observability.

## Beispiel: Session-Create (Voice-fokussiert)

```json
{
  "model": "gpt-realtime",
  "voice": "marin",
  "instructions": "Sprich freundlich, klar und kurz.",
  "modalities": ["audio"],
  "input_audio_format": "pcm16",
  "output_audio_format": "pcm16",
  "input_audio_transcription": {
    "model": "gpt-4o-mini-transcribe"
  },
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.5,
    "prefix_padding_ms": 300,
    "silence_duration_ms": 600,
    "create_response": true,
    "interrupt_response": false
  },
  "temperature": 0.8,
  "max_response_output_tokens": "inf"
}
```

## Session-Update Hinweis

`session.update` kann viele Felder live anpassen (z. B. VAD, Instructions, Tools).  
`voice` ist nur eingeschraenkt aenderbar, sobald bereits Audio ausgegeben wurde.

## Storytime: aktuell gesetzte Voice-Konfiguration

In der aktuellen Implementierung (`src/server/realtimePlugin.ts`) werden gesetzt:

- `model: "gpt-realtime"`
- `voice: <aus Client, Fallback "coral">`
- `instructions: <Character + Context Prompt>`
- `tools: [unmute_user_microphone]`
- `input_audio_transcription.model: "gpt-4o-mini-transcribe"`
- `turn_detection.type: "server_vad"`
- `turn_detection.create_response: true`
- `turn_detection.interrupt_response: false`
- `turn_detection.silence_duration_ms: 900`

Nicht explizit gesetzt (laufen auf API-Defaults): u. a. `speed`, `input_audio_format`, `output_audio_format`, `temperature`, `max_response_output_tokens`, `tool_choice`, `tracing`, `threshold`, `prefix_padding_ms`.

## Offizielle Referenz

- [Realtime Sessions API](https://developers.openai.com/api/reference/resources/realtime/subresources/sessions/)
- [Realtime Client Events (`session.update`)](https://developers.openai.com/api/reference/resources/realtime/client-events)
