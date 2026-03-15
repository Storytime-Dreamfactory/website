import pg from 'pg'
import crypto from 'node:crypto'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { parse as parseYaml } from 'yaml'

const { Pool } = pg

const RUNTIME_SECRET_ARN = process.env.RUNTIME_SECRET_ARN || ''
const CONTENT_BUCKET = process.env.CONTENT_BUCKET || ''
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1'
const secretsManager = new SecretsManagerClient({ region: AWS_REGION })
const s3 = new S3Client({ region: AWS_REGION })

let pool = null
let poolDatabaseUrl = ''
let cachedRuntimeConfig = null

const readOptionalString = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const readBody = async (stream) => {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const readBodyBuffer = async (stream) => {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const getRuntimeConfigFromSecret = async () => {
  if (cachedRuntimeConfig) return cachedRuntimeConfig
  if (!RUNTIME_SECRET_ARN) {
    throw new Error('RUNTIME_SECRET_ARN fehlt.')
  }
  const value = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: RUNTIME_SECRET_ARN,
    }),
  )
  const parsed = value.SecretString ? JSON.parse(value.SecretString) : {}
  const config = {
    databaseUrl: readOptionalString(parsed.DATABASE_URL),
    openAiApiKey: readOptionalString(parsed.OPENAI_API_KEY),
  }
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL fehlt im Runtime-Secret.')
  }
  cachedRuntimeConfig = config
  return config
}

const getPool = (databaseUrl) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL fehlt.')
  }
  if (pool && poolDatabaseUrl === databaseUrl) return pool
  if (pool) {
    void pool.end().catch(() => undefined)
  }
  poolDatabaseUrl = databaseUrl
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 4,
  })
  return pool
}

const parseJobIdFromRecord = (record) => {
  const body = typeof record?.body === 'string' ? record.body : ''
  if (!body) throw new Error('SQS-Nachricht ohne Body.')
  const parsed = JSON.parse(body)
  const jobId = readOptionalString(parsed.jobId)
  if (!jobId) throw new Error('jobId fehlt in Queue-Message.')
  return jobId
}

const appendStep = async (db, input) => {
  await db.query(
    `
    INSERT INTO character_creation_steps (
      job_id,
      step_name,
      status,
      metadata,
      error
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    `,
    [
      input.jobId,
      input.stepName,
      input.status,
      JSON.stringify(input.metadata ?? {}),
      input.error || null,
    ],
  )
}

const appendOutboxEvent = async (db, input) => {
  await db.query(
    `
    INSERT INTO event_outbox (
      aggregate_type,
      aggregate_id,
      event_type,
      event_key,
      payload,
      status
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
    ON CONFLICT (event_key) DO NOTHING
    `,
    [
      'character_creation_job',
      input.jobId,
      input.eventType,
      `character_creation_job:${input.jobId}:${input.eventType}`,
      JSON.stringify(input.payload ?? {}),
    ],
  )
}

const escapeYamlValue = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

const extractCharacterIdFromYaml = (yamlText) => {
  const match = yamlText.match(/^\s*id:\s*"?([0-9a-fA-F-]{36})"?\s*$/m)
  return match ? match[1] : null
}

