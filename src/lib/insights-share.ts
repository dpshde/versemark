/** Share links for the Bible map + knowledge milestones (rendered by the Worker's OG card). */
import { shareOrigin } from "./share";
import { SECTIONS, encodeMap, type Insights, type Milestone } from "./insights";

export function sectionCode(ins: Insights): string {
  return ins.sections.map((s) => (s.accuracy == null ? "-" : String(Math.round(s.accuracy * 100)))).join(".");
}

export function mapShareUrl(ins: Insights, origin = shareOrigin()): string {
  return `${origin}/i?m=${encodeMap(ins)}&s=${sectionCode(ins)}&n=${ins.rounds}`;
}

export function mapShareText(ins: Insights): string {
  const parts = ins.sections
    .filter((s) => s.accuracy != null)
    .map((s) => `${s.label} ${Math.round(s.accuracy! * 100)}%`);
  return `My Versemark Bible map (${ins.rounds} verses)\n${parts.join(" · ")}\n\nWhere are your gaps?\n${mapShareUrl(ins)}`;
}

export function milestoneShareUrl(ins: Insights, m: Milestone, origin = shareOrigin()): string {
  return `${origin}/i?a=${encodeURIComponent(m.id)}&p=${m.done}-${m.total}&m=${encodeMap(ins)}&s=${sectionCode(ins)}&n=${ins.rounds}`;
}

export function milestoneShareText(ins: Insights, m: Milestone): string {
  return `${m.unlocked ? "Unlocked" : "Working on"} “${m.title}” on Versemark — ${m.detail.toLowerCase()} (${m.done}/${m.total}).\n\n${milestoneShareUrl(ins, m)}`;
}
export const SECTION_LABELS = SECTIONS.map((s) => s.label);
