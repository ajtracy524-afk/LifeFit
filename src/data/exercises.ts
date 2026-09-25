import type { Exercise, TemplateExercise, WorkoutProgram } from '../domain/types';

export const EXERCISES: Exercise[] = [
  { id: 'bench-press', name: 'Bankdrücken', muscle: 'Brust', equipment: 'barbell' },
  { id: 'incline-db-press', name: 'Schrägbankdrücken (KH)', muscle: 'Obere Brust', equipment: 'dumbbell' },
  { id: 'overhead-press', name: 'Schulterdrücken (KH)', muscle: 'Schultern', equipment: 'dumbbell' },
  { id: 'lateral-raise', name: 'Seitheben', muscle: 'Seitliche Schulter', equipment: 'dumbbell' },
  { id: 'triceps-pushdown', name: 'Trizepsdrücken am Kabel', muscle: 'Trizeps', equipment: 'cable' },
  { id: 'dips', name: 'Dips', muscle: 'Brust & Trizeps', equipment: 'bodyweight', bodyweight: true },
  { id: 'barbell-row', name: 'Langhantelrudern', muscle: 'Rücken', equipment: 'barbell' },
  { id: 'lat-pulldown', name: 'Latzug', muscle: 'Latissimus', equipment: 'cable' },
  { id: 'pull-up', name: 'Klimmzüge', muscle: 'Latissimus', equipment: 'bodyweight', bodyweight: true },
  { id: 'cable-row', name: 'Rudern am Kabel', muscle: 'Mittlerer Rücken', equipment: 'cable' },
  { id: 'face-pull', name: 'Face Pulls', muscle: 'Hintere Schulter', equipment: 'cable' },
  { id: 'biceps-curl', name: 'Bizepscurls (KH)', muscle: 'Bizeps', equipment: 'dumbbell' },
  { id: 'hammer-curl', name: 'Hammercurls', muscle: 'Bizeps & Unterarm', equipment: 'dumbbell' },
  { id: 'squat', name: 'Kniebeugen', muscle: 'Beine', equipment: 'barbell' },
  { id: 'deadlift', name: 'Kreuzheben', muscle: 'Hintere Kette', equipment: 'barbell' },
  { id: 'romanian-deadlift', name: 'Rumänisches Kreuzheben', muscle: 'Beinbeuger & Po', equipment: 'barbell' },
  { id: 'leg-press', name: 'Beinpresse', muscle: 'Quadrizeps', equipment: 'machine' },
  { id: 'leg-curl', name: 'Beinbeuger (Maschine)', muscle: 'Beinbeuger', equipment: 'machine' },
  { id: 'leg-extension', name: 'Beinstrecker', muscle: 'Quadrizeps', equipment: 'machine' },
  { id: 'split-squat', name: 'Bulgarische Split Squats', muscle: 'Beine & Po', equipment: 'dumbbell' },
  { id: 'lunges', name: 'Ausfallschritte (KH)', muscle: 'Beine & Po', equipment: 'dumbbell' },
  { id: 'hip-thrust', name: 'Hip Thrust', muscle: 'Po', equipment: 'barbell' },
  { id: 'calf-raise', name: 'Wadenheben', muscle: 'Waden', equipment: 'machine' },
  { id: 'hanging-leg-raise', name: 'Hängendes Beinheben', muscle: 'Bauch', equipment: 'bodyweight', bodyweight: true },
];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

/** Compact helper: exercise id, sets, rep range, rest in seconds. */
const ex = (exerciseId: string, sets: number, repMin: number, repMax: number, restSec = 120): TemplateExercise => ({
  exerciseId,
  sets,
  repMin,
  repMax,
  restSec,
});

