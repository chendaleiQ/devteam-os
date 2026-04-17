import type { TaskState, ValidationResult } from './domain.js';

const transitionGraph: Record<TaskState, TaskState[]> = {
  intake: ['clarifying', 'planning'],
  clarifying: ['planning', 'blocked'],
  planning: ['meeting', 'developing', 'awaiting_owner_decision', 'blocked'],
  meeting: ['developing', 'awaiting_owner_decision', 'blocked'],
  developing: ['testing'],
  testing: ['developing', 'reporting'],
  reporting: ['awaiting_owner_decision', 'done'],
  awaiting_owner_decision: ['planning', 'developing', 'done', 'blocked'],
  blocked: ['clarifying', 'planning'],
  done: []
};

const pauseStates = new Set<TaskState>(['clarifying', 'awaiting_owner_decision', 'blocked']);

export function getAllowedTransitions(state: TaskState): TaskState[] {
  return transitionGraph[state];
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return transitionGraph[from].includes(to);
}

export function assertValidTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法状态流转: ${from} -> ${to}`);
  }
}

export function isPauseState(state: TaskState): boolean {
  return pauseStates.has(state);
}

export function getTestingNextState(result: ValidationResult): TaskState {
  return result.passed ? 'reporting' : 'developing';
}

export function advanceState(
  current: TaskState,
  options?: {
    validationResult?: ValidationResult;
    needsClarification?: boolean;
    needsMeeting?: boolean;
    needsOwnerDecision?: boolean;
    isBlocked?: boolean;
  }
): TaskState {
  switch (current) {
    case 'intake':
      return options?.needsClarification ? 'clarifying' : 'planning';
    case 'clarifying':
      return 'planning';
    case 'planning':
      if (options?.isBlocked) {
        return 'blocked';
      }
      if (options?.needsMeeting) {
        return 'meeting';
      }
      if (options?.needsOwnerDecision) {
        return 'awaiting_owner_decision';
      }
      return 'developing';
    case 'meeting':
      if (options?.isBlocked) {
        return 'blocked';
      }
      if (options?.needsOwnerDecision) {
        return 'awaiting_owner_decision';
      }
      return 'developing';
    case 'developing':
      return 'testing';
    case 'testing':
      if (!options?.validationResult) {
        throw new Error('testing 阶段推进需要 validationResult');
      }
      return getTestingNextState(options.validationResult);
    case 'reporting':
      if (options?.needsOwnerDecision) {
        return 'awaiting_owner_decision';
      }
      return 'done';
    case 'awaiting_owner_decision':
      return 'planning';
    case 'blocked':
      return 'clarifying';
    case 'done':
      return 'done';
    default: {
      const exhaustiveCheck: never = current;
      return exhaustiveCheck;
    }
  }
}
