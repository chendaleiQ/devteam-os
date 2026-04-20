import { describe, expect, it } from 'vitest';

import { advanceState, canTransition, getTestingNextState, isPauseState } from '../src/workflow.js';

describe('workflow', () => {
  it('允许测试失败回流 developing', () => {
    expect(canTransition('testing', 'developing')).toBe(true);
    expect(getTestingNextState({ passed: false, summary: 'failed', issues: ['x'] })).toBe('developing');
  });

  it('能识别 clarifying / awaiting_owner_decision / blocked pause state', () => {
    expect(advanceState('intake', { needsClarification: true })).toBe('clarifying');
    expect(isPauseState('clarifying')).toBe(true);
    expect(isPauseState('awaiting_owner_decision')).toBe(true);
    expect(isPauseState('blocked')).toBe(true);
  });
});
