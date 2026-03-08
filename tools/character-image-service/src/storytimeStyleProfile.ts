export const STORYTIME_STYLE_PROFILE = {
  id: 'storytime-adventure-3d-v1',
  summary:
    'Familienfreundliche hochwertige Adventure-Animation mit warmem Herz, lesbaren Silhouetten und cinematic fantasy lighting.',
  groundingReferenceDescription:
    'Dichtes tropisches Fantasiewald-Setting mit sattem Blattwerk, kuehlem Nebel in der Tiefe, warmen Lichtakzenten, sanfter volumetrischer Beleuchtung, charmanten Figuren mit grossen emotionalen Augen, runden weichen Formen und detailreichen aber kindgerechten Oberflaechen.',
  styleRules: [
    'Nutze eine eigene hochwertige 3D-Animationssprache und vermeide direkte IP- oder Franchise-Nennungen.',
    'Behalte klare, freundliche Silhouetten und eine starke emotionale Lesbarkeit im Gesicht.',
    'Priorisiere warme Highlight-Farben, sanfte Tiefenwerte und glaubwuerdige Atmosphaere statt fotorealistischer Haerte.',
    'Charakteridentitaet steht immer ueber generischer Szenenepik oder Effekten.',
  ],
  promptFragments: {
    coreStyle:
      'high-end family adventure animation, cinematic composition, large expressive eyes, soft rounded forms, tactile stylized surfaces, child-friendly proportions, lush atmospheric lighting, readable silhouette, emotionally warm storytelling',
    lighting:
      'soft volumetric light, warm key light, cool ambient haze, believable depth layering, gentle contrast, polished cinematic shading',
    environment:
      'storybook fantasy naturalism, rich foliage or textured fantasy environments, subtle magical atmosphere, never horror-coded',
    guardrails:
      'Avoid photorealism, horror, uncanny faces, harsh realism, gritty violence, adult sensuality, anime linework, comic-book ink rendering, oversharpened textures, floating limbs, extra fingers, broken anatomy.',
  },
} as const

export const describeStorytimeStyleProfile = (): string =>
  [
    STORYTIME_STYLE_PROFILE.summary,
    `Grounding reference: ${STORYTIME_STYLE_PROFILE.groundingReferenceDescription}`,
    `Core style: ${STORYTIME_STYLE_PROFILE.promptFragments.coreStyle}.`,
    `Lighting: ${STORYTIME_STYLE_PROFILE.promptFragments.lighting}.`,
    `Environment: ${STORYTIME_STYLE_PROFILE.promptFragments.environment}.`,
    `Guardrails: ${STORYTIME_STYLE_PROFILE.promptFragments.guardrails}`,
  ].join(' ')
