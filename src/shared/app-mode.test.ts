import { describe, it, expect } from 'vitest';
import {
  APP_MODE_SETTING_KEY,
  DEFAULT_APP_MODE,
  parseAppMode,
  visiblePages,
  isPageVisible,
  fallbackPage,
  visibleWorkflows,
  isWorkflowVisible,
  allowedPersonTypes,
  allowedRoomTypes,
  isRestricted,
} from './app-mode';

describe('parseAppMode', () => {
  it('reads the one string that means complete', () => {
    expect(parseAppMode('complete')).toBe('complete');
  });

  it('defaults to cie for anything else', () => {
    expect(parseAppMode('cie')).toBe('cie');
    expect(parseAppMode(null)).toBe('cie');
    expect(parseAppMode(undefined)).toBe('cie');
    expect(parseAppMode('')).toBe('cie');
    expect(parseAppMode('Complete')).toBe('cie');
    expect(parseAppMode('admin')).toBe('cie');
  });

  it('agrees with DEFAULT_APP_MODE', () => {
    expect(parseAppMode(null)).toBe(DEFAULT_APP_MODE);
    expect(DEFAULT_APP_MODE).toBe('cie');
  });

  it('names the settings key', () => {
    expect(APP_MODE_SETTING_KEY).toBe('app_mode');
  });
});

describe('visiblePages', () => {
  it('shows exactly three pages in cie mode', () => {
    expect(visiblePages('cie')).toEqual(['dashboard', 'matrix', 'import']);
  });

  it('keeps the Dashboard, which is the only sync trigger', () => {
    expect(visiblePages('cie')).toContain('dashboard');
  });

  it('hides every admin page in cie mode', () => {
    const pages = visiblePages('cie');
    for (const hidden of ['rooms', 'persons', 'missions', 'discrepancies', 'settings'] as const) {
      expect(pages).not.toContain(hidden);
    }
  });

  it('shows all eight pages in complete mode', () => {
    expect(visiblePages('complete')).toHaveLength(8);
  });

  it('makes complete a superset of cie', () => {
    const complete = visiblePages('complete');
    for (const page of visiblePages('cie')) {
      expect(complete).toContain(page);
    }
  });

  it('preserves the admin nav order', () => {
    expect(visiblePages('complete')).toEqual([
      'dashboard', 'rooms', 'persons', 'matrix',
      'import', 'missions', 'discrepancies', 'settings',
    ]);
  });
});

describe('isPageVisible', () => {
  it('allows a visible page', () => {
    expect(isPageVisible('cie', 'matrix')).toBe(true);
  });

  it('refuses a hidden page', () => {
    expect(isPageVisible('cie', 'discrepancies')).toBe(false);
  });

  it('allows everything in complete mode', () => {
    expect(isPageVisible('complete', 'discrepancies')).toBe(true);
  });
});

describe('fallbackPage', () => {
  it('lands on a page visible in its own mode', () => {
    expect(isPageVisible('cie', fallbackPage('cie'))).toBe(true);
    expect(isPageVisible('complete', fallbackPage('complete'))).toBe(true);
  });

  it('is the Dashboard in both modes', () => {
    expect(fallbackPage('cie')).toBe('dashboard');
    expect(fallbackPage('complete')).toBe('dashboard');
  });
});

describe('visibleWorkflows', () => {
  it('shows only room creation and assignment in cie mode', () => {
    expect(visibleWorkflows('cie')).toEqual(['room', 'assignment']);
  });

  it('hides person creation and verify in cie mode', () => {
    expect(visibleWorkflows('cie')).not.toContain('person');
    expect(visibleWorkflows('cie')).not.toContain('verify');
  });

  it('shows all four in complete mode', () => {
    expect(visibleWorkflows('complete')).toEqual(['room', 'person', 'assignment', 'verify']);
  });

  it('answers isWorkflowVisible consistently', () => {
    expect(isWorkflowVisible('cie', 'assignment')).toBe(true);
    expect(isWorkflowVisible('cie', 'verify')).toBe(false);
    expect(isWorkflowVisible('complete', 'verify')).toBe(true);
  });
});

describe('allowedPersonTypes', () => {
  it('is students and course teachers in cie mode', () => {
    expect(allowedPersonTypes('cie')).toEqual(['student', 'courseteacher']);
  });

  it('excludes the roles a CIE course never uses', () => {
    const types = allowedPersonTypes('cie');
    for (const excluded of ['schoolteacher', 'companymentor', 'stateadvisor', 'guardian'] as const) {
      expect(types).not.toContain(excluded);
    }
  });

  it('is all six in complete mode', () => {
    expect(allowedPersonTypes('complete')).toHaveLength(6);
  });

  it('makes complete a superset of cie', () => {
    const complete = allowedPersonTypes('complete');
    for (const type of allowedPersonTypes('cie')) {
      expect(complete).toContain(type);
    }
  });
});

describe('allowedRoomTypes', () => {
  it('is cie alone in cie mode', () => {
    expect(allowedRoomTypes('cie')).toEqual(['cie']);
  });

  it('is all four in complete mode', () => {
    expect(allowedRoomTypes('complete')).toHaveLength(4);
  });

  it('makes complete a superset of cie', () => {
    expect(allowedRoomTypes('complete')).toContain('cie');
  });
});

describe('isRestricted', () => {
  it('is true only in cie mode', () => {
    expect(isRestricted('cie')).toBe(true);
    expect(isRestricted('complete')).toBe(false);
  });
});

describe('returned arrays are safe to hand to callers', () => {
  it('does not let a caller mutate the module state', () => {
    visiblePages('cie').push('settings');
    expect(visiblePages('cie')).toEqual(['dashboard', 'matrix', 'import']);

    allowedRoomTypes('cie').push('class');
    expect(allowedRoomTypes('cie')).toEqual(['cie']);
  });
});
