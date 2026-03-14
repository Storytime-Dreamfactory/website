import { useMemo, useState } from 'react'
import { Card, Drawer, Input, Select, Space, Tag, Typography } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { LearningGoal, StoryContent } from './content/types'
import GameObjectCard from './design-system/gameObjects/GameObjectCard'

const { Title, Text } = Typography

const SUBJECT_LABELS: Record<string, string> = {
  naturwissenschaften: 'Naturwissenschaften',
  mathematik: 'Mathematik',
  englisch: 'Englisch',
  sozialkompetenz: 'Sozialkompetenz',
  informatik: 'Informatik',
  kunst: 'Kunst und Design',
  sport: 'Sport',
  musik: 'Musik',
  geographie: 'Geographie',
  geschichte: 'Geschichte',
  sachkunde: 'Sachkunde',
  'design-und-technologie': 'Design und Technologie',
  kochen: 'Kochen und Ernaehrung',
}


function subjectLabel(subject: string): string {
  return SUBJECT_LABELS[subject] ?? subject.charAt(0).toUpperCase() + subject.slice(1)
}

function extractFilterOptions(goals: LearningGoal[]) {
  const subjects = new Set<string>()
  const keyStages = new Set<number>()
  const yearGroups = new Set<number>()

  for (const goal of goals) {
    subjects.add(goal.subject)
    if (goal.curriculumSource) {
      keyStages.add(goal.curriculumSource.keyStage)
      yearGroups.add(goal.curriculumSource.yearGroup)
    }
  }

  return {
    subjects: [...subjects].sort(),
    keyStages: [...keyStages].sort((a, b) => a - b),
    yearGroups: [...yearGroups].sort((a, b) => a - b),
  }
}

function filterGoals(
  goals: LearningGoal[],
  filters: { subject?: string; keyStage?: number; yearGroup?: number; search: string },
): LearningGoal[] {
  const searchLower = filters.search.toLowerCase().trim()

  return goals.filter((goal) => {
    if (filters.subject && goal.subject !== filters.subject) return false
    if (filters.keyStage && goal.curriculumSource?.keyStage !== filters.keyStage) return false
    if (filters.yearGroup && goal.curriculumSource?.yearGroup !== filters.yearGroup) return false
    if (searchLower) {
      const haystack = [
        goal.name,
        goal.topic,
        goal.subtopic,
        goal.description,
        ...goal.domainTags,
        ...(goal.learningObjectives?.map((o) => o.canDo) ?? []),
      ]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(searchLower)) return false
    }
    return true
  })
}


type LearningGoalCardProps = {
  goal: LearningGoal
}

function LearningGoalCard({ goal }: LearningGoalCardProps) {
  return (
    <Card className="content-card" bordered={false}>
      <GameObjectCard
        kind="learning-goal"
        name={goal.name}
        imageSrc="/generated/skills-finja-nola-learning-background.png"
        kicker={goal.curriculumSource
          ? `Year ${goal.curriculumSource.yearGroup} · KS${goal.curriculumSource.keyStage}`
          : undefined}
        properties={[
          { key: 'subject', label: 'Fach', value: subjectLabel(goal.subject) },
          { key: 'age', label: 'Alter', value: goal.ageRange.join(', ') || '-' },
        ]}
        showImage
        showKicker
        showProperties
        showRelationships={false}
      />
    </Card>
  )
}

type LearningGoalDetailProps = {
  goal: LearningGoal
}

function LearningGoalObjectives({ goal }: LearningGoalDetailProps) {
  if (!goal.learningObjectives || goal.learningObjectives.length === 0) return null

  return (
    <div className="learning-goal-objectives">
      {goal.learningObjectives.map((objective) => (
        <div key={objective.id} className="learning-goal-objective">
          <Text strong className="learning-goal-objective-cando">
            {objective.canDo}
          </Text>
          {objective.originalEn && (
            <Text type="secondary" className="learning-goal-objective-original">
              EN: {objective.originalEn}
            </Text>
          )}
        </div>
      ))}
    </div>
  )
}

