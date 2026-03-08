import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd'
import { parse, stringify } from 'yaml'
import type { StoryContent } from './content/types'

const { TextArea } = Input
const { Title, Text, Paragraph } = Typography

type AssetJob = {
  id: string
  type: string
  status: 'planned' | 'running' | 'generated' | 'skipped' | 'failed'
  publicFilePath: string
  description: string
}

type CharacterCreationJob = {
  id: string
  updatedAt: string
  phase: 'draft' | 'saving' | 'generating' | 'completed' | 'failed'
  message: string
  characterId?: string
  error?: string
  assets: AssetJob[]
}

type RelationshipEntry = {
  targetId: string
  type: string
  description: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const ensureRecord = (
  value: unknown,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> => (isRecord(value) ? value : { ...fallback })

const ensureStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const readRelationshipEntries = (value: unknown, key: 'character_id' | 'place_id'): RelationshipEntry[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(isRecord)
    .map((entry) => ({
      targetId: typeof entry[key] === 'string' ? entry[key] : '',
      type: typeof entry.typ === 'string' ? entry.typ : '',
      description: typeof entry.beschreibung === 'string' ? entry.beschreibung : '',
    }))
}

const stringifyYaml = (document: Record<string, unknown>): string => stringify(document, { lineWidth: 0 })

const fetchJson = async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? 'Unbekannter API-Fehler')
  }

  return data
}

const statusColor = (status: AssetJob['status']): string => {
  if (status === 'generated') return 'success'
  if (status === 'running') return 'processing'
  if (status === 'failed') return 'error'
  if (status === 'skipped') return 'default'
  return 'default'
}

