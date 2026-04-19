export type Role = 'leader' | 'pm' | 'architect' | 'developer' | 'qa';

export type TaskState =
  | 'intake'
  | 'clarifying'
  | 'planning'
  | 'meeting'
  | 'developing'
  | 'testing'
  | 'reporting'
  | 'awaiting_owner_decision'
  | 'blocked'
  | 'done';

export type RiskLevel = 'low' | 'medium' | 'high';

export type NextAction =
  | 'continue'
  | 'request_owner_decision'
  | 'trigger_meeting'
  | 'rework'
  | 'block';

export type ApprovalTrigger =
  | 'clarification_required'
  | 'scope_change'
  | 'high_risk_command'
  | 'destructive_operation'
  | 'acceptance_criteria_change'
  | 'multi_option_direction_change'
  | 'role_requested_owner_decision'
  | 'report_confirmation';

export type LoopbackReason =
  | 'testing_failed'
  | 'solution_conflict'
  | 'requirements_changed'
  | 'risk_escalated';

export interface RiskSignal {
  code: string;
  description: string;
  level: RiskLevel;
  trigger?: ApprovalTrigger;
}

export interface RoleDecision {
  needsOwnerDecision: boolean;
  nextAction: NextAction;
}

export type ArtifactKind =
  | 'requirements_brief'
  | 'implementation_plan'
  | 'architecture_note'
  | 'code_summary'
  | 'patch_proposal'
  | 'test_report'
  | 'delivery_summary'
  | 'clarification_request'
  | 'meeting_notes'
  | 'blocker_report'
  | 'role_input_snapshot'
  | 'role_output'
  | 'risk_assessment'
  | 'loopback_note'
  | 'context_summary';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  createdBy: Role;
  content: string;
}

export interface AgentRun {
  id: string;
  role: Role;
  summary: string;
  confidence?: number;
  riskLevel?: RiskLevel;
  risks?: string[];
  needsOwnerDecision?: boolean;
  nextAction?: NextAction;
  failureReason?: string;
  producedArtifactIds: string[];
}

export interface StateTransition {
  from: TaskState;
  to: TaskState;
  reason: string;
  decisionReason?: string;
  executionRule?: string;
}

export interface ApprovalRequest {
  id: string;
  reason: string;
  requestedBy: Role;
  trigger: ApprovalTrigger;
  riskLevel: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
}

export interface ValidationResult {
  passed: boolean;
  summary: string;
  issues: string[];
}

export interface DeliveryReport {
  finalState: TaskState;
  summary: string;
  completedSteps: string[];
  pendingItems: string[];
  artifactIds: string[];
  keyArtifactIds?: string[];
  validation: ValidationResult;
}

export type TestCommandSource = 'user' | 'repo_config' | 'package_scripts' | 'unknown';

export interface TestCommandResolution {
  command: string;
  source: TestCommandSource;
  reason: string;
  blocked: boolean;
}

export interface WaitingSummary {
  reason: string;
  requestedInput: string;
  resumeTargetState: TaskState;
}

export interface Checkpoint {
  state: TaskState;
  transitionCount: number;
  artifactCount: number;
  summary: string;
  artifactIds?: string[];
}

export interface MeetingRoleOutput {
  summary: string;
  riskLevel: RiskLevel;
  risks: string[];
  needsOwnerDecision: boolean;
  nextAction: NextAction;
}

export interface MeetingInput {
  topic: string;
  triggerReason: string;
  roleOutputs: Partial<Record<Exclude<Role, 'leader'>, MeetingRoleOutput>>;
  knownRisks: string[];
  ownerConstraints: string[];
}

export interface MeetingResult {
  topic: string;
  roleSummaries: Partial<Record<Exclude<Role, 'leader'>, string>>;
  disagreements: string[];
  decision: string;
  decisionReason: string;
  riskLevel: RiskLevel;
  decisions: string[];
  risks: string[];
  actionItems: string[];
  ownerQuestion?: string;
  nextStep: TaskState;
  needsOwnerDecision: boolean;
}

export interface Task {
  id: string;
  input: string;
  state: TaskState;
  needsClarification: boolean;
  artifacts: Artifact[];
  agentRuns: AgentRun[];
  transitions: StateTransition[];
  approvalRequests: ApprovalRequest[];
  validation?: ValidationResult;
  deliveryReport?: DeliveryReport;
  checkpoint?: Checkpoint;
  waitingSummary?: WaitingSummary;
  latestMeetingResult?: MeetingResult;
  testCommandResolution?: TestCommandResolution;
}

export interface LeaderRunResult {
  task: Task;
  paused: boolean;
}