export default function LearningGoalsPage({ content }: { content: StoryContent }) {
  const [selectedSubject, setSelectedSubject] = useState<string | undefined>()
  const [selectedKeyStage, setSelectedKeyStage] = useState<number | undefined>()
  const [selectedYearGroup, setSelectedYearGroup] = useState<number | undefined>()
  const [searchText, setSearchText] = useState('')
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)

  const allGoals = content.learningGoals
  const filterOptions = useMemo(() => extractFilterOptions(allGoals), [allGoals])

  const filtered = useMemo(
    () =>
      filterGoals(allGoals, {
        subject: selectedSubject,
        keyStage: selectedKeyStage,
        yearGroup: selectedYearGroup,
        search: searchText,
      }),
    [allGoals, selectedSubject, selectedKeyStage, selectedYearGroup, searchText],
  )

  const selectedGoal = useMemo(
    () => (selectedGoalId ? allGoals.find((g) => g.id === selectedGoalId) ?? null : null),
    [allGoals, selectedGoalId],
  )

  const hasFilters = selectedSubject || selectedKeyStage || selectedYearGroup || searchText

  return (
    <section className="content-section learning-goals-page">
      <Title level={2} className="section-title">
        Lernziele
      </Title>
      <Text className="learning-goals-subtitle">
        {allGoals.length} Lernziele aus dem National Curriculum England, uebersetzt auf Deutsch.
      </Text>

      <div className="learning-goals-filters">
        <Space wrap size="middle">
          {filterOptions.keyStages.length > 0 && (
            <Select
              placeholder="Key Stage"
              allowClear
              value={selectedKeyStage}
              onChange={setSelectedKeyStage}
              style={{ minWidth: 140 }}
              options={filterOptions.keyStages.map((ks) => ({
                value: ks,
                label: `Key Stage ${ks}`,
              }))}
            />
          )}
          {filterOptions.yearGroups.length > 0 && (
            <Select
              placeholder="Jahrgang"
              allowClear
              value={selectedYearGroup}
              onChange={setSelectedYearGroup}
              style={{ minWidth: 140 }}
              options={filterOptions.yearGroups.map((yg) => ({
                value: yg,
                label: `Year ${yg}`,
              }))}
            />
          )}
          <Select
            placeholder="Fach"
            allowClear
            value={selectedSubject}
            onChange={setSelectedSubject}
            style={{ minWidth: 200 }}
            options={filterOptions.subjects.map((s) => ({
              value: s,
              label: subjectLabel(s),
            }))}
          />
          <Input
            placeholder="Suche..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ minWidth: 220 }}
          />
        </Space>
      </div>

      {filtered.length === 0 ? (
        <div className="learning-goals-empty">
          <Text type="secondary">
            {hasFilters
              ? 'Keine Lernziele fuer diese Filterauswahl gefunden.'
              : 'Noch keine Lernziele vorhanden.'}
          </Text>
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((goal) => (
            <div
              key={goal.id}
              className="learning-goal-card-wrapper"
              onClick={() => setSelectedGoalId(goal.id)}
            >
              <LearningGoalCard goal={goal} />
            </div>
          ))}
        </div>
      )}

      <Drawer
        title={selectedGoal?.name ?? 'Lernziel'}
        placement="right"
        open={selectedGoalId !== null}
        onClose={() => setSelectedGoalId(null)}
        rootClassName="conversation-drawer"
        width={440}
        styles={{
          content: { background: '#000', boxShadow: 'none' },
          header: { background: '#000' },
          body: { background: '#000' },
          mask: { background: 'rgba(0, 0, 0, 0.35)' },
          wrapper: { background: 'transparent' },
        }}
      >
        {selectedGoal && (
          <div className="learning-goal-drawer-content">
            {selectedGoal.curriculumSource && (
              <Text className="learning-goal-drawer-meta">
                Year {selectedGoal.curriculumSource.yearGroup} · Key Stage{' '}
                {selectedGoal.curriculumSource.keyStage}
              </Text>
            )}

            <div className="learning-goal-drawer-properties">
              <Tag>{subjectLabel(selectedGoal.subject)}</Tag>
              {selectedGoal.ageRange.length > 0 && (
                <Tag>Alter {selectedGoal.ageRange.join(', ')}</Tag>
              )}
            </div>

            {selectedGoal.description && (
              <Text className="learning-goal-drawer-description">{selectedGoal.description}</Text>
            )}

            <LearningGoalObjectives goal={selectedGoal} />

            {selectedGoal.domainTags.length > 0 && (
              <div className="learning-goal-detail-tags">
                {selectedGoal.domainTags.map((tag) => (
                  <Tag key={tag} color="blue">
                    {tag}
                  </Tag>
                ))}
              </div>
            )}

            {selectedGoal.exampleQuestions && selectedGoal.exampleQuestions.length > 0 && (
              <div className="learning-goal-drawer-section">
                <Text strong className="learning-goal-drawer-section-title">
                  Beispielfragen
                </Text>
                <ul className="learning-goal-drawer-list">
                  {selectedGoal.exampleQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedGoal.practiceIdeas && selectedGoal.practiceIdeas.length > 0 && (
              <div className="learning-goal-drawer-section">
                <Text strong className="learning-goal-drawer-section-title">
                  Uebungsideen
                </Text>
                <ul className="learning-goal-drawer-list">
                  {selectedGoal.practiceIdeas.map((idea, i) => (
                    <li key={i}>{idea}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </section>
  )
}