export const PROGRAMS: WorkoutProgram[] = [
  {
    id: 'full-body',
    name: 'Ganzkörper',
    description: 'Zwei abwechselnde Ganzkörper-Einheiten. Ideal für 2–3 Trainingstage.',
    templates: [
      {
        id: 'fb-a',
        name: 'Ganzkörper A',
        focus: 'Kniebeuge · Drücken · Rudern',
        exercises: [
          ex('squat', 3, 6, 10, 150),
          ex('bench-press', 3, 6, 10, 150),
          ex('barbell-row', 3, 8, 12),
          ex('overhead-press', 2, 8, 12, 90),
          ex('leg-curl', 2, 10, 15, 90),
          ex('hanging-leg-raise', 2, 8, 15, 60),
        ],
      },
      {
        id: 'fb-b',
        name: 'Ganzkörper B',
        focus: 'Hüfte · Schrägbank · Latzug',
        exercises: [
          ex('romanian-deadlift', 3, 6, 10, 150),
          ex('incline-db-press', 3, 8, 12),
          ex('lat-pulldown', 3, 8, 12),
          ex('lunges', 2, 8, 12, 90),
          ex('lateral-raise', 2, 12, 20, 60),
          ex('biceps-curl', 2, 10, 15, 60),
        ],
      },
    ],
  },
  {
    id: 'upper-lower',
    name: 'Oberkörper / Unterkörper',
    description: 'Vier Einheiten pro Woche mit hoher Frequenz pro Muskel. Der Klassiker für Muskelaufbau.',
    templates: [
      {
        id: 'ul-upper-a',
        name: 'Oberkörper A',
        focus: 'Brust · Rücken · Schultern',
        exercises: [
          ex('bench-press', 3, 6, 10, 150),
          ex('barbell-row', 3, 8, 12),
          ex('overhead-press', 3, 8, 12),
          ex('lat-pulldown', 3, 10, 12, 90),
          ex('lateral-raise', 3, 12, 20, 60),
          ex('triceps-pushdown', 2, 10, 15, 60),
        ],
      },
      {
        id: 'ul-lower-a',
        name: 'Unterkörper A',
        focus: 'Kniebeuge · Beinbeuger',
        exercises: [
          ex('squat', 3, 6, 10, 180),
          ex('romanian-deadlift', 3, 8, 12, 150),
          ex('leg-press', 3, 10, 15),
          ex('leg-curl', 3, 10, 15, 90),
          ex('calf-raise', 3, 10, 15, 60),
        ],
      },
      {
        id: 'ul-upper-b',
        name: 'Oberkörper B',
        focus: 'Schrägbank · Klimmzüge · Arme',
        exercises: [
          ex('incline-db-press', 3, 8, 12),
          ex('pull-up', 3, 5, 10, 150),
          ex('dips', 3, 6, 12),
          ex('cable-row', 3, 10, 12, 90),
          ex('face-pull', 2, 12, 20, 60),
          ex('biceps-curl', 3, 10, 15, 60),
        ],
      },
      {
        id: 'ul-lower-b',
        name: 'Unterkörper B',
        focus: 'Kreuzheben · Po · Bauch',
        exercises: [
          ex('deadlift', 3, 5, 8, 180),
          ex('split-squat', 3, 8, 12),
          ex('hip-thrust', 3, 8, 12),
          ex('leg-extension', 2, 12, 15, 90),
          ex('hanging-leg-raise', 3, 8, 15, 60),
        ],
      },
    ],
  },
  {
    id: 'push-pull-legs',
    name: 'Push / Pull / Beine',
    description: 'Drei fokussierte Einheiten, die sich abwechseln. Für 3, 5 oder 6 Trainingstage.',
    templates: [
      {
        id: 'ppl-push',
        name: 'Push',
        focus: 'Brust · Schultern · Trizeps',
        exercises: [
          ex('bench-press', 3, 6, 10, 150),
          ex('overhead-press', 3, 8, 12),
          ex('incline-db-press', 3, 8, 12),
          ex('lateral-raise', 3, 12, 20, 60),
          ex('triceps-pushdown', 3, 10, 15, 60),
        ],
      },
      {
        id: 'ppl-pull',
        name: 'Pull',
        focus: 'Rücken · Bizeps',
        exercises: [
          ex('pull-up', 3, 5, 10, 150),
          ex('barbell-row', 3, 8, 12),
          ex('cable-row', 3, 10, 12, 90),
          ex('face-pull', 3, 12, 20, 60),
          ex('biceps-curl', 3, 10, 15, 60),
          ex('hammer-curl', 2, 10, 15, 60),
        ],
      },
      {
        id: 'ppl-legs',
        name: 'Beine',
        focus: 'Kniebeuge · Hüfte · Waden',
        exercises: [
          ex('squat', 3, 6, 10, 180),
          ex('romanian-deadlift', 3, 8, 12, 150),
          ex('leg-press', 3, 10, 15),
          ex('leg-curl', 3, 10, 15, 90),
          ex('calf-raise', 3, 10, 15, 60),
        ],
      },
    ],
  },
];

export function getProgram(id: string): WorkoutProgram | undefined {
  return PROGRAMS.find((p) => p.id === id);
}

export function findTemplate(templateId: string) {
  for (const program of PROGRAMS) {
    const template = program.templates.find((t) => t.id === templateId);
    if (template) return template;
  }
  return undefined;
}
