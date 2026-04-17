import { createArtifact } from './artifacts.js';
import type { Artifact, MeetingResult, Role } from './domain.js';

export type MeetingRoleSummaries = Partial<Record<Exclude<Role, 'leader'>, string>>;

const DEFAULT_DECISIONS = ['先按本地原型边界推进', '不引入 Web、多用户、云部署与复杂并行'];

export function createMeetingResult(
  input: string,
  roleSummaries: MeetingRoleSummaries,
  needsOwnerDecision: boolean
): MeetingResult {
  return {
    topic: input,
    roleSummaries,
    decisions: [...DEFAULT_DECISIONS],
    risks: needsOwnerDecision ? ['存在需要老板拍板的范围或优先级'] : [],
    nextStep: needsOwnerDecision ? 'awaiting_owner_decision' : 'developing',
    needsOwnerDecision
  };
}

export function createMeetingArtifact(
  input: string,
  roleSummaries: MeetingRoleSummaries,
  needsOwnerDecision: boolean
): Artifact {
  return createArtifact(
    'meeting_notes',
    '会议结论',
    'leader',
    JSON.stringify(createMeetingResult(input, roleSummaries, needsOwnerDecision), null, 2)
  );
}