const buildFallbackCharacterYaml = ({ characterId, prompt }) => {
  const today = new Date().toISOString().slice(0, 10)
  const cleanedPrompt = readOptionalString(prompt) || 'Ein freundlicher Character fuer Storytime.'
  return `id: "${characterId}"
name: "Neuer Character"
kurzbeschreibung: >
  ${escapeYamlValue(cleanedPrompt)}
basis:
  age_hint: kindlich
  species: Fantasiewesen
  gender_expression: androgyn
  role_archetype: learner
voice: alloy
voice_profile:
  identity: warme, freundliche Erzaehlstimme
  demeanor: zugewandt und neugierig
  tone: klar und kindgerecht
  enthusiasm_level: hoch
  formality_level: locker
  emotion_level: ausgewogen
  filler_words: none
  pacing: ruhig und lebendig
erscheinung:
  body_shape: klein und freundlich
  colors:
    - blau
    - orange
    - weiss
  hair_or_fur:
    color: orange
    texture: weich
    length: kurz
  eyes:
    color: braun
    expression: freundlich
  distinctive_features:
    - runde Ohren
    - kleiner Schal
    - frisches Laecheln
  clothing_style: einfacher Abenteuer-Look
persoenlichkeit:
  core_traits:
    - neugierig
    - mutig
    - hilfsbereit
  temperament: lebhaft
  social_style: offen
  strengths:
    - hoert gut zu
    - probiert neue Dinge
  weaknesses:
    - wird schnell ungeduldig
    - zweifelt manchmal
  quirks:
    - summt beim Denken
    - sammelt kleine Steine
story_psychology:
  visible_goal: moechte neue Orte entdecken
  deeper_need: moechte Sicherheit und Zugehoerigkeit spuern
  fear: im Dunkeln allein zu sein
  insecurity: "Ich bin vielleicht noch nicht stark genug."
  stress_response: hesitate_then_try
  growth_direction: lernt, ruhig zu bleiben und Hilfe anzunehmen
learning_function:
  teaching_roles:
    - learner
    - helper
  suitable_learning_goals:
    - geduld
    - mut
  explanation_style: question_based
herkunft:
  geburtsort: Morgenlicht-Wiese
  aufgewachsen_in:
    - Morgenlicht-Wiese
  kulturelle_praegung:
    - gemeinsames Helfen
    - liebevolle Erzaehlabende
  religion_oder_weltbild: ""
  historische_praegung:
    - Geschichten ueber Zusammenhalt
  notizen: Herkunft dient als warmer Weltanker.
relationships:
  characters: []
  places: []
bilder:
  standard_figur:
    datei: /content/characters/${characterId}/standard-figur.png
    beschreibung: >
      Freigestellte Ganzkoerperfigur mit klarer Silhouette.
  hero_image:
    datei: /content/characters/${characterId}/hero-image.jpg
    beschreibung: >
      Warme Story-Szene mit dem Character als Fokus.
  portrait:
    datei: /content/characters/${characterId}/portrait.png
    beschreibung: >
      Freundliches Portrait fuer Character-Card.
  profilbild:
    datei: /content/characters/${characterId}/profilbild.png
    beschreibung: >
      Quadratisches Profilbild mit klar lesbarem Gesicht.
  weitere_bilder: []
tags:
  - learner
  - mut
  - neugierig
metadata:
  active: true
  created_at: "${today}"
  updated_at: "${today}"
  version: 1
`
}