export function CreateCharacterPage({
  content,
  onCharacterCreated,
}: {
  content: StoryContent
  onCharacterCreated: () => Promise<void> | void
}) {
  const [prompt, setPrompt] = useState('')
  const [yamlText, setYamlText] = useState('')
  const [currentStep, setCurrentStep] = useState(0)
  const [draftLoading, setDraftLoading] = useState(false)
  const [startLoading, setStartLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<CharacterCreationJob | null>(null)
  const completionHandledRef = useRef(false)

  const yamlDocument = useMemo(() => {
    if (!yamlText.trim()) {
      return null
    }

    try {
      const parsed = parse(yamlText) as unknown
      return ensureRecord(parsed)
    } catch {
      return null
    }
  }, [yamlText])

  const currentCharacterId =
    yamlDocument && typeof yamlDocument.id === 'string' ? yamlDocument.id : undefined

  const characterOptions = useMemo(
    () =>
      content.characters
        .filter((character) => character.id !== currentCharacterId)
        .map((character) => ({
          value: character.id,
          label: `${character.name} (${character.id})`,
        })),
    [content.characters, currentCharacterId],
  )

  const placeIdOptions = useMemo(
    () =>
      content.places.map((place) => ({
        value: place.id,
        label: `${place.name} (${place.id})`,
      })),
    [content.places],
  )

  const placeNameOptions = useMemo(
    () =>
      content.places.map((place) => ({
        value: place.name,
        label: place.name,
      })),
    [content.places],
  )

  const originData = useMemo(() => {
    const origin = ensureRecord(yamlDocument?.herkunft)
    return {
      birthPlace: typeof origin.geburtsort === 'string' ? origin.geburtsort : '',
      upbringingPlaces: ensureStringArray(origin.aufgewachsen_in),
      culturalContext: ensureStringArray(origin.kulturelle_praegung),
      religionOrBelief:
        typeof origin.religion_oder_weltbild === 'string' ? origin.religion_oder_weltbild : '',
      historicalContext: ensureStringArray(origin.historische_praegung),
      notes: typeof origin.notizen === 'string' ? origin.notizen : '',
    }
  }, [yamlDocument])

  const relationshipsData = useMemo(() => {
    const relationships = ensureRecord(yamlDocument?.relationships)
    return {
      characters: readRelationshipEntries(relationships.characters, 'character_id'),
      places: readRelationshipEntries(relationships.places, 'place_id'),
    }
  }, [yamlDocument])

  const updateYaml = (updater: (document: Record<string, unknown>) => void): void => {
    try {
      const parsed = parse(yamlText) as unknown
      const nextDocument = ensureRecord(parsed)
      updater(nextDocument)
      setYamlText(stringifyYaml(nextDocument))
      setError(null)
    } catch (yamlError) {
      setError(
        yamlError instanceof Error
          ? `YAML kann nicht ausgelesen werden: ${yamlError.message}`
          : 'YAML kann nicht ausgelesen werden.',
      )
    }
  }

  const patchOrigin = (
    key:
      | 'geburtsort'
      | 'aufgewachsen_in'
      | 'kulturelle_praegung'
      | 'religion_oder_weltbild'
      | 'historische_praegung'
      | 'notizen',
    value: unknown,
  ): void => {
    updateYaml((document) => {
      const origin = ensureRecord(document.herkunft)
      origin[key] = value
      document.herkunft = origin
    })
  }

  const patchRelationships = (
    bucket: 'characters' | 'places',
    nextEntries: RelationshipEntry[],
  ): void => {
    updateYaml((document) => {
      const relationships = ensureRecord(document.relationships)
      relationships[bucket] = nextEntries.map((entry) =>
        bucket === 'characters'
          ? {
              character_id: entry.targetId,
              typ: entry.type,
              beschreibung: entry.description,
            }
          : {
              place_id: entry.targetId,
              typ: entry.type,
              beschreibung: entry.description,
            },
      )
      document.relationships = relationships
    })
  }

  useEffect(() => {
    if (!job || job.phase === 'completed' || job.phase === 'failed') {
      return
    }

    const interval = window.setInterval(async () => {
      try {
        const nextJob = await fetchJson<CharacterCreationJob>(`/api/character-creator/jobs/${job.id}`)
        setJob(nextJob)
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : String(pollError))
      }
    }, 1500)

    return () => window.clearInterval(interval)
  }, [job])

  useEffect(() => {
    if (job?.phase === 'completed' && !completionHandledRef.current) {
      completionHandledRef.current = true
      void onCharacterCreated()
    }
  }, [job, onCharacterCreated])

  const generatedCount = useMemo(
    () => job?.assets.filter((asset) => asset.status === 'generated').length ?? 0,
    [job],
  )

  const progressPercent = useMemo(() => {
    if (!job || job.assets.length === 0) return 0
    return Math.round((generatedCount / job.assets.length) * 100)
  }, [generatedCount, job])

  const handleDraft = async (): Promise<void> => {
    setDraftLoading(true)
    setError(null)

    try {
      const draft = await fetchJson<{ yamlText: string }>('/api/character-creator/draft', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })
      setYamlText(draft.yamlText)
      setCurrentStep(1)
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : String(draftError))
    } finally {
      setDraftLoading(false)
    }
  }

  const handleStartGeneration = async (): Promise<void> => {
    setStartLoading(true)
    setError(null)
    completionHandledRef.current = false

    try {
      const startResponse = await fetchJson<{ jobId: string }>('/api/character-creator/start', {
        method: 'POST',
        body: JSON.stringify({ yamlText, prompt }),
      })
      const nextJob = await fetchJson<CharacterCreationJob>(
        `/api/character-creator/jobs/${startResponse.jobId}`,
      )
      setJob(nextJob)
      setCurrentStep(2)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setStartLoading(false)
    }
  }

  return (
    <section className="content-section">
      <Title level={2} className="section-title">
        Create Character
      </Title>
      <Text className="home-subtitle">
        Beschreibe zuerst deine Figur in einem Freitext. Danach ueberarbeitest du das YAML
        und startest erst dann die Bildgenerierung.
      </Text>

      {error && (
        <Alert
          className="state-box"
          type="error"
          showIcon
          message="Character-Erstellung fehlgeschlagen"
          description={error}
        />
      )}

      <Card className="wizard-shell" size="small">
        <Steps
          current={currentStep}
          size="small"
          items={[
            { title: 'Beschreibung' },
            { title: 'YAML pruefen' },
            { title: 'Assets generieren' },
          ]}
        />

        {currentStep === 0 && (
          <div className="wizard-panel">
            <Paragraph className="wizard-copy">
              Beispiel: Eine mutige kleine Fuchsentdeckerin namens Romi mit orangefarbenem Fell,
              gruener Jacke, grossen neugierigen Augen und einem Kompassbeutel.
            </Paragraph>
            <TextArea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder="Beschreibe den Character..."
            />
            <div className="wizard-actions">
              <Button type="primary" loading={draftLoading} onClick={() => void handleDraft()}>
                YAML-Entwurf erstellen
              </Button>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="wizard-panel">
            <Paragraph className="wizard-copy">
              Pruefe jetzt das erzeugte YAML. Du kannst alles direkt anpassen, bevor gespeichert
              und generiert wird.
            </Paragraph>
            <Row gutter={[12, 12]}>
              <Col xs={24} xl={10}>
                <Card className="wizard-side-card" title="Herkunft" size="small">
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <Input
                      size="small"
                      value={originData.birthPlace}
                      onChange={(event) => patchOrigin('geburtsort', event.target.value)}
                      placeholder="Geburtsort"
                    />
                    <Select
                      size="small"
                      mode="tags"
                      value={originData.upbringingPlaces}
                      onChange={(value) => patchOrigin('aufgewachsen_in', value)}
                      placeholder="Aufgewachsen in"
                      options={placeNameOptions}
                    />
                    <Select
                      size="small"
                      mode="tags"
                      value={originData.culturalContext}
                      onChange={(value) => patchOrigin('kulturelle_praegung', value)}
                      placeholder="Kulturelle Praegung"
                    />
                    <Input
                      size="small"
                      value={originData.religionOrBelief}
                      onChange={(event) =>
                        patchOrigin('religion_oder_weltbild', event.target.value)
                      }
                      placeholder="Religion oder Weltbild"
                    />
                    <Select
                      size="small"
                      mode="tags"
                      value={originData.historicalContext}
                      onChange={(value) => patchOrigin('historische_praegung', value)}
                      placeholder="Historische Praegung"
                    />
                    <TextArea
                      rows={3}
                      value={originData.notes}
                      onChange={(event) => patchOrigin('notizen', event.target.value)}
                      placeholder="Notizen zur Herkunft"
                    />
                  </Space>
                </Card>

                <Card className="wizard-side-card" title="Relationships zu Characters" size="small">
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {relationshipsData.characters.map((entry, index) => (
                      <div className="relationship-editor-row" key={`character-${index}`}>
                        <Select
                          size="small"
                          value={entry.targetId || undefined}
                          onChange={(value) =>
                            patchRelationships(
                              'characters',
                              relationshipsData.characters.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, targetId: value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Character"
                          options={characterOptions}
                        />
                        <Input
                          size="small"
                          value={entry.type}
                          onChange={(event) =>
                            patchRelationships(
                              'characters',
                              relationshipsData.characters.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, type: event.target.value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Typ, z. B. Schwester, Mentor, Freund"
                        />
                        <Input
                          size="small"
                          value={entry.description}
                          onChange={(event) =>
                            patchRelationships(
                              'characters',
                              relationshipsData.characters.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, description: event.target.value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Beschreibung"
                        />
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            patchRelationships(
                              'characters',
                              relationshipsData.characters.filter((_, currentIndex) => currentIndex !== index),
                            )
                          }
                        >
                          Entfernen
                        </Button>
                      </div>
                    ))}
                    <Button size="small"
                      onClick={() =>
                        patchRelationships('characters', [
                          ...relationshipsData.characters,
                          { targetId: '', type: '', description: '' },
                        ])
                      }
                    >
                      Character-Relationship hinzufuegen
                    </Button>
                  </Space>
                </Card>

                <Card className="wizard-side-card" title="Relationships zu Orten" size="small">
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {relationshipsData.places.map((entry, index) => (
                      <div className="relationship-editor-row" key={`place-${index}`}>
                        <Select
                          size="small"
                          value={entry.targetId || undefined}
                          onChange={(value) =>
                            patchRelationships(
                              'places',
                              relationshipsData.places.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, targetId: value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Ort"
                          options={placeIdOptions}
                        />
                        <Input
                          size="small"
                          value={entry.type}
                          onChange={(event) =>
                            patchRelationships(
                              'places',
                              relationshipsData.places.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, type: event.target.value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Typ, z. B. home, sanctuary, school"
                        />
                        <Input
                          size="small"
                          value={entry.description}
                          onChange={(event) =>
                            patchRelationships(
                              'places',
                              relationshipsData.places.map((currentEntry, currentIndex) =>
                                currentIndex === index
                                  ? { ...currentEntry, description: event.target.value }
                                  : currentEntry,
                              ),
                            )
                          }
                          placeholder="Beschreibung"
                        />
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            patchRelationships(
                              'places',
                              relationshipsData.places.filter((_, currentIndex) => currentIndex !== index),
                            )
                          }
                        >
                          Entfernen
                        </Button>
                      </div>
                    ))}
                    <Button size="small"
                      onClick={() =>
                        patchRelationships('places', [
                          ...relationshipsData.places,
                          { targetId: '', type: '', description: '' },
                        ])
                      }
                    >
                      Ort-Relationship hinzufuegen
                    </Button>
                  </Space>
                </Card>
              </Col>

              <Col xs={24} xl={14}>
                <Card className="wizard-side-card" title="YAML Vorschau" size="small">
                  <TextArea value={yamlText} onChange={(event) => setYamlText(event.target.value)} rows={24} />
                  {!yamlDocument && (
                    <>
                      <Divider />
                      <Alert
                        type="warning"
                        showIcon
                        message="YAML kann gerade nicht geparst werden"
                        description="Bitte korrigiere die YAML-Syntax, damit die Herkunfts- und Relationship-UI wieder synchronisiert werden kann."
                      />
                    </>
                  )}
                </Card>
              </Col>
            </Row>
            <div className="wizard-actions">
              <Space wrap>
                <Button onClick={() => setCurrentStep(0)}>Zurueck</Button>
                <Button
                  type="primary"
                  loading={startLoading}
                  onClick={() => void handleStartGeneration()}
                >
                  Character speichern und Bilder generieren
                </Button>
              </Space>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="wizard-panel">
            <div className="generation-header">
              <div>
                <Title level={4}>Generierungsstatus</Title>
                <Text>{job?.message ?? 'Initialisiere Job...'}</Text>
              </div>
              <Tag color={job?.phase === 'completed' ? 'success' : job?.phase === 'failed' ? 'error' : 'processing'}>
                {job?.phase ?? 'starting'}
              </Tag>
            </div>

            <Progress percent={progressPercent} status={job?.phase === 'failed' ? 'exception' : undefined} />

            <Row gutter={[12, 12]}>
              {job?.assets.map((asset) => (
                <Col key={asset.id} xs={24} sm={12} lg={6}>
                  <Card className="generation-asset-card" size="small">
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <div className="generation-asset-head">
                        <Text strong>{asset.type}</Text>
                        <Tag color={statusColor(asset.status)}>{asset.status}</Tag>
                      </div>
                      <div className="generation-asset-image-shell">
                        {asset.status === 'generated' ? (
                          <img
                            src={`${asset.publicFilePath}?t=${encodeURIComponent(job?.updatedAt ?? '')}`}
                            alt={asset.type}
                            className="generation-asset-image"
                          />
                        ) : (
                          <div className="generation-asset-placeholder">
                            <Text>
                              {asset.status === 'running'
                                ? 'Wird gerade generiert...'
                                : 'Bild erscheint hier, sobald es fertig ist.'}
                            </Text>
                          </div>
                        )}
                      </div>
                      <Text type="secondary">{asset.description}</Text>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>

            {job?.phase === 'completed' && (
              <Alert
                type="success"
                showIcon
                message="Character erfolgreich erstellt"
                description={`Der Character ${job.characterId ?? ''} wurde gespeichert und die Bilder sind verfuegbar.`}
              />
            )}

            {job?.phase === 'failed' && (
              <Alert
                type="error"
                showIcon
                message="Generierung fehlgeschlagen"
                description={job.error ?? job.message}
              />
            )}
          </div>
        )}
      </Card>
    </section>
  )
}

export default CreateCharacterPage
