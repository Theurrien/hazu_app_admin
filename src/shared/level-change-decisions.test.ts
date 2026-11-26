import { describe, it, expect } from 'vitest';
import { defaultDecisions, isWidgetPresent } from './level-change-decisions';
import type { LevelChangePlan, SectionChange } from './level-change-types';

const section = (over: Partial<SectionChange>): SectionChange => ({
  sectionId: 's', sectionKey: 'k', title: 'T', description: null, descriptionKept: false,
  addTags: [], removeTags: [], uncertainTags: [], keptTargetDescription: null, ...over,
});

function plan(over: Partial<LevelChangePlan> = {}): LevelChangePlan {
  return {
    profileId: 'P', fromLevel: 'cfc', toLevel: 'afp', colorFrom: '#1A237E', colorTo: '#9AD9EA', colorChange: true,
    templates: [], sections: [], noSourceCounterpart: [],
    templateOnlyItems: [], profileOnlyItems: [], widget: { needed: false, profileEmpty: false },
    ...over,
  };
}

describe('defaultDecisions', () => {
  it('accepts uncertain tags, copies template-only sections, deletes nothing, forces nothing', () => {
    const p = plan({
      sections: [
        section({ sectionKey: 'a|i|c', addTags: ['t1', 't2', 'swap'], uncertainTags: ['t1', 't2'] }),
        section({ sectionKey: 'b|i|c', descriptionKept: true, keptTargetDescription: '<p>x</p>' }),
      ],
      templateOnlyItems: [
        { sectionKey: 'n1', title: 'N1', templateSectionId: 'x1' },
        { sectionKey: 'n2', title: 'N2', templateSectionId: 'x2' },
      ],
      profileOnlyItems: [{ sectionKey: 'o', title: 'O', sectionId: 'y', descendants: null, descendantsExact: false }],
      widget: { needed: true, profileEmpty: true },
    });
    expect(defaultDecisions(p)).toEqual({
      acceptedTagAdds: [{ sectionKey: 'a|i|c', tag: 't1' }, { sectionKey: 'a|i|c', tag: 't2' }],
      forcedDescriptions: [],
      copySections: ['n1', 'n2'],
      deleteSections: [],
      addWidget: true,
    });
  });
  it('no widget when not needed', () => {
    expect(defaultDecisions(plan()).addWidget).toBe(false);
  });
});

describe('isWidgetPresent', () => {
  it('detects the widget file', () => {
    expect(isWidgetPresent('<p>x</p><iframe src="https://h.example/student_app.html"></iframe>')).toBe(true);
    expect(isWidgetPresent('<p>x</p>')).toBe(false);
    expect(isWidgetPresent('')).toBe(false);
  });
});
