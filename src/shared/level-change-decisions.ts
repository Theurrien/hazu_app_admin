// Level change — operator decisions. Pure, shared by the preview (renderer) and the run (main).
// Spec: docs/specs/2026-11-26-level-change-decisions-design.md

import type { LevelChangePlan } from './level-change-types';

export interface LevelChangeDecisions {
  acceptedTagAdds: Array<{ sectionKey: string; tag: string }>;
  /** section keys whose hand-edited description is replaced by the template's */
  forcedDescriptions: string[];
  /** template section keys */
  copySections: string[];
  deleteSections: Array<{ sectionKey: string; sectionId: string }>;
  addWidget: boolean;
}

export const WIDGET_FILE = 'student_app.html';

/** A description holds the widget when it names the widget file (an older variant is left alone). */
export function isWidgetPresent(description: string): boolean {
  return (description ?? '').includes(WIDGET_FILE);
}

/** What the preview ticks by default: nothing destructive, nothing that overwrites the student's text. */
export function defaultDecisions(plan: LevelChangePlan): LevelChangeDecisions {
  return {
    acceptedTagAdds: plan.sections.flatMap(s => s.uncertainTags.map(tag => ({ sectionKey: s.sectionKey, tag }))),
    forcedDescriptions: [],
    copySections: plan.templateOnlyItems.map(i => i.sectionKey),
    deleteSections: [],
    addWidget: plan.widget.needed,
  };
}