const putS3Text = async (key, body, contentType) => {
  if (!CONTENT_BUCKET) throw new Error('CONTENT_BUCKET fehlt.')
  await s3.send(
    new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

const putS3Binary = async (key, body, contentType) => {
  if (!CONTENT_BUCKET) throw new Error('CONTENT_BUCKET fehlt.')
  await s3.send(
    new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

const fetchS3Text = async (key) => {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
    }),
  )
  return readBody(result.Body)
}

const updateManifestForCharacter = async (characterId) => {
  const key = 'content-manifest.json'
  let manifest = {
    characters: [],
    places: [],
    learningGoals: [],
    artifacts: [],
  }
  try {
    manifest = JSON.parse(await fetchS3Text(key))
  } catch {
    // Keep default object if manifest is missing.
  }
  if (!Array.isArray(manifest.characters)) manifest.characters = []
  const characterPath = `/content/characters/${characterId}/character.yaml`
  if (!manifest.characters.includes(characterPath)) {
    manifest.characters.push(characterPath)
  }
  await putS3Text(key, JSON.stringify(manifest, null, 2), 'application/json')
}

const copyReferenceToStandardFigure = async (referenceImage, characterId) => {
  if (!referenceImage || referenceImage.bucket !== CONTENT_BUCKET) return null
  const source = await s3.send(
    new GetObjectCommand({
      Bucket: referenceImage.bucket,
      Key: referenceImage.key,
    }),
  )
  const sourceBody = source.Body
  const chunks = []
  for await (const chunk of sourceBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const binary = Buffer.concat(chunks)
  const key = `content/characters/${characterId}/standard-figur.png`
  await putS3Binary(key, binary, referenceImage.mimeType || 'image/png')
  return {
    id: `${characterId}:standard-figur`,
    type: 'standard-figur',
    kind: 'standard_figur',
    status: 'generated',
    publicFilePath: `/content/characters/${characterId}/standard-figur.png`,
  }
}

const readS3Binary = async (bucket, key) => {
  const source = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )
  return readBodyBuffer(source.Body)
}

const resolveOpenAiSize = (width, height) => {
  if (width === height) return '1024x1024'
  return width > height ? '1536x1024' : '1024x1536'
}

const mapOutputFormatToMimeType = (format) => (format === 'jpeg' ? 'image/jpeg' : 'image/png')

const openAiGenerateImage = async ({
  openAiApiKey,
  prompt,
  width,
  height,
  outputFormat,
  referenceImageBuffer,
}) => {
  if (!openAiApiKey) {
    throw new Error('OPENAI_API_KEY fehlt fuer Bildgenerierung.')
  }
  const size = resolveOpenAiSize(width, height)
  if (referenceImageBuffer) {
    const form = new FormData()
    form.append('model', 'gpt-image-1')
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', 'high')
    form.append('output_format', outputFormat)
    form.append(
      'image',
      new Blob([referenceImageBuffer], { type: 'image/png' }),
      'reference.png',
    )
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey}` },
      body: form,
    })
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenAI image edit failed (${response.status}): ${errorText}`)
    }
    const payload = await response.json()
    const base64Data = payload?.data?.[0]?.b64_json
    if (!base64Data) throw new Error('OpenAI image edit returned no image data.')
    return Buffer.from(base64Data, 'base64')
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      quality: 'high',
      output_format: outputFormat,
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI image generation failed (${response.status}): ${errorText}`)
  }
  const payload = await response.json()
  const base64Data = payload?.data?.[0]?.b64_json
  if (!base64Data) throw new Error('OpenAI image generation returned no image data.')
  return Buffer.from(base64Data, 'base64')
}

const buildAssetGenerationPrompt = ({ characterName, shortDescription, type, description }) => {
  const base = `Character: ${characterName}. ${shortDescription}`.trim()
  if (type === 'standard-figur') {
    return `${base} Full-body character on solid white background, clean silhouette, child-friendly proportions, no scenery. ${description}`.trim()
  }
  if (type === 'hero-image') {
    return `${base} Cinematic warm story scene. Keep exact same identity as reference image. ${description}`.trim()
  }
  if (type === 'portrait') {
    return `${base} Portrait framing (head and upper body), clean card-friendly composition. Keep exact same identity as reference image. ${description}`.trim()
  }
  return `${base} Square profile image, highly readable face at small sizes. Keep exact same identity as reference image. ${description}`.trim()
}

const extractCharacterImageDescriptions = (yamlText, characterId) => {
  try {
    const parsed = parseYaml(yamlText)
    const name = readOptionalString(parsed?.name) || 'Neuer Character'
    const shortDescription = readOptionalString(parsed?.kurzbeschreibung) || ''
    const images = parsed?.bilder || {}
    return {
      name,
      shortDescription,
      specs: [
        {
          type: 'standard-figur',
          kind: 'standard_figur',
          width: 1024,
          height: 1536,
          outputFormat: 'png',
          key: `content/characters/${characterId}/standard-figur.png`,
          publicFilePath: `/content/characters/${characterId}/standard-figur.png`,
          description:
            readOptionalString(images?.standard_figur?.beschreibung) ||
            'Freigestellte Ganzkoerperfigur mit klarer Silhouette.',
        },
        {
          type: 'hero-image',
          kind: 'hero_image',
          width: 1920,
          height: 1088,
          outputFormat: 'jpeg',
          key: `content/characters/${characterId}/hero-image.jpg`,
          publicFilePath: `/content/characters/${characterId}/hero-image.jpg`,
          description:
            readOptionalString(images?.hero_image?.beschreibung) ||
            'Warme Story-Szene mit dem Character als Fokus.',
        },
        {
          type: 'portrait',
          kind: 'portrait',
          width: 896,
          height: 1200,
          outputFormat: 'png',
          key: `content/characters/${characterId}/portrait.png`,
          publicFilePath: `/content/characters/${characterId}/portrait.png`,
          description:
            readOptionalString(images?.portrait?.beschreibung) ||
            'Freundliches Portrait fuer Character-Card.',
        },
        {
          type: 'profilbild',
          kind: 'profilbild',
          width: 512,
          height: 512,
          outputFormat: 'png',
          key: `content/characters/${characterId}/profilbild.png`,
          publicFilePath: `/content/characters/${characterId}/profilbild.png`,
          description:
            readOptionalString(images?.profilbild?.beschreibung) ||
            'Quadratisches Profilbild mit klar lesbarem Gesicht.',
        },
      ],
    }
  } catch {
    return {
      name: 'Neuer Character',
      shortDescription: '',
      specs: [
        {
          type: 'standard-figur',
          kind: 'standard_figur',
          width: 1024,
          height: 1536,
          outputFormat: 'png',
          key: `content/characters/${characterId}/standard-figur.png`,
          publicFilePath: `/content/characters/${characterId}/standard-figur.png`,
          description: 'Freigestellte Ganzkoerperfigur mit klarer Silhouette.',
        },
        {
          type: 'hero-image',
          kind: 'hero_image',
          width: 1920,
          height: 1088,
          outputFormat: 'jpeg',
          key: `content/characters/${characterId}/hero-image.jpg`,
          publicFilePath: `/content/characters/${characterId}/hero-image.jpg`,
          description: 'Warme Story-Szene mit dem Character als Fokus.',
        },
        {
          type: 'portrait',
          kind: 'portrait',
          width: 896,
          height: 1200,
          outputFormat: 'png',
          key: `content/characters/${characterId}/portrait.png`,
          publicFilePath: `/content/characters/${characterId}/portrait.png`,
          description: 'Freundliches Portrait fuer Character-Card.',
        },
        {
          type: 'profilbild',
          kind: 'profilbild',
          width: 512,
          height: 512,
          outputFormat: 'png',
          key: `content/characters/${characterId}/profilbild.png`,
          publicFilePath: `/content/characters/${characterId}/profilbild.png`,
          description: 'Quadratisches Profilbild mit klar lesbarem Gesicht.',
        },
      ],
    }
  }
}

const buildGenerationManifest = ({ characterId, yamlText, assets }) => ({
  generatedAt: new Date().toISOString(),
  generatorVersion: 1,
  sourceCharacterPath: `/content/characters/${characterId}/character.yaml`,
  outputDirectory: `/content/characters/${characterId}`,
  models: {
    defaultModel: 'gpt-image-1',
    heroModel: 'gpt-image-1',
  },
  characterYamlLength: yamlText.length,
  assets,
})

const processJob = async (db, jobId, runtimeConfig) => {
  const lockResult = await db.query(
    `
    SELECT
      job_id,
      status,
      prompt,
      yaml_text,
      reference_images
    FROM character_creation_jobs
    WHERE job_id = $1
    FOR UPDATE
    `,
    [jobId],
  )
  if (lockResult.rowCount === 0) throw new Error(`Job nicht gefunden: ${jobId}`)
  const job = lockResult.rows[0]
  if (job.status === 'completed') return

  await db.query(
    `
    UPDATE character_creation_jobs
    SET
      status = 'running',
      phase = 'generating',
      message = 'Worker verarbeitet den Character-Job.',
      current_step = 'prepare',
      started_at = COALESCE(started_at, NOW()),
      attempt_count = attempt_count + 1,
      updated_at = NOW()
    WHERE job_id = $1
    `,
    [jobId],
  )
  await appendStep(db, {
    jobId,
    stepName: 'prepare',
    status: 'started',
    metadata: { at: new Date().toISOString() },
  })

  let yamlText = readOptionalString(job.yaml_text)
  const characterId = extractCharacterIdFromYaml(yamlText) || crypto.randomUUID()
  if (!yamlText) {
    yamlText = buildFallbackCharacterYaml({
      characterId,
      prompt: readOptionalString(job.prompt),
    })
  }

  const contentPath = `/content/characters/${characterId}/character.yaml`
  await putS3Text(contentPath.replace(/^\//, ''), yamlText, 'application/x-yaml')
  await appendStep(db, { jobId, stepName: 'save_yaml', status: 'completed', metadata: { contentPath } })

  await updateManifestForCharacter(characterId)
  await appendStep(db, {
    jobId,
    stepName: 'update_manifest',
    status: 'completed',
    metadata: { manifestKey: 'content-manifest.json' },
  })

  const imageConfig = extractCharacterImageDescriptions(yamlText, characterId)
  const referenceImages = Array.isArray(job.reference_images) ? job.reference_images : []
  const firstReference = referenceImages[0]
  let standardFigureBuffer = null
  const assets = []

  const copiedAsset = await copyReferenceToStandardFigure(firstReference, characterId).catch(() => null)
  if (copiedAsset) {
    assets.push(copiedAsset)
    standardFigureBuffer = await readS3Binary(
      CONTENT_BUCKET,
      copiedAsset.publicFilePath.replace(/^\//, ''),
    )
    await appendStep(db, {
      jobId,
      stepName: 'copy_reference_asset',
      status: 'completed',
      metadata: { asset: copiedAsset.publicFilePath },
    })
  }

  const standardSpec = imageConfig.specs[0]
  if (!standardFigureBuffer) {
    const prompt = buildAssetGenerationPrompt({
      characterName: imageConfig.name,
      shortDescription: imageConfig.shortDescription,
      type: standardSpec.type,
      description: standardSpec.description,
    })
    const buffer = await openAiGenerateImage({
      openAiApiKey: runtimeConfig.openAiApiKey,
      prompt,
      width: standardSpec.width,
      height: standardSpec.height,
      outputFormat: standardSpec.outputFormat,
      referenceImageBuffer: null,
    })
    await putS3Binary(
      standardSpec.key,
      buffer,
      mapOutputFormatToMimeType(standardSpec.outputFormat),
    )
    standardFigureBuffer = buffer
    assets.push({
      id: `${characterId}:${standardSpec.type}`,
      type: standardSpec.type,
      kind: standardSpec.kind,
      status: 'generated',
      publicFilePath: standardSpec.publicFilePath,
    })
    await appendStep(db, {
      jobId,
      stepName: 'generate_standard_figur',
      status: 'completed',
      metadata: { asset: standardSpec.publicFilePath },
    })
  }

  const additionalSpecs = imageConfig.specs.slice(1)
  let failedAssetCount = 0
  for (const spec of additionalSpecs) {
    const prompt = buildAssetGenerationPrompt({
      characterName: imageConfig.name,
      shortDescription: imageConfig.shortDescription,
      type: spec.type,
      description: spec.description,
    })
    try {
      const imageBuffer = await openAiGenerateImage({
        openAiApiKey: runtimeConfig.openAiApiKey,
        prompt,
        width: spec.width,
        height: spec.height,
        outputFormat: spec.outputFormat,
        referenceImageBuffer: standardFigureBuffer,
      })
      await putS3Binary(spec.key, imageBuffer, mapOutputFormatToMimeType(spec.outputFormat))
      const assetRecord = {
        id: `${characterId}:${spec.type}`,
        type: spec.type,
        kind: spec.kind,
        status: 'generated',
        publicFilePath: spec.publicFilePath,
      }
      assets.push(assetRecord)
      await appendStep(db, {
        jobId,
        stepName: `generate_${spec.type}`,
        status: 'completed',
        metadata: { asset: spec.publicFilePath },
      })
    } catch (error) {
      failedAssetCount += 1
      assets.push({
        id: `${characterId}:${spec.type}`,
        type: spec.type,
        kind: spec.kind,
        status: 'failed',
        publicFilePath: spec.publicFilePath,
        reason: error instanceof Error ? error.message : String(error),
      })
      await appendStep(db, {
        jobId,
        stepName: `generate_${spec.type}`,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        metadata: { asset: spec.publicFilePath },
      })
    }
  }

  const generationManifest = buildGenerationManifest({ characterId, yamlText, assets })
  const generationManifestKey = `content/characters/${characterId}/generation-manifest.json`
  await putS3Text(generationManifestKey, JSON.stringify(generationManifest, null, 2), 'application/json')

  const finalStatus = failedAssetCount > 0 ? 'failed' : 'completed'
  const finalPhase = failedAssetCount > 0 ? 'failed' : 'completed'
  const finalMessage =
    failedAssetCount > 0
      ? `${failedAssetCount} Asset(s) konnten nicht erzeugt werden.`
      : 'Character wurde auf AWS gespeichert und Bilder sind generiert.'

  await db.query(
    `
    UPDATE character_creation_jobs
    SET
      status = $2,
      phase = $3,
      message = $4,
      yaml_text = $5,
      character_id = $6,
      content_path = $7,
      manifest_path = $8,
      assets = $9::jsonb,
      current_step = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE job_id = $1
    `,
    [
      jobId,
      finalStatus,
      finalPhase,
      finalMessage,
      yamlText,
      characterId,
      contentPath,
      `/${generationManifestKey}`,
      JSON.stringify(assets),
    ],
  )
  await appendStep(db, {
    jobId,
    stepName: 'completed',
    status: failedAssetCount > 0 ? 'failed' : 'completed',
    metadata: { characterId, contentPath, failedAssetCount },
  })
  await appendOutboxEvent(db, {
    jobId,
    eventType: failedAssetCount > 0 ? 'job.failed' : 'job.completed',
    payload: { jobId, characterId, contentPath, failedAssetCount },
  })
}

export const handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : []
  if (records.length === 0) return { processed: 0 }

  const runtimeConfig = await getRuntimeConfigFromSecret()
  const db = getPool(runtimeConfig.databaseUrl)

  for (const record of records) {
    const jobId = parseJobIdFromRecord(record)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await processJob(client, jobId, runtimeConfig)
      await client.query('COMMIT')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await client.query('ROLLBACK').catch(() => undefined)
      const patchClient = await db.connect()
      try {
        await patchClient.query('BEGIN')
        await patchClient.query(
          `
          UPDATE character_creation_jobs
          SET
            status = 'failed',
            phase = 'failed',
            message = $2,
            error = $2,
            current_step = 'failed',
            completed_at = NOW(),
            updated_at = NOW()
          WHERE job_id = $1
          `,
          [jobId, message],
        )
        await appendStep(patchClient, {
          jobId,
          stepName: 'failed',
          status: 'failed',
          error: message,
          metadata: { at: new Date().toISOString() },
        })
        await appendOutboxEvent(patchClient, {
          jobId,
          eventType: 'job.failed',
          payload: { jobId, reason: message },
        })
        await patchClient.query('COMMIT')
      } catch {
        await patchClient.query('ROLLBACK').catch(() => undefined)
      } finally {
        patchClient.release()
      }
      throw error
    } finally {
      client.release()
    }
  }

  return { processed: records.length }
}
