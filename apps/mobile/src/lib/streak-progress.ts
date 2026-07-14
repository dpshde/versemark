const STREAK_DAYS = [1, 3, 7, 14, 30, 100] as const;
const STREAK_POSITIONS = [0, 0.16, 0.34, 0.54, 0.76, 1] as const;

/** Keep day one at the start, then move continuously through achievement milestones. */
export function streakMarkerProgress(streak: number): number {
  const days = Math.max(0, Math.floor(streak));
  if (days <= STREAK_DAYS[0]) return STREAK_POSITIONS[0];

  for (let index = 1; index < STREAK_DAYS.length; index += 1) {
    const milestone = STREAK_DAYS[index]!;
    if (days > milestone) continue;
    const previousDay = STREAK_DAYS[index - 1]!;
    const previousPosition = STREAK_POSITIONS[index - 1]!;
    const position = STREAK_POSITIONS[index]!;
    const progress = (days - previousDay) / (milestone - previousDay);
    return previousPosition + (position - previousPosition) * progress;
  }

  return 1;
}

/** Each existing streak achievement adds one level of flame intensity. */
export function streakFlameLevel(streak: number): number {
  const days = Math.max(0, Math.floor(streak));
  if (days >= 100) return 5;
  if (days >= 30) return 4;
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 3) return 1;
  return 0;
}
