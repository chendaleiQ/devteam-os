import { describe, expect, it } from 'vitest';

import { runLeaderTask } from '../src/leader.js';
import { createMeetingArtifact, createMeetingResult } from '../src/meeting.js';

describe('meeting module', () => {
  it('creates a meeting result with the required structure', () => {
    const result = createMeetingResult({
      topic: '请设计一个需要同步评审的本地原型增强',
      triggerReason: 'planning 识别到架构分歧，触发会议',
      roleOutputs: {
        pm: {
          summary: 'PM 已明确本地原型边界与优先级',
          riskLevel: 'low',
          risks: [],
          needsOwnerDecision: false,
          nextAction: 'continue'
        }
      },
      knownRisks: [],
      ownerConstraints: []
    });

    expect(result).toMatchObject({
      topic: '请设计一个需要同步评审的本地原型增强',
      roleSummaries: { pm: 'PM 已明确本地原型边界与优先级' },
      disagreements: ['实施路径存在待对齐分歧'],
      decision: '进入开发路径',
      decisionReason: '会议未发现阻塞与高风险，可继续推进',
      riskLevel: 'low',
      risks: [],
      actionItems: ['按会议决议进入开发实现'],
      nextStep: 'developing',
      needsOwnerDecision: false
    });
    expect('ownerQuestion' in result).toBe(false);
  });

  it('creates compatible meeting_notes artifact content', () => {
    const input = {
      topic: '请设计一个需要老板拍板范围的本地原型增强',
      triggerReason: 'planning 识别到关键风险',
      roleOutputs: {
        pm: {
          summary: 'PM 已识别需要老板确认范围',
          riskLevel: 'high' as const,
          risks: ['存在需要老板拍板的范围或优先级'],
          needsOwnerDecision: true,
          nextAction: 'request_owner_decision' as const
        }
      },
      knownRisks: ['存在需要老板拍板的范围或优先级'],
      ownerConstraints: ['请老板在范围与优先级之间做取舍']
    };
    const result = createMeetingResult(input);
    const artifact = createMeetingArtifact(input, result);

    expect(artifact.kind).toBe('meeting_notes');
    expect(artifact.title).toContain('会议结论');

    const content = JSON.parse(artifact.content) as Record<string, unknown>;

    expect(content).toMatchObject({
      topic: '请设计一个需要老板拍板范围的本地原型增强',
      roleSummaries: { pm: 'PM 已识别需要老板确认范围' },
      disagreements: ['范围与优先级存在潜在冲突'],
      decision: '进入老板审批路径',
      decisionReason: '会议识别到高风险/关键分歧，需老板拍板',
      riskLevel: 'high',
      risks: ['存在需要老板拍板的范围或优先级'],
      actionItems: ['整理冲突点并提交老板决策'],
      ownerQuestion: '请老板在范围与优先级之间做取舍',
      nextStep: 'awaiting_owner_decision',
      needsOwnerDecision: true
    });
  });

  it('meeting can output blocked path when dependency is missing', () => {
    const result = createMeetingResult({
      topic: '请组织会议评审当前依赖缺失问题',
      triggerReason: '会议确认外部依赖缺失，无法继续',
      roleOutputs: {
        architect: {
          summary: 'Architect 确认缺少关键依赖，无法推进实现',
          riskLevel: 'high',
          risks: ['关键依赖缺失'],
          needsOwnerDecision: false,
          nextAction: 'block'
        }
      },
      knownRisks: ['关键依赖缺失'],
      ownerConstraints: []
    });

    expect(result).toMatchObject({
      decision: '进入阻塞路径',
      riskLevel: 'high',
      nextStep: 'blocked',
      needsOwnerDecision: false,
      actionItems: ['补齐外部依赖后再恢复推进']
    });
  });

  it('meeting can confirm blocked based on planning risk context', () => {
    const result = createMeetingResult({
      topic: '请先组织会议评审依赖缺失的本地原型增强并确认阻塞',
      triggerReason: '规划阶段识别到需先开会确认阻塞结论',
      roleOutputs: {
        pm: {
          summary: 'PM 建议先在会议中确认是否需要暂停',
          riskLevel: 'medium',
          risks: [],
          needsOwnerDecision: false,
          nextAction: 'continue'
        }
      },
      knownRisks: ['关键依赖缺失'],
      ownerConstraints: []
    });

    expect(result).toMatchObject({
      decision: '进入阻塞路径',
      riskLevel: 'high',
      nextStep: 'blocked',
      needsOwnerDecision: false,
      risks: ['关键依赖缺失']
    });
  });

  it('leader meeting notes include existing PM summary', async () => {
    const result = await runLeaderTask('请设计一个需要同步评审的本地原型增强', {
      forceMeeting: true,
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      }
    });
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
