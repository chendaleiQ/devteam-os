import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { runAgent } from '../src/agents/index.js';
import { runLeaderTask } from '../src/leader.js';
import { LlmSchemaError } from '../src/llm/index.js';
import { parsePatchProposal } from '../src/patch-proposal.js';
import { collectTaskRiskSignals } from '../src/risk.js';

const LLM_ENV_KEYS = ['DEVTEAM_LLM_PROVIDER', 'DEVTEAM_LLM_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] as const;

function createAnthropicCompatibleResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'MiniMax-M2.7',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [
        { type: 'thinking', thinking: 'internal' },
        { type: 'text', text: JSON.stringify(payload) }
      ]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('agent protocol batch 1', () => {
  it('all roles should output unified decision fields', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    for (const role of ['pm', 'architect', 'developer', 'qa'] as const) {
      const output = await runAgent(role, input);

      expect(output).toMatchObject({
        role,
        summary: expect.any(String),
        confidence: expect.any(Number),
        riskLevel: expect.stringMatching(/low|medium|high/u),
        risks: expect.any(Array),
        needsOwnerDecision: expect.any(Boolean),
        nextAction: expect.any(String),
        artifact: expect.objectContaining({ createdBy: role })
      });
    }
  });

  it('pm/architect/qa should accept structured openai output and preserve system artifact fields', async () => {
    const responses = {
      pm: {
        summary: 'PM 通过模型生成实施计划。',
        confidence: 0.91,
        riskLevel: 'medium',
        risks: ['依赖外部接口确认'],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '先完成闭环，再补充扩展项。'
      },
      architect: {
        summary: 'Architect 通过模型生成边界说明。',
        confidence: 0.89,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '保持单入口状态流与清晰模块边界。'
      },
      qa: {
        summary: 'QA 通过模型生成测试结论。',
        confidence: 0.9,
        riskLevel: 'medium',
        risks: ['需要覆盖失败恢复路径'],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '已覆盖主流程与失败恢复流程。'
      }
    } as const;

    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    for (const role of ['pm', 'architect', 'qa'] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(responses[role]) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

      const output = await runAgent(role, input, {
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'test-key',
          fetch: fetchImpl,
          maxRetries: 0
        }
      });

      expect(output).toMatchObject({
        role,
        summary: responses[role].summary,
        confidence: responses[role].confidence,
        riskLevel: responses[role].riskLevel,
        risks: responses[role].risks,
        needsOwnerDecision: responses[role].needsOwnerDecision,
        nextAction: responses[role].nextAction
      });
      expect(output.artifact.createdBy).toBe(role);
      expect(output.artifact.content).toBe(responses[role].artifactContent);
    }

    const pmOutput = await runAgent('pm', input, {
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(responses.pm) } }]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        ),
        maxRetries: 0
      }
    });

    expect(pmOutput.artifact.kind).toBe('implementation_plan');
    expect(pmOutput.artifact.title).toBe('实施计划');
  });

  it('malformed openai output should fail visibly instead of becoming a success output', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(
      runAgent('pm', input, {
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                choices: [{ message: { content: '{"summary":"bad","confidence":0.9}' } }]
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            )
          ),
          maxRetries: 0
        }
      })
    ).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it('developer openai path should return a valid patch proposal artifact', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'developing' as const,
      artifacts: [],
      contextSummary: '进入开发阶段',
      riskSignals: [],
      requestedOutcome: '给出受控 patch proposal'
    };

    const output = await runAgent('developer', input, {
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify({
                summary: 'Developer 生成结构化 patch proposal',
                confidence: 0.9,
                riskLevel: 'medium',
                risks: ['需要确认 proposal 与现有文件一致'],
                needsOwnerDecision: false,
                nextAction: 'continue',
                patchProposal: {
                  format: 'devteam.patch-proposal.v1',
                  summary: '更新 domain 并新增校验器',
                  rationale: '先输出受控 proposal，再由后续批次决定是否应用',
                  verificationPlan: ['运行 patch proposal 测试', '运行 agent protocol 测试'],
                  changes: [
                    {
                      path: 'src/domain.ts',
                      operation: 'update',
                      purpose: '补充新的 artifact kind',
                      content: 'export type Role = \'leader\' | \'pm\' | \'architect\' | \'developer\' | \'qa\';\n'
                    }
                  ]
                }
              }) } }]
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        ),
        maxRetries: 0
      }
    });

    expect(output).toMatchObject({
      role: 'developer',
      summary: 'Developer 生成结构化 patch proposal',
      confidence: 0.9,
      riskLevel: 'medium',
      risks: ['需要确认 proposal 与现有文件一致'],
      needsOwnerDecision: false,
      nextAction: 'continue',
      artifact: expect.objectContaining({
        createdBy: 'developer'
      })
    });
    expect(output.artifact.kind).toBe('patch_proposal');
    expect(JSON.parse(output.artifact.content)).toMatchObject({
      format: 'devteam.patch-proposal.v1',
      changes: [
        expect.objectContaining({ path: 'src/domain.ts', operation: 'update' })
      ]
    });
  });

  it('pm/architect/qa minimax path should return valid AgentRunOutput', async () => {
    const responses = {
      pm: {
        summary: 'PM 通过 MiniMax 生成实施计划。',
        confidence: 0.91,
        riskLevel: 'medium',
        risks: ['依赖排期待确认'],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '先完成主路径，再补充非关键扩展。'
      },
      architect: {
        summary: 'Architect 通过 MiniMax 生成架构说明。',
        confidence: 0.88,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '保持单入口编排与模块边界清晰。'
      },
      qa: {
        summary: 'QA 通过 MiniMax 生成测试结论。',
        confidence: 0.9,
        riskLevel: 'medium',
        risks: ['需要补一条失败恢复用例'],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: '已覆盖主流程，建议补失败恢复场景。'
      }
    } as const;

    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    for (const role of ['pm', 'architect', 'qa'] as const) {
      const output = await runAgent(role, input, {
        llm: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse(responses[role])),
          maxRetries: 0
        }
      });

      expect(output).toMatchObject({
        role,
        summary: responses[role].summary,
        confidence: responses[role].confidence,
        riskLevel: responses[role].riskLevel,
        risks: responses[role].risks,
        needsOwnerDecision: responses[role].needsOwnerDecision,
        nextAction: responses[role].nextAction,
        artifact: expect.objectContaining({ createdBy: role, content: responses[role].artifactContent })
      });
    }
  });

  it('pm minimax path should stringify object artifactContent', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    const output = await runAgent('pm', input, {
      llm: {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'PM 通过 MiniMax 生成实施计划。',
          confidence: 0.91,
          riskLevel: 'medium',
          risks: ['依赖排期待确认'],
          needsOwnerDecision: false,
          nextAction: 'continue',
          artifactContent: {
            steps: ['先完成主路径', '再补充非关键扩展'],
            owner: 'pm'
          }
        })),
        maxRetries: 0
      }
    });

    expect(output.artifact.content).toBe(JSON.stringify({
      steps: ['先完成主路径', '再补充非关键扩展'],
      owner: 'pm'
    }, null, 2));
  });

  it('pm minimax path should normalize risks object array into strings', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    const output = await runAgent('pm', input, {
      llm: {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'PM 通过 MiniMax 生成实施计划。',
          confidence: 0.91,
          riskLevel: 'medium',
          risks: [
            { description: '依赖排期待确认' },
            { description: '需要补充失败恢复验证' }
          ],
          needsOwnerDecision: false,
          nextAction: 'continue',
          artifactContent: '先完成主路径，再补充非关键扩展。'
        })),
        maxRetries: 0
      }
    });

    expect(output.risks).toEqual(['依赖排期待确认', '需要补充失败恢复验证']);
  });

  it('developer minimax path should normalize risks object array into strings', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'developing' as const,
      artifacts: [],
      contextSummary: '进入开发阶段',
      riskSignals: [],
      requestedOutcome: '给出受控 patch proposal'
    };

    const output = await runAgent('developer', input, {
      llm: {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'Developer 通过 MiniMax 生成结构化 patch proposal',
          confidence: 0.9,
          riskLevel: 'medium',
          risks: [{ description: '需要确认 proposal 与现有文件一致' }],
          needsOwnerDecision: false,
          nextAction: 'continue',
          patchProposal: {
            format: 'devteam.patch-proposal.v1',
            summary: '更新 domain 并新增校验器',
            rationale: '继续复用受控 proposal 链路',
            verificationPlan: ['运行 patch proposal 测试', '运行 agent protocol 测试'],
            changes: [
              {
                path: 'src/domain.ts',
                operation: 'update',
                purpose: '补充新的 artifact kind',
                content: 'export type Role = \'leader\' | \'pm\' | \'architect\' | \'developer\' | \'qa\';\n'
              }
            ]
          }
        })),
        maxRetries: 0
      }
    });

    expect(output.risks).toEqual(['需要确认 proposal 与现有文件一致']);
  });

  it('pm minimax path should still reject invalid risks object entries', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(
      runAgent('pm', input, {
        llm: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
            summary: 'PM 通过 MiniMax 生成实施计划。',
            confidence: 0.91,
            riskLevel: 'medium',
            risks: [{ detail: '依赖排期待确认' }],
            needsOwnerDecision: false,
            nextAction: 'continue',
            artifactContent: '先完成主路径，再补充非关键扩展。'
          })),
          maxRetries: 0
        }
      })
    ).rejects.toThrow('Agent LLM output missing valid risks');
  });

  it('pm minimax path should still reject empty string artifactContent', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(
      runAgent('pm', input, {
        llm: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
            summary: 'PM 通过 MiniMax 生成实施计划。',
            confidence: 0.91,
            riskLevel: 'medium',
            risks: ['依赖排期待确认'],
            needsOwnerDecision: false,
            nextAction: 'continue',
            artifactContent: ''
          })),
          maxRetries: 0
        }
      })
    ).rejects.toThrow('Agent LLM output missing valid artifactContent');
  });

  it('pm minimax path should still reject boolean artifactContent', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(
      runAgent('pm', input, {
        llm: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
            summary: 'PM 通过 MiniMax 生成实施计划。',
            confidence: 0.91,
            riskLevel: 'medium',
            risks: ['依赖排期待确认'],
            needsOwnerDecision: false,
            nextAction: 'continue',
            artifactContent: true
          })),
          maxRetries: 0
        }
      })
    ).rejects.toThrow('Agent LLM output missing valid artifactContent');
  });

  it('developer minimax path should return a valid patch proposal artifact', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'developing' as const,
      artifacts: [],
      contextSummary: '进入开发阶段',
      riskSignals: [],
      requestedOutcome: '给出受控 patch proposal'
    };

    const output = await runAgent('developer', input, {
      llm: {
        provider: 'minimax',
        model: 'MiniMax-M2.7',
        apiKey: 'test-key',
        fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'Developer 通过 MiniMax 生成结构化 patch proposal',
          confidence: 0.9,
          riskLevel: 'medium',
          risks: ['需要确认 proposal 与现有文件一致'],
          needsOwnerDecision: false,
          nextAction: 'continue',
          patchProposal: {
            format: 'devteam.patch-proposal.v1',
            summary: '更新 domain 并新增校验器',
            rationale: '继续复用受控 proposal 链路',
            verificationPlan: ['运行 patch proposal 测试', '运行 agent protocol 测试'],
            changes: [
              {
                path: 'src/domain.ts',
                operation: 'update',
                purpose: '补充新的 artifact kind',
                content: 'export type Role = \'leader\' | \'pm\' | \'architect\' | \'developer\' | \'qa\';\n'
              }
            ]
          }
        })),
        maxRetries: 0
      }
    });

    expect(output).toMatchObject({
      role: 'developer',
      summary: 'Developer 通过 MiniMax 生成结构化 patch proposal',
      confidence: 0.9,
      riskLevel: 'medium',
      risks: ['需要确认 proposal 与现有文件一致'],
      needsOwnerDecision: false,
      nextAction: 'continue',
      artifact: expect.objectContaining({
        kind: 'patch_proposal',
        createdBy: 'developer'
      })
    });
    expect(JSON.parse(output.artifact.content)).toMatchObject({
      format: 'devteam.patch-proposal.v1',
      changes: [
        expect.objectContaining({ path: 'src/domain.ts', operation: 'update' })
      ]
    });
  });

  it('pm should activate minimax from env-only provider config', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await withLlmEnv(
      {
        DEVTEAM_LLM_PROVIDER: 'minimax',
        DEVTEAM_LLM_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_API_KEY: 'test-key'
      },
      async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'PM env-only minimax summary',
          confidence: 0.91,
          riskLevel: 'medium',
          risks: ['需要确认环境配置是否贯通'],
          needsOwnerDecision: false,
          nextAction: 'continue',
          artifactContent: 'PM env-only minimax artifact'
        }));

        vi.stubGlobal('fetch', fetchImpl);

        const output = await runAgent('pm', input);

        expect(output).toMatchObject({
          role: 'pm',
          summary: 'PM env-only minimax summary',
          artifact: expect.objectContaining({ content: 'PM env-only minimax artifact' })
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('developer should activate patch proposal path from env-only provider config', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-developer-env-minimax-'));
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'developing' as const,
      artifacts: [],
      contextSummary: '进入开发阶段',
      riskSignals: [],
      requestedOutcome: '给出受控 patch proposal'
    };

    await withLlmEnv(
      {
        DEVTEAM_LLM_PROVIDER: 'minimax',
        DEVTEAM_LLM_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_API_KEY: 'test-key'
      },
      async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createAnthropicCompatibleResponse({
          summary: 'Developer env-only minimax summary',
          confidence: 0.9,
          riskLevel: 'medium',
          risks: ['需要确认 env-only provider 激活'],
          needsOwnerDecision: false,
          nextAction: 'continue',
          patchProposal: {
            format: 'devteam.patch-proposal.v1',
            summary: '通过 env-only provider 进入 patch proposal',
            rationale: 'Developer 应识别环境里的显式 provider 配置。',
            verificationPlan: ['运行 agent protocol 测试'],
            changes: [
              {
                path: '.devteam-os/env-only-developer-proposal.ts',
                operation: 'add',
                purpose: '验证 env-only provider 会走 proposal 路径',
                content: 'export const envOnlyProvider = true;\n'
              }
            ]
          }
        }));

        vi.stubGlobal('fetch', fetchImpl);

        const output = await runAgent('developer', input, { workspaceRoot });

        expect(output).toMatchObject({
          role: 'developer',
          summary: 'Developer env-only minimax summary',
          artifact: expect.objectContaining({ kind: 'patch_proposal' })
        });
        expect(parsePatchProposal(output.artifact.content, workspaceRoot)).toMatchObject({
          format: 'devteam.patch-proposal.v1',
          changes: [expect.objectContaining({ path: '.devteam-os/env-only-developer-proposal.ts', operation: 'add' })]
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('malformed minimax role output should fail visibly instead of becoming a success output', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(
      runAgent('pm', input, {
        llm: {
          provider: 'minimax',
          model: 'MiniMax-M2.7',
          apiKey: 'test-key',
          fetch: vi.fn().mockResolvedValue(createAnthropicCompatibleResponse('{"summary":"bad","confidence":0.9}')),
          maxRetries: 0
        }
      })
    ).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it('developer mock path should return a validated patch proposal artifact when provider is explicit', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-developer-mock-'));
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'developing' as const,
      artifacts: [],
      contextSummary: '进入开发阶段',
      riskSignals: [],
      requestedOutcome: '给出受控 patch proposal'
    };

    const output = await runAgent('developer', input, {
      llm: { provider: 'mock' },
      workspaceRoot
    });

    expect(output).toMatchObject({
      role: 'developer',
      nextAction: 'continue',
      artifact: expect.objectContaining({
        kind: 'patch_proposal',
        createdBy: 'developer'
      })
    });

    const proposal = parsePatchProposal(output.artifact.content, workspaceRoot);

    expect(proposal).toMatchObject({
      format: 'devteam.patch-proposal.v1',
      changes: [
        expect.objectContaining({
          path: '.devteam-os/mock-developer-proposal-task_test.ts',
          operation: 'add'
        })
      ]
    });
  });

  it('runLeaderTask should wire openai outputs into agentRuns', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-agent-protocol-'));
    writeFileSync(join(workspaceRoot, 'domain.ts'), 'export type Domain = "before";\n', 'utf8');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'PM openai summary',
              confidence: 0.93,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'PM artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'Architect openai summary',
              confidence: 0.92,
              riskLevel: 'medium',
              risks: ['需要约束模块边界'],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'Architect artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'Developer openai summary',
              confidence: 0.91,
              riskLevel: 'medium',
              risks: ['需要审阅 proposal'],
              needsOwnerDecision: false,
              nextAction: 'continue',
              patchProposal: {
                format: 'devteam.patch-proposal.v1',
                summary: 'Update domain types for developer artifact',
                rationale: 'Preserve a controlled artifact before file writes exist',
                verificationPlan: ['Run agent protocol tests'],
                changes: [
                   {
                     path: 'domain.ts',
                     operation: 'update',
                     purpose: 'Add patch proposal artifact support',
                     content: 'export type Domain = "after";\n'
                   }
                ]
              }
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'QA openai summary',
              confidence: 0.9,
              riskLevel: 'medium',
              risks: ['需要回归失败恢复流程'],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'QA artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      workspaceRoot,
      verificationScripts: ['typecheck'],
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      },
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: fetchImpl,
        maxRetries: 0
      }
    });

    expect(result.task.agentRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'pm', summary: 'PM openai summary', confidence: 0.93 }),
        expect.objectContaining({ role: 'architect', summary: 'Architect openai summary', confidence: 0.92 }),
        expect.objectContaining({ role: 'developer', summary: 'Developer openai summary', confidence: 0.91 }),
        expect.objectContaining({ role: 'qa', summary: 'QA openai summary', confidence: 0.9 })
      ])
    );
    expect(result.task.artifacts.find((artifact) => artifact.kind === 'implementation_plan')?.content).toBe('PM artifact from llm');
    expect(result.task.artifacts.find((artifact) => artifact.kind === 'architecture_note')?.content).toBe('Architect artifact from llm');
    expect(result.task.artifacts.find((artifact) => artifact.kind === 'patch_proposal')?.content).toContain('devteam.patch-proposal.v1');
    expect(result.task.artifacts.find((artifact) => artifact.kind === 'test_report')?.content).toBe('QA artifact from llm');
  });

  it('runLeaderTask should activate minimax role chain from env-only provider config', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-leader-env-minimax-'));
    writeFileSync(join(workspaceRoot, 'domain.ts'), 'export type Domain = "before";\n', 'utf8');

    await withLlmEnv(
      {
        DEVTEAM_LLM_PROVIDER: 'minimax',
        DEVTEAM_LLM_MODEL: 'MiniMax-M2.7',
        ANTHROPIC_API_KEY: 'test-key'
      },
      async () => {
        const fetchImpl = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            createAnthropicCompatibleResponse({
              summary: 'PM env-only minimax summary',
              confidence: 0.93,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'PM env-only minimax artifact'
            })
          )
          .mockResolvedValueOnce(
            createAnthropicCompatibleResponse({
              summary: 'Architect env-only minimax summary',
              confidence: 0.92,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'Architect env-only minimax artifact'
            })
          )
          .mockResolvedValueOnce(
            createAnthropicCompatibleResponse({
              summary: 'Developer env-only minimax summary',
              confidence: 0.91,
              riskLevel: 'medium',
              risks: ['需要确认 proposal 会被应用'],
              needsOwnerDecision: false,
              nextAction: 'continue',
              patchProposal: {
                format: 'devteam.patch-proposal.v1',
                summary: 'Update domain through env-only minimax',
                rationale: 'Leader 应在无显式 llm 配置时仍贯通环境 provider。',
                verificationPlan: ['运行 leader env-only minimax 测试'],
                changes: [
                  {
                    path: 'domain.ts',
                    operation: 'update',
                    purpose: '验证 proposal apply',
                    content: 'export type Domain = "after";\n'
                  }
                ]
              }
            })
          )
          .mockResolvedValueOnce(
            createAnthropicCompatibleResponse({
              summary: 'QA env-only minimax summary',
              confidence: 0.9,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'QA env-only minimax artifact'
            })
          );

        vi.stubGlobal('fetch', fetchImpl);

        const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
          workspaceRoot,
          verificationScripts: ['typecheck'],
          runner: {
            runScript(script) {
              return { script, ok: true, blocked: false, summary: `ok ${script}` };
            }
          }
        });

        expect(result.paused).toBe(false);
        expect(result.task.state).toBe('done');
        expect(result.task.agentRuns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'pm', summary: 'PM env-only minimax summary' }),
            expect.objectContaining({ role: 'architect', summary: 'Architect env-only minimax summary' }),
            expect.objectContaining({ role: 'developer', summary: 'Developer env-only minimax summary' }),
            expect.objectContaining({ role: 'qa', summary: 'QA env-only minimax summary' })
          ])
        );
        expect(readFileSync(join(workspaceRoot, 'domain.ts'), 'utf8')).toBe('export type Domain = "after";\n');
        expect(fetchImpl).toHaveBeenCalledTimes(4);
      }
    );
  });

  it('default and mock paths should preserve existing rule behavior', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请实现一个本地可运行的原型',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(runAgent('pm', input)).resolves.toMatchObject({ summary: 'PM 输出可执行计划' });
    await expect(runAgent('pm', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({ summary: 'PM 输出可执行计划' });
    await expect(runAgent('architect', input)).resolves.toMatchObject({ summary: 'Architect 输出骨架设计说明' });
    await expect(runAgent('architect', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({ summary: 'Architect 输出骨架设计说明' });
    await expect(runAgent('qa', input)).resolves.toMatchObject({ summary: 'QA 输出测试结论' });
    await expect(runAgent('qa', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({ summary: 'QA 输出测试结论' });
  });

  it('mock provider should drive PM/Architect/QA through the controlled role protocol', async () => {
    const input = {
      taskId: 'task_test',
      taskSummary: '请评估预算冲突下的本地原型方案并给出执行路径',
      currentStatus: 'planning' as const,
      artifacts: [],
      contextSummary: '初始规划阶段',
      riskSignals: [{ code: 'external_dependency_pending', level: 'medium' as const, description: '外部依赖尚未确认' }],
      requestedOutcome: '给出下一步执行建议'
    };

    await expect(runAgent('pm', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({
      summary: 'PM 识别到优先级冲突，建议先老板拍板',
      riskLevel: 'high',
      needsOwnerDecision: true,
      nextAction: 'request_owner_decision'
    });
    await expect(runAgent('architect', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({
      summary: 'Architect 输出骨架设计说明',
      riskLevel: 'medium',
      nextAction: 'continue'
    });
    await expect(runAgent('qa', input, { llm: { provider: 'mock' } })).resolves.toMatchObject({
      summary: 'QA 输出测试结论',
      riskLevel: 'medium',
      risks: ['外部依赖尚未确认'],
      nextAction: 'continue'
    });
  });

  it('runLeaderTask should complete proposal apply loop for explicit mock developer path', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-leader-mock-'));

    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      workspaceRoot,
      verificationScripts: ['typecheck'],
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      },
      llm: { provider: 'mock' }
    });

    expect(result.task.state).toBe('done');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'patch_proposal')).toBe(true);
    const proposalArtifact = result.task.artifacts.find((artifact) => artifact.kind === 'patch_proposal');
    const proposal = JSON.parse(proposalArtifact?.content ?? '{}') as { changes?: Array<{ path?: string; operation?: string }> };

    expect(proposal.changes).toEqual([
      expect.objectContaining({
        path: expect.stringMatching(/^\.devteam-os\/mock-developer-proposal-task_[a-z0-9]+\.ts$/u),
        operation: 'add'
      })
    ]);
    expect(existsSync(join(workspaceRoot, proposal.changes?.[0]?.path ?? 'missing'))).toBe(true);
  });

  it('planning should respect PM protocol needsOwnerDecision flag', async () => {
    const result = await runLeaderTask('请评估预算冲突下的本地原型方案并给出执行路径', {
      executionBackend: 'legacy'
    });
    const pmRun = result.task.agentRuns.find((run) => run.role === 'pm') as Record<string, unknown> | undefined;

    expect(pmRun?.needsOwnerDecision).toBe(true);
    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
  });

  it('approved meeting and approval risks should propagate into downstream QA output', async () => {
    const riskSignals = collectTaskRiskSignals({
      latestMeetingResult: {
        topic: '请设计一个需要老板拍板范围的本地原型增强',
        roleSummaries: { pm: 'PM 已识别需要老板确认范围' },
        disagreements: ['范围与优先级存在潜在冲突'],
        decision: '进入老板审批路径',
        decisionReason: '会议识别到高风险/关键分歧，需老板拍板',
        riskLevel: 'high',
        decisions: ['先按本地原型边界推进'],
        risks: ['存在需要老板拍板的范围或优先级'],
        actionItems: ['整理冲突点并提交老板决策'],
        nextStep: 'awaiting_owner_decision',
        needsOwnerDecision: true
      },
      approvalRequests: [
        {
          id: 'approval_test',
          reason: '会议已形成方案，但需老板最终拍板',
          requestedBy: 'leader',
          trigger: 'multi_option_direction_change',
          riskLevel: 'high',
          status: 'approved'
        }
      ],
      transitions: [],
      state: 'developing'
    });

    const qaRun = await runAgent('qa', {
      taskId: 'task_test',
      taskSummary: '请设计一个需要老板拍板范围的本地原型增强',
      currentStatus: 'testing',
      artifacts: [],
      contextSummary: 'meeting 已结束，老板已批准，进入后续验证',
      riskSignals,
      requestedOutcome: '执行验证并给出测试结论'
    }, {
      llm: { provider: 'mock' }
    });

    expect(riskSignals.length).toBeGreaterThan(0);
    expect(qaRun).toMatchObject({
      riskLevel: 'medium',
      risks: expect.arrayContaining([
        expect.stringMatching(/会议|老板拍板|审批/u)
      ])
    });
  });
});

async function withLlmEnv(
  env: Partial<Record<(typeof LLM_ENV_KEYS)[number], string>>,
  run: () => Promise<void>
): Promise<void> {
  const previousEnv = new Map<string, string | undefined>();

  for (const key of LLM_ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await run();
  } finally {
    vi.unstubAllGlobals();
    for (const key of LLM_ENV_KEYS) {
      const previousValue = previousEnv.get(key);
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}
