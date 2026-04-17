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

export type ArtifactKind =
  | 'requirements_brief'
  | 'implementation_plan'
  | 'architecture_note'
  | 'code_summary'
  | 'test_report'
  | 'delivery_summary'
  | 'clarification_request'
  | 'meeting_notes'
  | 'blocker_report';

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
  status: 'pending' | 'approved' | 'rejected';
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
}

export interface MeetingResult {
  topic: string;
  roleSummaries: Partial<Record<Exclude<Role, 'leader'>, string>>;
  decisions: string[];
  risks: string[];
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
