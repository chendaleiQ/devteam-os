import { describe, expect, it } from 'vitest';

import { runLeaderTask } from '../src/leader.js';
import { createMeetingArtifact, createMeetingResult } from '../src/meeting.js';

describe('meeting module', () => {
  it('creates a meeting result with the required structure', () => {
    const result = createMeetingResult(
      '请设计一个需要同步评审的本地原型增强',
      { pm: 'PM 已明确本地原型边界与优先级' },
      false
    );

    expect(result).toEqual({
      topic: '请设计一个需要同步评审的本地原型增强',
      roleSummaries: { pm: 'PM 已明确本地原型边界与优先级' },
      decisions: ['先按本地原型边界推进', '不引入 Web、多用户、云部署与复杂并行'],
      risks: [],
      nextStep: 'developing',
      needsOwnerDecision: false
    });
  });

  it('creates compatible meeting_notes artifact content', () => {
    const artifact = createMeetingArtifact(
      '请设计一个需要老板拍板范围的本地原型增强',
      { pm: 'PM 已识别需要老板确认范围' },
      true
    );

    expect(artifact.kind).toBe('meeting_notes');
    expect(artifact.title).toContain('会议结论');

    const content = JSON.parse(artifact.content) as Record<string, unknown>;

    expect(content).toMatchObject({
      topic: '请设计一个需要老板拍板范围的本地原型增强',
      roleSummaries: { pm: 'PM 已识别需要老板确认范围' },
      decisions: ['先按本地原型边界推进', '不引入 Web、多用户、云部署与复杂并行'],
      risks: ['存在需要老板拍板的范围或优先级'],
      nextStep: 'awaiting_owner_decision',
      needsOwnerDecision: true
    });
  });

  it('leader meeting notes include existing PM summary', async () => {
    const result = await runLeaderTask('请设计一个需要同步评审的本地原型增强', { forceMeeting: true });
    const pmSummary = result.task.agentRuns.find((run) => run.role === 'pm')?.summary;
    const meetingArtifact = result.task.artifacts.find((artifact) => artifact.kind === 'meeting_notes');

    expect(pmSummary).toBeTruthy();
    expect(meetingArtifact).toBeDefined();

    const content = JSON.parse(meetingArtifact?.content ?? '{}') as Record<string, unknown>;

    expect(content).toMatchObject({
      roleSummaries: { pm: pmSummary },
      needsOwnerDecision: false
    });
    expect(result.task.latestMeetingResult?.roleSummaries.pm).toBe(pmSummary);
  });
});
