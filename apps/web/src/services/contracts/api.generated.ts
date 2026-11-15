// Generated from apps/api/openapi.json. Do not edit manually.
// Contract SHA-256: e552658ef1f032e83f2267417a2bccf03a64ea1423831957279376d46fff300f
/* oxlint-disable */
// oxfmt-ignore-file

export type AIConfigAvailability = {
  "credential_configured": boolean;
  "provider"?: "deepseek";
};

export type AIConfigCopy = {
  "name": string;
  "source_version"?: (number) | (null);
};

export type AIConfigCreate = {
  "content": (APIConfigContent) | (ModelConfigContent) | (PromptConfigContent) | (AgentConfigContent);
  "enabled"?: boolean;
  "name": string;
};

export type AIConfigJobReference = {
  "job_id": string;
  "kind": string;
  "matched_version_ids": Array<string>;
  "project_id": string;
  "status": string;
};

export type AIConfigPage = {
  "items": Array<AIConfigRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type AIConfigRead = {
  "content": (APIConfigContent) | (ModelConfigContent) | (PromptConfigContent) | (AgentConfigContent);
  "created_at": string;
  "current_version_id": string;
  "enabled": boolean;
  "id": string;
  "kind": "api" | "model" | "prompt" | "agent";
  "name": string;
  "updated_at": string;
  "version": number;
};

export type AIConfigReference = {
  "config_id": string;
  "current": boolean;
  "enabled": boolean;
  "kind": "api" | "model" | "prompt" | "agent";
  "name": string;
  "referenced_version_id": string;
  "version": number;
  "version_id": string;
};

export type AIConfigReferences = {
  "configs": Array<AIConfigReference>;
  "configs_truncated": boolean;
  "jobs": Array<AIConfigJobReference>;
  "jobs_truncated": boolean;
};

export type AIConfigUpdate = {
  "content"?: ((APIConfigContent) | (ModelConfigContent) | (PromptConfigContent) | (AgentConfigContent)) | (null);
  "enabled"?: (boolean) | (null);
  "expected_version": number;
  "name"?: (string) | (null);
};

export type AIConfigVersionPage = {
  "items": Array<AIConfigVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type AIConfigVersionRead = {
  "config_id": string;
  "content": (APIConfigContent) | (ModelConfigContent) | (PromptConfigContent) | (AgentConfigContent);
  "created_at": string;
  "id": string;
  "name": string;
  "version": number;
};

export type APIConfigContent = {
  "base_url"?: "https://api.deepseek.com";
  "credential_ref"?: "deepseek-default";
  "description"?: string;
  "kind": "api";
  "max_retries"?: number;
  "provider"?: "deepseek";
  "rate_limit_per_minute"?: number;
  "timeout_seconds"?: number;
};

export type AgentConfigContent = {
  "allowed_tools"?: Array<"read_context" | "return_suggestion">;
  "description"?: string;
  "input_schema"?: { [key: string]: unknown };
  "instructions": string;
  "kind": "agent";
  "model_version_id": string;
  "output_schema"?: { [key: string]: unknown };
  "prompt_version_id": string;
  "role": "general" | "literature" | "content" | "format" | "progress" | "review";
};

export type ConfigurationProbeConfiguration = {
  "agent"?: (AgentConfigContent) | (null);
  "api"?: (APIConfigContent) | (null);
  "config_kind": "api" | "model" | "prompt" | "agent";
  "config_version_id": string;
  "model"?: (ModelConfigContent) | (null);
  "prompt"?: (PromptConfigContent) | (null);
  "schema_version"?: 1;
  "version_ids": { [key in "api" | "model" | "prompt" | "agent"]?: string };
};

export type ConfigurationProbeInput = {
  "config_version_id": string;
  "schema_version"?: 1;
  "variables"?: { [key: string]: unknown };
};

export type ConfigurationProbeResult = {
  "config_kind": "api" | "model" | "prompt" | "agent";
  "config_version_id": string;
  "content": string;
  "job_id": string;
  "kind": "configuration_probe";
  "model_used": boolean;
  "project_id": string;
  "requested_model": (string) | (null);
  "response_model": (string) | (null);
  "schema_version": 1;
  "version_ids": { [key in "api" | "model" | "prompt" | "agent"]?: string };
  "writes_performed": false;
};

export type ConfigurationProbeScope = {
  "config_version_id": string;
  "schema_version"?: 1;
  "version_ids": { [key in "api" | "model" | "prompt" | "agent"]?: string };
};

export type DiagnosticResult = {
  "checked": true;
  "job_id": string;
  "kind": "diagnostic";
  "message": string;
  "model_used": false;
  "project_id": string;
  "writes_performed": false;
};

export type DocumentContent_Input = {
  "json": { [key: string]: EditorJsonValue_Input };
  "schema_version": 1;
};

export type DocumentContent_Output = {
  "json": { [key: string]: EditorJsonValue_Output };
  "schema_version": 1;
};

export type DocumentImport = {
  "content": DocumentContent_Input;
};

export type DocumentRead = {
  "content": DocumentContent_Output;
  "created_at": string;
  "id": string;
  "project_id": string;
  "updated_at": string;
  "version": number;
};

export type DocumentSave = {
  "content": DocumentContent_Input;
  "expected_version": number;
};

export type DocumentVersionPage = {
  "items": Array<DocumentVersionSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type DocumentVersionRead = {
  "content": DocumentContent_Output;
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert" | "blank";
  "version": number;
};

export type DocumentVersionSummary = {
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert" | "blank";
  "version": number;
};

export type EditorJsonValue_Input = ({ [key: string]: EditorJsonValue_Input }) | (Array<EditorJsonValue_Input>) | (string) | (boolean) | (number) | (number) | (null);

export type EditorJsonValue_Output = ({ [key: string]: EditorJsonValue_Output }) | (Array<EditorJsonValue_Output>) | (string) | (boolean) | (number) | (number) | (null);

export type ErrorDetail = {
  "code": string;
  "message": string;
  "request_id": string;
};

export type ErrorResponse = {
  "error": ErrorDetail;
};

export type FlowCreate = {
  "name": string;
  "stages": Array<FlowStage>;
};

export type FlowPage = {
  "items": Array<FlowRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FlowRead = {
  "created_at": string;
  "current_version_id": string;
  "enabled": boolean;
  "id": string;
  "name": string;
  "stages": Array<FlowStage>;
  "updated_at": string;
  "version": number;
};

export type FlowStage = {
  "conditions": Array<string>;
  "deadline"?: (string) | (null);
  "deliverables": Array<string>;
  "dependencies"?: Array<string>;
  "description"?: string;
  "enabled"?: boolean;
  "id": string;
  "name": string;
  "start"?: (string) | (null);
};

export type FlowUpdate = {
  "enabled"?: (boolean) | (null);
  "expected_version": number;
  "name"?: (string) | (null);
  "stages"?: (Array<FlowStage>) | (null);
};

export type FlowVersionPage = {
  "items": Array<FlowVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FlowVersionRead = {
  "created_at": string;
  "flow_id": string;
  "id": string;
  "name": string;
  "stages": Array<FlowStage>;
  "version": number;
};

export type HealthResponse = {
  "status": string;
};

export type InspectionConfiguration = {
  "include_text_statistics"?: boolean;
  "schema_version"?: 1;
};

export type InspectionInput = {
  "document_id": string;
  "document_version": number;
  "schema_version"?: 1;
};

export type InspectionResult = {
  "document_id": string;
  "document_version": number;
  "heading_count": number;
  "job_id": string;
  "kind": "document_inspection";
  "model_used": false;
  "node_count": number;
  "paragraph_count": number;
  "project_id": string;
  "schema_version": 1;
  "table_count": number;
  "text_characters": (number) | (null);
  "writes_performed": false;
};

export type JobArtifactRead = {
  "attempt_id": string;
  "created_at": string;
  "id": string;
  "job_id": string;
  "kind": "document_inspection" | "configuration_probe" | "material_parse";
  "result": (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult);
  "schema_version": 1;
};

export type JobAttemptRead = {
  "attempt": number;
  "error_code": (string) | (null);
  "finished_at": (string) | (null);
  "id": string;
  "started_at": string;
  "status": "running" | "succeeded" | "failed" | "cancelled" | "lease_expired";
};

export type JobCreate = {
  "configuration"?: (InspectionConfiguration) | (null);
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (null);
  "kind"?: "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse";
  "project_id": string;
};

export type JobDetail = {
  "artifacts": Array<JobArtifactRead>;
  "attempt": number;
  "attempts": Array<JobAttemptRead>;
  "configuration"?: (InspectionConfiguration) | (ConfigurationProbeConfiguration) | (MaterialParseConfiguration) | (null);
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (null);
  "kind": "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse";
  "project_id": string;
  "resource_scope"?: (InspectionInput) | (ConfigurationProbeScope) | (MaterialParseInput) | (null);
  "result": (DiagnosticResult) | (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult) | (null);
  "source_job_id"?: (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type JobPage = {
  "items": Array<JobRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type JobRead = {
  "attempt": number;
  "configuration"?: (InspectionConfiguration) | (ConfigurationProbeConfiguration) | (MaterialParseConfiguration) | (null);
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (null);
  "kind": "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse";
  "project_id": string;
  "resource_scope"?: (InspectionInput) | (ConfigurationProbeScope) | (MaterialParseInput) | (null);
  "result": (DiagnosticResult) | (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult) | (null);
  "source_job_id"?: (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type JsonObject = { [key: string]: EditorJsonValue_Output };

export type MaterialOriginalCreate = {
  "content_base64": string;
  "expected_version": number;
  "file_type": "docx" | "text" | "pdf";
  "filename": string;
  "kind": "template" | "requirements" | "literature" | "other";
  "name": string;
  "source_note"?: string;
};

export type MaterialOriginalPage = {
  "items": Array<MaterialOriginalRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type MaterialOriginalRead = {
  "byte_size": number;
  "created_at": string;
  "file_type": "docx" | "text" | "pdf";
  "filename": string;
  "id": string;
  "initial_job_id": (string) | (null);
  "latest_parse_id": (string) | (null);
  "material_id": string;
  "sha256": string;
  "version": number;
};

export type MaterialPage = {
  "items": Array<MaterialRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type MaterialParseConfiguration = {
  "file_type": "docx" | "text" | "pdf";
  "parser_version"?: "thesispilot-material-1";
  "schema_version"?: 1;
};

export type MaterialParseInput = {
  "expected_parse_id": (string) | (null);
  "material_id": string;
  "original_sha256": string;
  "original_version_id": string;
  "schema_version"?: 1;
};

export type MaterialParseRead = {
  "created_at": string;
  "id": string;
  "original_version_id": string;
  "result": ParsedMaterial;
  "source_job_id": string;
  "version": number;
};

export type MaterialParseResult = {
  "anchor_count": number;
  "job_id": string;
  "kind": "material_parse";
  "material_id": string;
  "model_used": false;
  "original_sha256": string;
  "original_version_id": string;
  "parse_version_id": string;
  "parser_version": "thesispilot-material-1";
  "project_id": string;
  "schema_version": 1;
  "text_characters": number;
  "writes_performed": false;
};

export type MaterialParseSummary = {
  "created_at": string;
  "id": string;
  "original_version_id": string;
  "source_job_id": string;
  "status": "complete" | "partial";
  "version": number;
};

export type MaterialParseSummaryPage = {
  "items": Array<MaterialParseSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type MaterialRead = {
  "created_at": string;
  "current_original_id": string;
  "id": string;
  "kind": "template" | "requirements" | "literature" | "other";
  "linked": boolean;
  "name": string;
  "project_id": string;
  "removed": boolean;
  "source_note": string;
  "updated_at": string;
  "version": number;
};

export type MaterialReparse = {
  "expected_parse_id": (string) | (null);
};

export type MaterialUpdate = {
  "expected_version": number;
  "kind"?: ("template" | "requirements" | "literature" | "other") | (null);
  "linked"?: (boolean) | (null);
  "name"?: (string) | (null);
  "removed"?: (boolean) | (null);
  "source_note"?: (string) | (null);
};

export type MaterialUpload = {
  "content_base64": string;
  "file_type": "docx" | "text" | "pdf";
  "filename": string;
  "kind": "template" | "requirements" | "literature" | "other";
  "name": string;
  "source_note"?: string;
};

export type MaterialUploadReceipt = {
  "job": JobRead;
  "material": MaterialRead;
  "original": MaterialOriginalRead;
};

export type ModelConfigContent = {
  "api_version_id": string;
  "capabilities": Array<"text" | "search" | "format" | "plan" | "review">;
  "context_limit"?: number;
  "description"?: string;
  "kind": "model";
  "max_output_tokens"?: number;
  "model_code": "deepseek-flash" | "deepseek-v4-pro";
  "temperature"?: number;
};

export type ParsedMaterial = {
  "anchors": Array<SourceAnchor>;
  "diagnostics": Array<string>;
  "editor_json": ({ [key: string]: EditorJsonValue_Output }) | (null);
  "parser_version"?: "thesispilot-material-1";
  "plain_text": string;
  "requirements": Array<ParsedRequirement>;
  "roundtrip_manifest": (JsonObject) | (null);
  "schema_version"?: 1;
  "status": "complete" | "partial";
  "template_items": Array<TemplateItem>;
};

export type ParsedRequirement = {
  "anchor_ids": Array<string>;
  "checkable": boolean;
  "enabled": boolean;
  "id": string;
  "kind": "word_count" | "reference_count" | "semantic";
  "original_text": string;
  "parameters"?: { [key: string]: number };
  "rule_type": "hard" | "semantic";
  "scope": string;
  "strictness": "required" | "suggested" | "unknown";
  "uncertainty": string;
};

export type ProfileRead = {
  "display_name": string;
  "id": string;
  "notifications_enabled": boolean;
  "quiet_end": string;
  "quiet_start": string;
  "show_deferred": boolean;
  "version": number;
};

export type ProfileUpdate = {
  "display_name": string;
  "expected_version": number;
  "notifications_enabled": boolean;
  "quiet_end": string;
  "quiet_start": string;
  "show_deferred": boolean;
};

export type ProjectCreate = {
  "archived"?: boolean;
  "deadline"?: (string) | (null);
  "existing_artifacts"?: string;
  "flow_version_id"?: (string) | (null);
  "name": string;
  "plan_note"?: string;
  "planning_mode"?: "none" | "personal";
  "stage_id"?: (string) | (null);
  "title"?: string;
};

export type ProjectPage = {
  "items": Array<ProjectRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type ProjectRead = {
  "archived": boolean;
  "created_at": string;
  "deadline": (string) | (null);
  "existing_artifacts": string;
  "flow_version_id": (string) | (null);
  "id": string;
  "name": string;
  "plan_note": string;
  "planning_mode": "none" | "personal";
  "stage_id": (string) | (null);
  "title": string;
  "updated_at": string;
  "version": number;
};

export type ProjectSourceBindingRead = {
  "current_version_id": (string) | (null);
  "project_id": string;
  "requirement_parse_version_ids": Array<string>;
  "template_parse_version_id": (string) | (null);
  "updated_at": (string) | (null);
  "version": number;
};

export type ProjectSourceBindingUpdate = {
  "expected_version": number;
  "requirement_parse_version_ids": Array<string>;
  "template_parse_version_id": (string) | (null);
};

export type ProjectSourceBindingVersionPage = {
  "items": Array<ProjectSourceBindingVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type ProjectSourceBindingVersionRead = {
  "created_at": string;
  "id": string;
  "project_id": string;
  "requirement_parse_version_ids": Array<string>;
  "template_parse_version_id": (string) | (null);
  "version": number;
};

export type ProjectUpdate = {
  "archived"?: (boolean) | (null);
  "deadline"?: (string) | (null);
  "existing_artifacts"?: (string) | (null);
  "expected_version": number;
  "flow_version_id"?: (string) | (null);
  "name"?: (string) | (null);
  "plan_note"?: (string) | (null);
  "planning_mode"?: ("none" | "personal") | (null);
  "stage_id"?: (string) | (null);
  "title"?: (string) | (null);
};

export type PromptConfigContent = {
  "description"?: string;
  "input_schema"?: { [key: string]: unknown };
  "kind": "prompt";
  "output_schema"?: { [key: string]: unknown };
  "template": string;
  "variables"?: Array<"context" | "goal" | "requirements" | "materials">;
};

export type RevisionApply = {
  "command_id": string;
  "expected_document_version": number;
  "expected_revision": number;
};

export type RevisionCancel = {
  "command_id": string;
};

export type RevisionCheck = {
  "detail": string;
  "from"?: (number) | (null);
  "patch_id"?: (string) | (null);
  "result": "pass" | "fail" | "unsupported";
  "rule": "version" | "range" | "number" | "citation" | "formula" | "lock" | "overlap" | "structure";
  "to"?: (number) | (null);
};

export type RevisionCommandRead = {
  "base_version": (number) | (null);
  "candidate_id": (string) | (null);
  "candidate_revision": (number) | (null);
  "command_id": string;
  "created_at": string;
  "document_id": string;
  "operation": "create" | "proposal" | "decide" | "apply" | "cancel" | "undo" | "revert";
  "result_version": (number) | (null);
};

export type RevisionCreate = {
  "base_version": number;
  "command_id": string;
  "goal": string;
  "selection": RevisionSelection;
};

export type RevisionDecide = {
  "command_id": string;
  "decisions": Array<RevisionDecision>;
  "expected_revision": number;
};

export type RevisionDecision = {
  "decision": "pending" | "accepted" | "rejected";
  "patch_id": string;
};

export type RevisionPage = {
  "items": Array<RevisionSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type RevisionPatch = {
  "after": string;
  "before": string;
  "from": number;
  "id": string;
  "to": number;
};

export type RevisionProposal = {
  "command_id": string;
  "generation_token": string;
  "patches": Array<RevisionPatch>;
};

export type RevisionRead = {
  "applicable": boolean;
  "application_command_id": (string) | (null);
  "base_version": number;
  "checks": Array<RevisionCheck>;
  "created_at": string;
  "decisions": Array<RevisionDecision>;
  "document_id": string;
  "document_version": number;
  "generation_token": (string) | (null);
  "goal": string;
  "id": string;
  "patches": Array<RevisionPatch>;
  "policy_version": string;
  "producer": "deterministic_preview";
  "project_id": string;
  "result_version": (number) | (null);
  "revision": number;
  "selection": RevisionSelection;
  "status": "generating" | "ready" | "invalid" | "cancelled" | "applied" | "undone";
  "updated_at": string;
};

export type RevisionRevert = {
  "command_id": string;
  "expected_document_version": number;
  "target_version": number;
};

export type RevisionSelection = {
  "from": number;
  "text": string;
  "textblock_path": Array<number>;
  "to": number;
};

export type RevisionSummary = {
  "base_version": number;
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "id": string;
  "project_id": string;
  "result_version": (number) | (null);
  "revision": number;
  "status": "generating" | "ready" | "invalid" | "cancelled" | "applied" | "undone";
  "updated_at": string;
};

export type RevisionUndo = {
  "command_id": string;
  "expected_document_version": number;
};

export type SessionCreate = {
  "access_key": string;
};

export type SessionRead = {
  "expires_at": string;
  "profile": ProfileRead;
  "workspace_id": string;
};

export type SourceAnchor = {
  "editable"?: boolean;
  "editor_path"?: (Array<number>) | (null);
  "id": string;
  "kind": string;
  "line"?: (number) | (null);
  "original_text": string;
  "original_version_id": string;
  "part": string;
  "sha256": string;
  "xml_path"?: (string) | (null);
  "xml_sha256"?: (string) | (null);
};

export type TemplateItem = {
  "anchor_ids": Array<string>;
  "field": string;
  "id": string;
  "note": string;
  "scope": string;
  "state": "recognized" | "unknown" | "conflict";
  "unit"?: (string) | (null);
  "value": (string) | (number) | (number) | (boolean) | (null);
};

export interface ApiTypes {
  "AIConfigAvailability": AIConfigAvailability;
  "AIConfigCopy": AIConfigCopy;
  "AIConfigCreate": AIConfigCreate;
  "AIConfigJobReference": AIConfigJobReference;
  "AIConfigPage": AIConfigPage;
  "AIConfigRead": AIConfigRead;
  "AIConfigReference": AIConfigReference;
  "AIConfigReferences": AIConfigReferences;
  "AIConfigUpdate": AIConfigUpdate;
  "AIConfigVersionPage": AIConfigVersionPage;
  "AIConfigVersionRead": AIConfigVersionRead;
  "APIConfigContent": APIConfigContent;
  "AgentConfigContent": AgentConfigContent;
  "ConfigurationProbeConfiguration": ConfigurationProbeConfiguration;
  "ConfigurationProbeInput": ConfigurationProbeInput;
  "ConfigurationProbeResult": ConfigurationProbeResult;
  "ConfigurationProbeScope": ConfigurationProbeScope;
  "DiagnosticResult": DiagnosticResult;
  "DocumentContent-Input": DocumentContent_Input;
  "DocumentContent-Output": DocumentContent_Output;
  "DocumentImport": DocumentImport;
  "DocumentRead": DocumentRead;
  "DocumentSave": DocumentSave;
  "DocumentVersionPage": DocumentVersionPage;
  "DocumentVersionRead": DocumentVersionRead;
  "DocumentVersionSummary": DocumentVersionSummary;
  "EditorJsonValue-Input": EditorJsonValue_Input;
  "EditorJsonValue-Output": EditorJsonValue_Output;
  "ErrorDetail": ErrorDetail;
  "ErrorResponse": ErrorResponse;
  "FlowCreate": FlowCreate;
  "FlowPage": FlowPage;
  "FlowRead": FlowRead;
  "FlowStage": FlowStage;
  "FlowUpdate": FlowUpdate;
  "FlowVersionPage": FlowVersionPage;
  "FlowVersionRead": FlowVersionRead;
  "HealthResponse": HealthResponse;
  "InspectionConfiguration": InspectionConfiguration;
  "InspectionInput": InspectionInput;
  "InspectionResult": InspectionResult;
  "JobArtifactRead": JobArtifactRead;
  "JobAttemptRead": JobAttemptRead;
  "JobCreate": JobCreate;
  "JobDetail": JobDetail;
  "JobPage": JobPage;
  "JobRead": JobRead;
  "JsonObject": JsonObject;
  "MaterialOriginalCreate": MaterialOriginalCreate;
  "MaterialOriginalPage": MaterialOriginalPage;
  "MaterialOriginalRead": MaterialOriginalRead;
  "MaterialPage": MaterialPage;
  "MaterialParseConfiguration": MaterialParseConfiguration;
  "MaterialParseInput": MaterialParseInput;
  "MaterialParseRead": MaterialParseRead;
  "MaterialParseResult": MaterialParseResult;
  "MaterialParseSummary": MaterialParseSummary;
  "MaterialParseSummaryPage": MaterialParseSummaryPage;
  "MaterialRead": MaterialRead;
  "MaterialReparse": MaterialReparse;
  "MaterialUpdate": MaterialUpdate;
  "MaterialUpload": MaterialUpload;
  "MaterialUploadReceipt": MaterialUploadReceipt;
  "ModelConfigContent": ModelConfigContent;
  "ParsedMaterial": ParsedMaterial;
  "ParsedRequirement": ParsedRequirement;
  "ProfileRead": ProfileRead;
  "ProfileUpdate": ProfileUpdate;
  "ProjectCreate": ProjectCreate;
  "ProjectPage": ProjectPage;
  "ProjectRead": ProjectRead;
  "ProjectSourceBindingRead": ProjectSourceBindingRead;
  "ProjectSourceBindingUpdate": ProjectSourceBindingUpdate;
  "ProjectSourceBindingVersionPage": ProjectSourceBindingVersionPage;
  "ProjectSourceBindingVersionRead": ProjectSourceBindingVersionRead;
  "ProjectUpdate": ProjectUpdate;
  "PromptConfigContent": PromptConfigContent;
  "RevisionApply": RevisionApply;
  "RevisionCancel": RevisionCancel;
  "RevisionCheck": RevisionCheck;
  "RevisionCommandRead": RevisionCommandRead;
  "RevisionCreate": RevisionCreate;
  "RevisionDecide": RevisionDecide;
  "RevisionDecision": RevisionDecision;
  "RevisionPage": RevisionPage;
  "RevisionPatch": RevisionPatch;
  "RevisionProposal": RevisionProposal;
  "RevisionRead": RevisionRead;
  "RevisionRevert": RevisionRevert;
  "RevisionSelection": RevisionSelection;
  "RevisionSummary": RevisionSummary;
  "RevisionUndo": RevisionUndo;
  "SessionCreate": SessionCreate;
  "SessionRead": SessionRead;
  "SourceAnchor": SourceAnchor;
  "TemplateItem": TemplateItem;
}

export const apiSchemas = {
  "AIConfigAvailability": {
    "properties": {
      "credential_configured": {
        "title": "Credential Configured",
        "type": "boolean"
      },
      "provider": {
        "const": "deepseek",
        "default": "deepseek",
        "title": "Provider",
        "type": "string"
      }
    },
    "required": [
      "credential_configured"
    ],
    "title": "AIConfigAvailability",
    "type": "object"
  },
  "AIConfigCopy": {
    "additionalProperties": false,
    "properties": {
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "source_version": {
        "anyOf": [
          {
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Version"
      }
    },
    "required": [
      "name"
    ],
    "title": "AIConfigCopy",
    "type": "object"
  },
  "AIConfigCreate": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "discriminator": {
          "mapping": {
            "agent": "#/components/schemas/AgentConfigContent",
            "api": "#/components/schemas/APIConfigContent",
            "model": "#/components/schemas/ModelConfigContent",
            "prompt": "#/components/schemas/PromptConfigContent"
          },
          "propertyName": "kind"
        },
        "oneOf": [
          {
            "$ref": "#/components/schemas/APIConfigContent"
          },
          {
            "$ref": "#/components/schemas/ModelConfigContent"
          },
          {
            "$ref": "#/components/schemas/PromptConfigContent"
          },
          {
            "$ref": "#/components/schemas/AgentConfigContent"
          }
        ],
        "title": "Content"
      },
      "enabled": {
        "default": true,
        "title": "Enabled",
        "type": "boolean"
      },
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      }
    },
    "required": [
      "name",
      "content"
    ],
    "title": "AIConfigCreate",
    "type": "object"
  },
  "AIConfigJobReference": {
    "properties": {
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "title": "Kind",
        "type": "string"
      },
      "matched_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Matched Version Ids",
        "type": "array"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "status": {
        "title": "Status",
        "type": "string"
      }
    },
    "required": [
      "job_id",
      "project_id",
      "kind",
      "status",
      "matched_version_ids"
    ],
    "title": "AIConfigJobReference",
    "type": "object"
  },
  "AIConfigPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/AIConfigRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "AIConfigPage",
    "type": "object"
  },
  "AIConfigRead": {
    "properties": {
      "content": {
        "discriminator": {
          "mapping": {
            "agent": "#/components/schemas/AgentConfigContent",
            "api": "#/components/schemas/APIConfigContent",
            "model": "#/components/schemas/ModelConfigContent",
            "prompt": "#/components/schemas/PromptConfigContent"
          },
          "propertyName": "kind"
        },
        "oneOf": [
          {
            "$ref": "#/components/schemas/APIConfigContent"
          },
          {
            "$ref": "#/components/schemas/ModelConfigContent"
          },
          {
            "$ref": "#/components/schemas/PromptConfigContent"
          },
          {
            "$ref": "#/components/schemas/AgentConfigContent"
          }
        ],
        "title": "Content"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "current_version_id": {
        "format": "uuid",
        "title": "Current Version Id",
        "type": "string"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "api",
          "model",
          "prompt",
          "agent"
        ],
        "title": "Kind",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "kind",
      "name",
      "enabled",
      "version",
      "current_version_id",
      "content",
      "created_at",
      "updated_at"
    ],
    "title": "AIConfigRead",
    "type": "object"
  },
  "AIConfigReference": {
    "properties": {
      "config_id": {
        "format": "uuid",
        "title": "Config Id",
        "type": "string"
      },
      "current": {
        "title": "Current",
        "type": "boolean"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "kind": {
        "enum": [
          "api",
          "model",
          "prompt",
          "agent"
        ],
        "title": "Kind",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "referenced_version_id": {
        "format": "uuid",
        "title": "Referenced Version Id",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      },
      "version_id": {
        "format": "uuid",
        "title": "Version Id",
        "type": "string"
      }
    },
    "required": [
      "config_id",
      "version_id",
      "kind",
      "name",
      "version",
      "enabled",
      "current",
      "referenced_version_id"
    ],
    "title": "AIConfigReference",
    "type": "object"
  },
  "AIConfigReferences": {
    "properties": {
      "configs": {
        "items": {
          "$ref": "#/components/schemas/AIConfigReference"
        },
        "title": "Configs",
        "type": "array"
      },
      "configs_truncated": {
        "title": "Configs Truncated",
        "type": "boolean"
      },
      "jobs": {
        "items": {
          "$ref": "#/components/schemas/AIConfigJobReference"
        },
        "title": "Jobs",
        "type": "array"
      },
      "jobs_truncated": {
        "title": "Jobs Truncated",
        "type": "boolean"
      }
    },
    "required": [
      "configs",
      "jobs",
      "configs_truncated",
      "jobs_truncated"
    ],
    "title": "AIConfigReferences",
    "type": "object"
  },
  "AIConfigUpdate": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "agent": "#/components/schemas/AgentConfigContent",
                "api": "#/components/schemas/APIConfigContent",
                "model": "#/components/schemas/ModelConfigContent",
                "prompt": "#/components/schemas/PromptConfigContent"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/APIConfigContent"
              },
              {
                "$ref": "#/components/schemas/ModelConfigContent"
              },
              {
                "$ref": "#/components/schemas/PromptConfigContent"
              },
              {
                "$ref": "#/components/schemas/AgentConfigContent"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Content"
      },
      "enabled": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Enabled"
      },
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "name": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Name"
      }
    },
    "required": [
      "expected_version"
    ],
    "title": "AIConfigUpdate",
    "type": "object"
  },
  "AIConfigVersionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/AIConfigVersionRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "AIConfigVersionPage",
    "type": "object"
  },
  "AIConfigVersionRead": {
    "properties": {
      "config_id": {
        "format": "uuid",
        "title": "Config Id",
        "type": "string"
      },
      "content": {
        "discriminator": {
          "mapping": {
            "agent": "#/components/schemas/AgentConfigContent",
            "api": "#/components/schemas/APIConfigContent",
            "model": "#/components/schemas/ModelConfigContent",
            "prompt": "#/components/schemas/PromptConfigContent"
          },
          "propertyName": "kind"
        },
        "oneOf": [
          {
            "$ref": "#/components/schemas/APIConfigContent"
          },
          {
            "$ref": "#/components/schemas/ModelConfigContent"
          },
          {
            "$ref": "#/components/schemas/PromptConfigContent"
          },
          {
            "$ref": "#/components/schemas/AgentConfigContent"
          }
        ],
        "title": "Content"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "config_id",
      "version",
      "name",
      "content",
      "created_at"
    ],
    "title": "AIConfigVersionRead",
    "type": "object"
  },
  "APIConfigContent": {
    "additionalProperties": false,
    "properties": {
      "base_url": {
        "const": "https://api.deepseek.com",
        "default": "https://api.deepseek.com",
        "title": "Base Url",
        "type": "string"
      },
      "credential_ref": {
        "const": "deepseek-default",
        "default": "deepseek-default",
        "title": "Credential Ref",
        "type": "string"
      },
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "kind": {
        "const": "api",
        "title": "Kind",
        "type": "string"
      },
      "max_retries": {
        "default": 2,
        "maximum": 3,
        "minimum": 0,
        "title": "Max Retries",
        "type": "integer"
      },
      "provider": {
        "const": "deepseek",
        "default": "deepseek",
        "title": "Provider",
        "type": "string"
      },
      "rate_limit_per_minute": {
        "default": 20,
        "maximum": 1000,
        "minimum": 1,
        "title": "Rate Limit Per Minute",
        "type": "integer"
      },
      "timeout_seconds": {
        "default": 30,
        "maximum": 300,
        "minimum": 1,
        "title": "Timeout Seconds",
        "type": "integer"
      }
    },
    "required": [
      "kind"
    ],
    "title": "APIConfigContent",
    "type": "object"
  },
  "AgentConfigContent": {
    "additionalProperties": false,
    "properties": {
      "allowed_tools": {
        "items": {
          "enum": [
            "read_context",
            "return_suggestion"
          ],
          "type": "string"
        },
        "maxItems": 2,
        "minItems": 1,
        "title": "Allowed Tools",
        "type": "array"
      },
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "input_schema": {
        "maxProperties": 50,
        "patternProperties": {
          "^[A-Za-z_][A-Za-z0-9_]{0,79}$": {
            "enum": [
              "string",
              "number",
              "boolean",
              "array",
              "object"
            ],
            "type": "string"
          }
        },
        "title": "Input Schema",
        "type": "object"
      },
      "instructions": {
        "maxLength": 4000,
        "minLength": 1,
        "title": "Instructions",
        "type": "string"
      },
      "kind": {
        "const": "agent",
        "title": "Kind",
        "type": "string"
      },
      "model_version_id": {
        "format": "uuid",
        "title": "Model Version Id",
        "type": "string"
      },
      "output_schema": {
        "maxProperties": 50,
        "patternProperties": {
          "^[A-Za-z_][A-Za-z0-9_]{0,79}$": {
            "enum": [
              "string",
              "number",
              "boolean",
              "array",
              "object"
            ],
            "type": "string"
          }
        },
        "title": "Output Schema",
        "type": "object"
      },
      "prompt_version_id": {
        "format": "uuid",
        "title": "Prompt Version Id",
        "type": "string"
      },
      "role": {
        "enum": [
          "general",
          "literature",
          "content",
          "format",
          "progress",
          "review"
        ],
        "title": "Role",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "role",
      "instructions",
      "model_version_id",
      "prompt_version_id"
    ],
    "title": "AgentConfigContent",
    "type": "object"
  },
  "ConfigurationProbeConfiguration": {
    "additionalProperties": false,
    "properties": {
      "agent": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/AgentConfigContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "api": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/APIConfigContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "config_kind": {
        "enum": [
          "api",
          "model",
          "prompt",
          "agent"
        ],
        "title": "Config Kind",
        "type": "string"
      },
      "config_version_id": {
        "format": "uuid",
        "title": "Config Version Id",
        "type": "string"
      },
      "model": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/ModelConfigContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "prompt": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/PromptConfigContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "propertyNames": {
          "enum": [
            "api",
            "model",
            "prompt",
            "agent"
          ]
        },
        "title": "Version Ids",
        "type": "object"
      }
    },
    "required": [
      "config_version_id",
      "version_ids",
      "config_kind"
    ],
    "title": "ConfigurationProbeConfiguration",
    "type": "object"
  },
  "ConfigurationProbeInput": {
    "additionalProperties": false,
    "properties": {
      "config_version_id": {
        "format": "uuid",
        "title": "Config Version Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "variables": {
        "maxProperties": 50,
        "patternProperties": {
          "^[A-Za-z_][A-Za-z0-9_]{0,79}$": {
            "maxLength": 10000,
            "type": "string"
          }
        },
        "title": "Variables",
        "type": "object"
      }
    },
    "required": [
      "config_version_id"
    ],
    "title": "ConfigurationProbeInput",
    "type": "object"
  },
  "ConfigurationProbeResult": {
    "additionalProperties": false,
    "properties": {
      "config_kind": {
        "enum": [
          "api",
          "model",
          "prompt",
          "agent"
        ],
        "title": "Config Kind",
        "type": "string"
      },
      "config_version_id": {
        "format": "uuid",
        "title": "Config Version Id",
        "type": "string"
      },
      "content": {
        "maxLength": 50000,
        "minLength": 1,
        "title": "Content",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "configuration_probe",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "title": "Model Used",
        "type": "boolean"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requested_model": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Requested Model"
      },
      "response_model": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Response Model"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "maxProperties": 4,
        "minProperties": 1,
        "propertyNames": {
          "enum": [
            "api",
            "model",
            "prompt",
            "agent"
          ]
        },
        "title": "Version Ids",
        "type": "object"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "kind",
      "schema_version",
      "job_id",
      "project_id",
      "config_version_id",
      "config_kind",
      "version_ids",
      "model_used",
      "requested_model",
      "response_model",
      "content",
      "writes_performed"
    ],
    "title": "ConfigurationProbeResult",
    "type": "object"
  },
  "ConfigurationProbeScope": {
    "additionalProperties": false,
    "properties": {
      "config_version_id": {
        "format": "uuid",
        "title": "Config Version Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "propertyNames": {
          "enum": [
            "api",
            "model",
            "prompt",
            "agent"
          ]
        },
        "title": "Version Ids",
        "type": "object"
      }
    },
    "required": [
      "config_version_id",
      "version_ids"
    ],
    "title": "ConfigurationProbeScope",
    "type": "object"
  },
  "DiagnosticResult": {
    "additionalProperties": false,
    "properties": {
      "checked": {
        "const": true,
        "title": "Checked",
        "type": "boolean"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "diagnostic",
        "title": "Kind",
        "type": "string"
      },
      "message": {
        "pattern": "\\S",
        "title": "Message",
        "type": "string"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "kind",
      "job_id",
      "project_id",
      "checked",
      "model_used",
      "writes_performed",
      "message"
    ],
    "title": "DiagnosticResult",
    "type": "object"
  },
  "DocumentContent-Input": {
    "additionalProperties": false,
    "properties": {
      "json": {
        "additionalProperties": {
          "$ref": "#/components/schemas/EditorJsonValue-Input"
        },
        "title": "Json",
        "type": "object"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "schema_version",
      "json"
    ],
    "title": "DocumentContent",
    "type": "object"
  },
  "DocumentContent-Output": {
    "additionalProperties": false,
    "properties": {
      "json": {
        "additionalProperties": {
          "$ref": "#/components/schemas/EditorJsonValue-Output"
        },
        "title": "Json",
        "type": "object"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "schema_version",
      "json"
    ],
    "title": "DocumentContent",
    "type": "object"
  },
  "DocumentImport": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "$ref": "#/components/schemas/DocumentContent-Input"
      }
    },
    "required": [
      "content"
    ],
    "title": "DocumentImport",
    "type": "object"
  },
  "DocumentRead": {
    "properties": {
      "content": {
        "$ref": "#/components/schemas/DocumentContent-Output"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "project_id",
      "version",
      "content",
      "created_at",
      "updated_at"
    ],
    "title": "DocumentRead",
    "type": "object"
  },
  "DocumentSave": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "$ref": "#/components/schemas/DocumentContent-Input"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "content",
      "expected_version"
    ],
    "title": "DocumentSave",
    "type": "object"
  },
  "DocumentVersionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/DocumentVersionSummary"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "DocumentVersionPage",
    "type": "object"
  },
  "DocumentVersionRead": {
    "properties": {
      "content": {
        "$ref": "#/components/schemas/DocumentContent-Output"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "source": {
        "enum": [
          "local_import",
          "manual_edit",
          "ai_adoption",
          "adoption_undo",
          "version_revert",
          "blank"
        ],
        "title": "Source",
        "type": "string"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "document_id",
      "project_id",
      "version",
      "source",
      "created_at",
      "content"
    ],
    "title": "DocumentVersionRead",
    "type": "object"
  },
  "DocumentVersionSummary": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "source": {
        "enum": [
          "local_import",
          "manual_edit",
          "ai_adoption",
          "adoption_undo",
          "version_revert",
          "blank"
        ],
        "title": "Source",
        "type": "string"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "document_id",
      "project_id",
      "version",
      "source",
      "created_at"
    ],
    "title": "DocumentVersionSummary",
    "type": "object"
  },
  "EditorJsonValue-Input": {
    "anyOf": [
      {
        "additionalProperties": {
          "$ref": "#/components/schemas/EditorJsonValue-Input"
        },
        "type": "object"
      },
      {
        "items": {
          "$ref": "#/components/schemas/EditorJsonValue-Input"
        },
        "type": "array"
      },
      {
        "type": "string"
      },
      {
        "type": "boolean"
      },
      {
        "type": "integer"
      },
      {
        "type": "number"
      },
      {
        "type": "null"
      }
    ]
  },
  "EditorJsonValue-Output": {
    "anyOf": [
      {
        "additionalProperties": {
          "$ref": "#/components/schemas/EditorJsonValue-Output"
        },
        "type": "object"
      },
      {
        "items": {
          "$ref": "#/components/schemas/EditorJsonValue-Output"
        },
        "type": "array"
      },
      {
        "type": "string"
      },
      {
        "type": "boolean"
      },
      {
        "type": "integer"
      },
      {
        "type": "number"
      },
      {
        "type": "null"
      }
    ]
  },
  "ErrorDetail": {
    "properties": {
      "code": {
        "title": "Code",
        "type": "string"
      },
      "message": {
        "title": "Message",
        "type": "string"
      },
      "request_id": {
        "title": "Request Id",
        "type": "string"
      }
    },
    "required": [
      "code",
      "message",
      "request_id"
    ],
    "title": "ErrorDetail",
    "type": "object"
  },
  "ErrorResponse": {
    "properties": {
      "error": {
        "$ref": "#/components/schemas/ErrorDetail"
      }
    },
    "required": [
      "error"
    ],
    "title": "ErrorResponse",
    "type": "object"
  },
  "FlowCreate": {
    "additionalProperties": false,
    "properties": {
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "stages": {
        "items": {
          "$ref": "#/components/schemas/FlowStage"
        },
        "maxItems": 50,
        "minItems": 1,
        "title": "Stages",
        "type": "array"
      }
    },
    "required": [
      "name",
      "stages"
    ],
    "title": "FlowCreate",
    "type": "object"
  },
  "FlowPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FlowRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "FlowPage",
    "type": "object"
  },
  "FlowRead": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "current_version_id": {
        "format": "uuid",
        "title": "Current Version Id",
        "type": "string"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "stages": {
        "items": {
          "$ref": "#/components/schemas/FlowStage"
        },
        "title": "Stages",
        "type": "array"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "name",
      "version",
      "enabled",
      "current_version_id",
      "stages",
      "created_at",
      "updated_at"
    ],
    "title": "FlowRead",
    "type": "object"
  },
  "FlowStage": {
    "additionalProperties": false,
    "properties": {
      "conditions": {
        "items": {
          "maxLength": 4000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "title": "Conditions",
        "type": "array"
      },
      "deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Deadline"
      },
      "deliverables": {
        "items": {
          "maxLength": 4000,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "title": "Deliverables",
        "type": "array"
      },
      "dependencies": {
        "items": {
          "maxLength": 80,
          "minLength": 1,
          "pattern": "^[A-Za-z0-9_-]+$",
          "type": "string"
        },
        "maxItems": 50,
        "title": "Dependencies",
        "type": "array"
      },
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "enabled": {
        "default": true,
        "title": "Enabled",
        "type": "boolean"
      },
      "id": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_-]+$",
        "title": "Id",
        "type": "string"
      },
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "start": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      }
    },
    "required": [
      "id",
      "name",
      "deliverables",
      "conditions"
    ],
    "title": "FlowStage",
    "type": "object"
  },
  "FlowUpdate": {
    "additionalProperties": false,
    "properties": {
      "enabled": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Enabled"
      },
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "name": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Name"
      },
      "stages": {
        "anyOf": [
          {
            "items": {
              "$ref": "#/components/schemas/FlowStage"
            },
            "maxItems": 50,
            "minItems": 1,
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Stages"
      }
    },
    "required": [
      "expected_version"
    ],
    "title": "FlowUpdate",
    "type": "object"
  },
  "FlowVersionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FlowVersionRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "FlowVersionPage",
    "type": "object"
  },
  "FlowVersionRead": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "flow_id": {
        "format": "uuid",
        "title": "Flow Id",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "stages": {
        "items": {
          "$ref": "#/components/schemas/FlowStage"
        },
        "title": "Stages",
        "type": "array"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "flow_id",
      "version",
      "name",
      "stages",
      "created_at"
    ],
    "title": "FlowVersionRead",
    "type": "object"
  },
  "HealthResponse": {
    "properties": {
      "status": {
        "title": "Status",
        "type": "string"
      }
    },
    "required": [
      "status"
    ],
    "title": "HealthResponse",
    "type": "object"
  },
  "InspectionConfiguration": {
    "additionalProperties": false,
    "properties": {
      "include_text_statistics": {
        "default": true,
        "title": "Include Text Statistics",
        "type": "boolean"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "title": "InspectionConfiguration",
    "type": "object"
  },
  "InspectionInput": {
    "additionalProperties": false,
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "document_id",
      "document_version"
    ],
    "title": "InspectionInput",
    "type": "object"
  },
  "InspectionResult": {
    "additionalProperties": false,
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "heading_count": {
        "maximum": 100000,
        "minimum": 0,
        "title": "Heading Count",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "document_inspection",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "node_count": {
        "maximum": 100000,
        "minimum": 1,
        "title": "Node Count",
        "type": "integer"
      },
      "paragraph_count": {
        "maximum": 100000,
        "minimum": 0,
        "title": "Paragraph Count",
        "type": "integer"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "table_count": {
        "maximum": 100000,
        "minimum": 0,
        "title": "Table Count",
        "type": "integer"
      },
      "text_characters": {
        "anyOf": [
          {
            "maximum": 16777216,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Text Characters"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "kind",
      "schema_version",
      "job_id",
      "project_id",
      "document_id",
      "document_version",
      "node_count",
      "paragraph_count",
      "heading_count",
      "table_count",
      "text_characters",
      "model_used",
      "writes_performed"
    ],
    "title": "InspectionResult",
    "type": "object"
  },
  "JobArtifactRead": {
    "properties": {
      "attempt_id": {
        "format": "uuid",
        "title": "Attempt Id",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "document_inspection",
          "configuration_probe",
          "material_parse"
        ],
        "title": "Kind",
        "type": "string"
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionResult"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeResult"
          },
          {
            "$ref": "#/components/schemas/MaterialParseResult"
          }
        ],
        "title": "Result"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "job_id",
      "attempt_id",
      "kind",
      "schema_version",
      "created_at",
      "result"
    ],
    "title": "JobArtifactRead",
    "type": "object"
  },
  "JobAttemptRead": {
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "error_code": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Error Code"
      },
      "finished_at": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Finished At"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "started_at": {
        "format": "date-time",
        "title": "Started At",
        "type": "string"
      },
      "status": {
        "enum": [
          "running",
          "succeeded",
          "failed",
          "cancelled",
          "lease_expired"
        ],
        "title": "Status",
        "type": "string"
      }
    },
    "required": [
      "id",
      "attempt",
      "status",
      "error_code",
      "started_at",
      "finished_at"
    ],
    "title": "JobAttemptRead",
    "type": "object"
  },
  "JobCreate": {
    "additionalProperties": false,
    "properties": {
      "configuration": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionConfiguration"
          },
          {
            "type": "null"
          }
        ]
      },
      "input_snapshot": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionInput"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeInput"
          },
          {
            "$ref": "#/components/schemas/MaterialParseInput"
          },
          {
            "type": "null"
          }
        ],
        "title": "Input Snapshot"
      },
      "kind": {
        "default": "diagnostic",
        "enum": [
          "diagnostic",
          "document_inspection",
          "configuration_probe",
          "material_parse"
        ],
        "title": "Kind",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      }
    },
    "required": [
      "project_id"
    ],
    "title": "JobCreate",
    "type": "object"
  },
  "JobDetail": {
    "properties": {
      "artifacts": {
        "items": {
          "$ref": "#/components/schemas/JobArtifactRead"
        },
        "title": "Artifacts",
        "type": "array"
      },
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "attempts": {
        "items": {
          "$ref": "#/components/schemas/JobAttemptRead"
        },
        "title": "Attempts",
        "type": "array"
      },
      "configuration": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionConfiguration"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeConfiguration"
          },
          {
            "$ref": "#/components/schemas/MaterialParseConfiguration"
          },
          {
            "type": "null"
          }
        ],
        "title": "Configuration"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "error_code": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Error Code"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "input_snapshot": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionInput"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeInput"
          },
          {
            "$ref": "#/components/schemas/MaterialParseInput"
          },
          {
            "type": "null"
          }
        ],
        "title": "Input Snapshot"
      },
      "kind": {
        "enum": [
          "diagnostic",
          "document_inspection",
          "configuration_probe",
          "material_parse"
        ],
        "title": "Kind",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "resource_scope": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionInput"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeScope"
          },
          {
            "$ref": "#/components/schemas/MaterialParseInput"
          },
          {
            "type": "null"
          }
        ],
        "title": "Resource Scope"
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DiagnosticResult"
          },
          {
            "$ref": "#/components/schemas/InspectionResult"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeResult"
          },
          {
            "$ref": "#/components/schemas/MaterialParseResult"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result"
      },
      "source_job_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Job Id"
      },
      "status": {
        "enum": [
          "queued",
          "running",
          "succeeded",
          "failed",
          "cancelled"
        ],
        "title": "Status",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "kind",
      "status",
      "attempt",
      "result",
      "error_code",
      "created_at",
      "updated_at",
      "attempts",
      "artifacts"
    ],
    "title": "JobDetail",
    "type": "object"
  },
  "JobPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/JobRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "JobPage",
    "type": "object"
  },
  "JobRead": {
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "configuration": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionConfiguration"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeConfiguration"
          },
          {
            "$ref": "#/components/schemas/MaterialParseConfiguration"
          },
          {
            "type": "null"
          }
        ],
        "title": "Configuration"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "error_code": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Error Code"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "input_snapshot": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionInput"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeInput"
          },
          {
            "$ref": "#/components/schemas/MaterialParseInput"
          },
          {
            "type": "null"
          }
        ],
        "title": "Input Snapshot"
      },
      "kind": {
        "enum": [
          "diagnostic",
          "document_inspection",
          "configuration_probe",
          "material_parse"
        ],
        "title": "Kind",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "resource_scope": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/InspectionInput"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeScope"
          },
          {
            "$ref": "#/components/schemas/MaterialParseInput"
          },
          {
            "type": "null"
          }
        ],
        "title": "Resource Scope"
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DiagnosticResult"
          },
          {
            "$ref": "#/components/schemas/InspectionResult"
          },
          {
            "$ref": "#/components/schemas/ConfigurationProbeResult"
          },
          {
            "$ref": "#/components/schemas/MaterialParseResult"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result"
      },
      "source_job_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Job Id"
      },
      "status": {
        "enum": [
          "queued",
          "running",
          "succeeded",
          "failed",
          "cancelled"
        ],
        "title": "Status",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "kind",
      "status",
      "attempt",
      "result",
      "error_code",
      "created_at",
      "updated_at"
    ],
    "title": "JobRead",
    "type": "object"
  },
  "JsonObject": {
    "additionalProperties": {
      "$ref": "#/components/schemas/EditorJsonValue-Output"
    },
    "type": "object"
  },
  "MaterialOriginalCreate": {
    "additionalProperties": false,
    "properties": {
      "content_base64": {
        "maxLength": 11184812,
        "minLength": 4,
        "title": "Content Base64",
        "type": "string"
      },
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "file_type": {
        "enum": [
          "docx",
          "text",
          "pdf"
        ],
        "title": "File Type",
        "type": "string"
      },
      "filename": {
        "maxLength": 255,
        "minLength": 1,
        "title": "Filename",
        "type": "string"
      },
      "kind": {
        "enum": [
          "template",
          "requirements",
          "literature",
          "other"
        ],
        "title": "Kind",
        "type": "string"
      },
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "source_note": {
        "default": "",
        "maxLength": 4000,
        "title": "Source Note",
        "type": "string"
      }
    },
    "required": [
      "name",
      "filename",
      "file_type",
      "kind",
      "content_base64",
      "expected_version"
    ],
    "title": "MaterialOriginalCreate",
    "type": "object"
  },
  "MaterialOriginalPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/MaterialOriginalRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "MaterialOriginalPage",
    "type": "object"
  },
  "MaterialOriginalRead": {
    "properties": {
      "byte_size": {
        "title": "Byte Size",
        "type": "integer"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "file_type": {
        "enum": [
          "docx",
          "text",
          "pdf"
        ],
        "title": "File Type",
        "type": "string"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "initial_job_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Initial Job Id"
      },
      "latest_parse_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Latest Parse Id"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "sha256": {
        "title": "Sha256",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "material_id",
      "version",
      "filename",
      "file_type",
      "sha256",
      "byte_size",
      "latest_parse_id",
      "initial_job_id",
      "created_at"
    ],
    "title": "MaterialOriginalRead",
    "type": "object"
  },
  "MaterialPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/MaterialRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "MaterialPage",
    "type": "object"
  },
  "MaterialParseConfiguration": {
    "additionalProperties": false,
    "properties": {
      "file_type": {
        "enum": [
          "docx",
          "text",
          "pdf"
        ],
        "title": "File Type",
        "type": "string"
      },
      "parser_version": {
        "const": "thesispilot-material-1",
        "default": "thesispilot-material-1",
        "title": "Parser Version",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "file_type"
    ],
    "title": "MaterialParseConfiguration",
    "type": "object"
  },
  "MaterialParseInput": {
    "additionalProperties": false,
    "properties": {
      "expected_parse_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Expected Parse Id"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Original Sha256",
        "type": "string"
      },
      "original_version_id": {
        "format": "uuid",
        "title": "Original Version Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "material_id",
      "original_version_id",
      "original_sha256",
      "expected_parse_id"
    ],
    "title": "MaterialParseInput",
    "type": "object"
  },
  "MaterialParseRead": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "original_version_id": {
        "format": "uuid",
        "title": "Original Version Id",
        "type": "string"
      },
      "result": {
        "$ref": "#/components/schemas/ParsedMaterial"
      },
      "source_job_id": {
        "format": "uuid",
        "title": "Source Job Id",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "original_version_id",
      "version",
      "source_job_id",
      "created_at",
      "result"
    ],
    "title": "MaterialParseRead",
    "type": "object"
  },
  "MaterialParseResult": {
    "additionalProperties": false,
    "properties": {
      "anchor_count": {
        "maximum": 100000,
        "minimum": 0,
        "title": "Anchor Count",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "material_parse",
        "title": "Kind",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "original_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Original Sha256",
        "type": "string"
      },
      "original_version_id": {
        "format": "uuid",
        "title": "Original Version Id",
        "type": "string"
      },
      "parse_version_id": {
        "format": "uuid",
        "title": "Parse Version Id",
        "type": "string"
      },
      "parser_version": {
        "const": "thesispilot-material-1",
        "title": "Parser Version",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "text_characters": {
        "maximum": 67108864,
        "minimum": 0,
        "title": "Text Characters",
        "type": "integer"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "kind",
      "schema_version",
      "job_id",
      "project_id",
      "material_id",
      "original_version_id",
      "original_sha256",
      "parser_version",
      "parse_version_id",
      "anchor_count",
      "text_characters",
      "model_used",
      "writes_performed"
    ],
    "title": "MaterialParseResult",
    "type": "object"
  },
  "MaterialParseSummary": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "original_version_id": {
        "format": "uuid",
        "title": "Original Version Id",
        "type": "string"
      },
      "source_job_id": {
        "format": "uuid",
        "title": "Source Job Id",
        "type": "string"
      },
      "status": {
        "enum": [
          "complete",
          "partial"
        ],
        "title": "Status",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "original_version_id",
      "version",
      "status",
      "source_job_id",
      "created_at"
    ],
    "title": "MaterialParseSummary",
    "type": "object"
  },
  "MaterialParseSummaryPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/MaterialParseSummary"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "MaterialParseSummaryPage",
    "type": "object"
  },
  "MaterialRead": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "current_original_id": {
        "format": "uuid",
        "title": "Current Original Id",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "template",
          "requirements",
          "literature",
          "other"
        ],
        "title": "Kind",
        "type": "string"
      },
      "linked": {
        "title": "Linked",
        "type": "boolean"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "removed": {
        "title": "Removed",
        "type": "boolean"
      },
      "source_note": {
        "title": "Source Note",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "project_id",
      "name",
      "kind",
      "source_note",
      "version",
      "linked",
      "removed",
      "current_original_id",
      "created_at",
      "updated_at"
    ],
    "title": "MaterialRead",
    "type": "object"
  },
  "MaterialReparse": {
    "additionalProperties": false,
    "properties": {
      "expected_parse_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Expected Parse Id"
      }
    },
    "required": [
      "expected_parse_id"
    ],
    "title": "MaterialReparse",
    "type": "object"
  },
  "MaterialUpdate": {
    "additionalProperties": false,
    "properties": {
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "kind": {
        "anyOf": [
          {
            "enum": [
              "template",
              "requirements",
              "literature",
              "other"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Kind"
      },
      "linked": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Linked"
      },
      "name": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Name"
      },
      "removed": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Removed"
      },
      "source_note": {
        "anyOf": [
          {
            "maxLength": 4000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Note"
      }
    },
    "required": [
      "expected_version"
    ],
    "title": "MaterialUpdate",
    "type": "object"
  },
  "MaterialUpload": {
    "additionalProperties": false,
    "properties": {
      "content_base64": {
        "maxLength": 11184812,
        "minLength": 4,
        "title": "Content Base64",
        "type": "string"
      },
      "file_type": {
        "enum": [
          "docx",
          "text",
          "pdf"
        ],
        "title": "File Type",
        "type": "string"
      },
      "filename": {
        "maxLength": 255,
        "minLength": 1,
        "title": "Filename",
        "type": "string"
      },
      "kind": {
        "enum": [
          "template",
          "requirements",
          "literature",
          "other"
        ],
        "title": "Kind",
        "type": "string"
      },
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "source_note": {
        "default": "",
        "maxLength": 4000,
        "title": "Source Note",
        "type": "string"
      }
    },
    "required": [
      "name",
      "filename",
      "file_type",
      "kind",
      "content_base64"
    ],
    "title": "MaterialUpload",
    "type": "object"
  },
  "MaterialUploadReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "material": {
        "$ref": "#/components/schemas/MaterialRead"
      },
      "original": {
        "$ref": "#/components/schemas/MaterialOriginalRead"
      }
    },
    "required": [
      "material",
      "original",
      "job"
    ],
    "title": "MaterialUploadReceipt",
    "type": "object"
  },
  "ModelConfigContent": {
    "additionalProperties": false,
    "properties": {
      "api_version_id": {
        "format": "uuid",
        "title": "Api Version Id",
        "type": "string"
      },
      "capabilities": {
        "items": {
          "enum": [
            "text",
            "search",
            "format",
            "plan",
            "review"
          ],
          "type": "string"
        },
        "maxItems": 5,
        "minItems": 1,
        "title": "Capabilities",
        "type": "array"
      },
      "context_limit": {
        "default": 64000,
        "maximum": 1000000,
        "minimum": 256,
        "title": "Context Limit",
        "type": "integer"
      },
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "kind": {
        "const": "model",
        "title": "Kind",
        "type": "string"
      },
      "max_output_tokens": {
        "default": 2048,
        "maximum": 8192,
        "minimum": 1,
        "title": "Max Output Tokens",
        "type": "integer"
      },
      "model_code": {
        "enum": [
          "deepseek-flash",
          "deepseek-v4-pro"
        ],
        "title": "Model Code",
        "type": "string"
      },
      "temperature": {
        "default": 0.7,
        "maximum": 2,
        "minimum": 0,
        "title": "Temperature",
        "type": "number"
      }
    },
    "required": [
      "kind",
      "api_version_id",
      "model_code",
      "capabilities"
    ],
    "title": "ModelConfigContent",
    "type": "object"
  },
  "ParsedMaterial": {
    "additionalProperties": false,
    "properties": {
      "anchors": {
        "items": {
          "$ref": "#/components/schemas/SourceAnchor"
        },
        "maxItems": 20000,
        "title": "Anchors",
        "type": "array"
      },
      "diagnostics": {
        "items": {
          "type": "string"
        },
        "title": "Diagnostics",
        "type": "array"
      },
      "editor_json": {
        "anyOf": [
          {
            "additionalProperties": {
              "$ref": "#/components/schemas/EditorJsonValue-Output"
            },
            "type": "object"
          },
          {
            "type": "null"
          }
        ],
        "title": "Editor Json"
      },
      "parser_version": {
        "const": "thesispilot-material-1",
        "default": "thesispilot-material-1",
        "title": "Parser Version",
        "type": "string"
      },
      "plain_text": {
        "title": "Plain Text",
        "type": "string"
      },
      "requirements": {
        "items": {
          "$ref": "#/components/schemas/ParsedRequirement"
        },
        "maxItems": 20000,
        "title": "Requirements",
        "type": "array"
      },
      "roundtrip_manifest": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/JsonObject"
          },
          {
            "type": "null"
          }
        ]
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "status": {
        "enum": [
          "complete",
          "partial"
        ],
        "title": "Status",
        "type": "string"
      },
      "template_items": {
        "items": {
          "$ref": "#/components/schemas/TemplateItem"
        },
        "maxItems": 20000,
        "title": "Template Items",
        "type": "array"
      }
    },
    "required": [
      "status",
      "plain_text",
      "anchors",
      "editor_json",
      "roundtrip_manifest",
      "template_items",
      "requirements",
      "diagnostics"
    ],
    "title": "ParsedMaterial",
    "type": "object"
  },
  "ParsedRequirement": {
    "additionalProperties": false,
    "properties": {
      "anchor_ids": {
        "items": {
          "type": "string"
        },
        "title": "Anchor Ids",
        "type": "array"
      },
      "checkable": {
        "title": "Checkable",
        "type": "boolean"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "word_count",
          "reference_count",
          "semantic"
        ],
        "title": "Kind",
        "type": "string"
      },
      "original_text": {
        "title": "Original Text",
        "type": "string"
      },
      "parameters": {
        "additionalProperties": {
          "type": "integer"
        },
        "title": "Parameters",
        "type": "object"
      },
      "rule_type": {
        "enum": [
          "hard",
          "semantic"
        ],
        "title": "Rule Type",
        "type": "string"
      },
      "scope": {
        "title": "Scope",
        "type": "string"
      },
      "strictness": {
        "enum": [
          "required",
          "suggested",
          "unknown"
        ],
        "title": "Strictness",
        "type": "string"
      },
      "uncertainty": {
        "title": "Uncertainty",
        "type": "string"
      }
    },
    "required": [
      "id",
      "original_text",
      "anchor_ids",
      "scope",
      "rule_type",
      "kind",
      "strictness",
      "enabled",
      "checkable",
      "uncertainty"
    ],
    "title": "ParsedRequirement",
    "type": "object"
  },
  "ProfileRead": {
    "properties": {
      "display_name": {
        "title": "Display Name",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "notifications_enabled": {
        "title": "Notifications Enabled",
        "type": "boolean"
      },
      "quiet_end": {
        "title": "Quiet End",
        "type": "string"
      },
      "quiet_start": {
        "title": "Quiet Start",
        "type": "string"
      },
      "show_deferred": {
        "title": "Show Deferred",
        "type": "boolean"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "version",
      "display_name",
      "notifications_enabled",
      "quiet_start",
      "quiet_end",
      "show_deferred"
    ],
    "title": "ProfileRead",
    "type": "object"
  },
  "ProfileUpdate": {
    "additionalProperties": false,
    "properties": {
      "display_name": {
        "maxLength": 80,
        "minLength": 1,
        "title": "Display Name",
        "type": "string"
      },
      "expected_version": {
        "maximum": 2147483646,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "notifications_enabled": {
        "title": "Notifications Enabled",
        "type": "boolean"
      },
      "quiet_end": {
        "pattern": "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
        "title": "Quiet End",
        "type": "string"
      },
      "quiet_start": {
        "pattern": "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$",
        "title": "Quiet Start",
        "type": "string"
      },
      "show_deferred": {
        "title": "Show Deferred",
        "type": "boolean"
      }
    },
    "required": [
      "expected_version",
      "display_name",
      "notifications_enabled",
      "quiet_start",
      "quiet_end",
      "show_deferred"
    ],
    "title": "ProfileUpdate",
    "type": "object"
  },
  "ProjectCreate": {
    "additionalProperties": false,
    "properties": {
      "archived": {
        "default": false,
        "title": "Archived",
        "type": "boolean"
      },
      "deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Deadline"
      },
      "existing_artifacts": {
        "default": "",
        "maxLength": 10000,
        "title": "Existing Artifacts",
        "type": "string"
      },
      "flow_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Version Id"
      },
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "plan_note": {
        "default": "",
        "maxLength": 10000,
        "title": "Plan Note",
        "type": "string"
      },
      "planning_mode": {
        "default": "none",
        "enum": [
          "none",
          "personal"
        ],
        "title": "Planning Mode",
        "type": "string"
      },
      "stage_id": {
        "anyOf": [
          {
            "maxLength": 80,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9_-]+$",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Stage Id"
      },
      "title": {
        "default": "",
        "maxLength": 500,
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "name"
    ],
    "title": "ProjectCreate",
    "type": "object"
  },
  "ProjectPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/ProjectRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "ProjectPage",
    "type": "object"
  },
  "ProjectRead": {
    "properties": {
      "archived": {
        "title": "Archived",
        "type": "boolean"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Deadline"
      },
      "existing_artifacts": {
        "title": "Existing Artifacts",
        "type": "string"
      },
      "flow_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Version Id"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "plan_note": {
        "title": "Plan Note",
        "type": "string"
      },
      "planning_mode": {
        "enum": [
          "none",
          "personal"
        ],
        "title": "Planning Mode",
        "type": "string"
      },
      "stage_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Stage Id"
      },
      "title": {
        "title": "Title",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "name",
      "title",
      "deadline",
      "planning_mode",
      "plan_note",
      "existing_artifacts",
      "archived",
      "flow_version_id",
      "stage_id",
      "version",
      "created_at",
      "updated_at"
    ],
    "title": "ProjectRead",
    "type": "object"
  },
  "ProjectSourceBindingRead": {
    "properties": {
      "current_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Current Version Id"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requirement_parse_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Requirement Parse Version Ids",
        "type": "array"
      },
      "template_parse_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Template Parse Version Id"
      },
      "updated_at": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Updated At"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "project_id",
      "version",
      "current_version_id",
      "template_parse_version_id",
      "requirement_parse_version_ids",
      "updated_at"
    ],
    "title": "ProjectSourceBindingRead",
    "type": "object"
  },
  "ProjectSourceBindingUpdate": {
    "additionalProperties": false,
    "properties": {
      "expected_version": {
        "minimum": 0,
        "title": "Expected Version",
        "type": "integer"
      },
      "requirement_parse_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "maxItems": 50,
        "title": "Requirement Parse Version Ids",
        "type": "array"
      },
      "template_parse_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Template Parse Version Id"
      }
    },
    "required": [
      "expected_version",
      "template_parse_version_id",
      "requirement_parse_version_ids"
    ],
    "title": "ProjectSourceBindingUpdate",
    "type": "object"
  },
  "ProjectSourceBindingVersionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/ProjectSourceBindingVersionRead"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "ProjectSourceBindingVersionPage",
    "type": "object"
  },
  "ProjectSourceBindingVersionRead": {
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requirement_parse_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Requirement Parse Version Ids",
        "type": "array"
      },
      "template_parse_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Template Parse Version Id"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "project_id",
      "version",
      "template_parse_version_id",
      "requirement_parse_version_ids",
      "created_at"
    ],
    "title": "ProjectSourceBindingVersionRead",
    "type": "object"
  },
  "ProjectUpdate": {
    "additionalProperties": false,
    "properties": {
      "archived": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Archived"
      },
      "deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Deadline"
      },
      "existing_artifacts": {
        "anyOf": [
          {
            "maxLength": 10000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Existing Artifacts"
      },
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "flow_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Version Id"
      },
      "name": {
        "anyOf": [
          {
            "maxLength": 200,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Name"
      },
      "plan_note": {
        "anyOf": [
          {
            "maxLength": 10000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Plan Note"
      },
      "planning_mode": {
        "anyOf": [
          {
            "enum": [
              "none",
              "personal"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Planning Mode"
      },
      "stage_id": {
        "anyOf": [
          {
            "maxLength": 80,
            "minLength": 1,
            "pattern": "^[A-Za-z0-9_-]+$",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Stage Id"
      },
      "title": {
        "anyOf": [
          {
            "maxLength": 500,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Title"
      }
    },
    "required": [
      "expected_version"
    ],
    "title": "ProjectUpdate",
    "type": "object"
  },
  "PromptConfigContent": {
    "additionalProperties": false,
    "properties": {
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "input_schema": {
        "maxProperties": 50,
        "patternProperties": {
          "^[A-Za-z_][A-Za-z0-9_]{0,79}$": {
            "enum": [
              "string",
              "number",
              "boolean",
              "array",
              "object"
            ],
            "type": "string"
          }
        },
        "title": "Input Schema",
        "type": "object"
      },
      "kind": {
        "const": "prompt",
        "title": "Kind",
        "type": "string"
      },
      "output_schema": {
        "maxProperties": 50,
        "patternProperties": {
          "^[A-Za-z_][A-Za-z0-9_]{0,79}$": {
            "enum": [
              "string",
              "number",
              "boolean",
              "array",
              "object"
            ],
            "type": "string"
          }
        },
        "title": "Output Schema",
        "type": "object"
      },
      "template": {
        "maxLength": 20000,
        "minLength": 1,
        "title": "Template",
        "type": "string"
      },
      "variables": {
        "items": {
          "enum": [
            "context",
            "goal",
            "requirements",
            "materials"
          ],
          "type": "string"
        },
        "maxItems": 4,
        "title": "Variables",
        "type": "array"
      }
    },
    "required": [
      "kind",
      "template"
    ],
    "title": "PromptConfigContent",
    "type": "object"
  },
  "RevisionApply": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Document Version",
        "type": "integer"
      },
      "expected_revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Revision",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_revision",
      "expected_document_version"
    ],
    "title": "RevisionApply",
    "type": "object"
  },
  "RevisionCancel": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      }
    },
    "required": [
      "command_id"
    ],
    "title": "RevisionCancel",
    "type": "object"
  },
  "RevisionCheck": {
    "additionalProperties": false,
    "properties": {
      "detail": {
        "maxLength": 300,
        "title": "Detail",
        "type": "string"
      },
      "from": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "From"
      },
      "patch_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Patch Id"
      },
      "result": {
        "enum": [
          "pass",
          "fail",
          "unsupported"
        ],
        "title": "Result",
        "type": "string"
      },
      "rule": {
        "enum": [
          "version",
          "range",
          "number",
          "citation",
          "formula",
          "lock",
          "overlap",
          "structure"
        ],
        "title": "Rule",
        "type": "string"
      },
      "to": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "To"
      }
    },
    "required": [
      "rule",
      "result",
      "detail"
    ],
    "title": "RevisionCheck",
    "type": "object"
  },
  "RevisionCommandRead": {
    "additionalProperties": false,
    "properties": {
      "base_version": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Base Version"
      },
      "candidate_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Candidate Id"
      },
      "candidate_revision": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Candidate Revision"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "operation": {
        "enum": [
          "create",
          "proposal",
          "decide",
          "apply",
          "cancel",
          "undo",
          "revert"
        ],
        "title": "Operation",
        "type": "string"
      },
      "result_version": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Version"
      }
    },
    "required": [
      "command_id",
      "document_id",
      "candidate_id",
      "operation",
      "candidate_revision",
      "base_version",
      "result_version",
      "created_at"
    ],
    "title": "RevisionCommandRead",
    "type": "object"
  },
  "RevisionCreate": {
    "additionalProperties": false,
    "properties": {
      "base_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Base Version",
        "type": "integer"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "goal": {
        "maxLength": 2000,
        "minLength": 1,
        "title": "Goal",
        "type": "string"
      },
      "selection": {
        "$ref": "#/components/schemas/RevisionSelection"
      }
    },
    "required": [
      "command_id",
      "base_version",
      "selection",
      "goal"
    ],
    "title": "RevisionCreate",
    "type": "object"
  },
  "RevisionDecide": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "decisions": {
        "items": {
          "$ref": "#/components/schemas/RevisionDecision"
        },
        "maxItems": 100,
        "minItems": 1,
        "title": "Decisions",
        "type": "array"
      },
      "expected_revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Revision",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_revision",
      "decisions"
    ],
    "title": "RevisionDecide",
    "type": "object"
  },
  "RevisionDecision": {
    "additionalProperties": false,
    "properties": {
      "decision": {
        "enum": [
          "pending",
          "accepted",
          "rejected"
        ],
        "title": "Decision",
        "type": "string"
      },
      "patch_id": {
        "maxLength": 100,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_-]+$",
        "title": "Patch Id",
        "type": "string"
      }
    },
    "required": [
      "patch_id",
      "decision"
    ],
    "title": "RevisionDecision",
    "type": "object"
  },
  "RevisionPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/RevisionSummary"
        },
        "title": "Items",
        "type": "array"
      },
      "limit": {
        "maximum": 50,
        "minimum": 1,
        "title": "Limit",
        "type": "integer"
      },
      "offset": {
        "minimum": 0,
        "title": "Offset",
        "type": "integer"
      },
      "total": {
        "minimum": 0,
        "title": "Total",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset"
    ],
    "title": "RevisionPage",
    "type": "object"
  },
  "RevisionPatch": {
    "additionalProperties": false,
    "properties": {
      "after": {
        "maxLength": 262144,
        "title": "After",
        "type": "string"
      },
      "before": {
        "maxLength": 32768,
        "minLength": 1,
        "title": "Before",
        "type": "string"
      },
      "from": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "From",
        "type": "integer"
      },
      "id": {
        "maxLength": 100,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_-]+$",
        "title": "Id",
        "type": "string"
      },
      "to": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "To",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "from",
      "to",
      "before",
      "after"
    ],
    "title": "RevisionPatch",
    "type": "object"
  },
  "RevisionProposal": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "generation_token": {
        "format": "uuid",
        "title": "Generation Token",
        "type": "string"
      },
      "patches": {
        "items": {
          "$ref": "#/components/schemas/RevisionPatch"
        },
        "maxItems": 100,
        "minItems": 1,
        "title": "Patches",
        "type": "array"
      }
    },
    "required": [
      "command_id",
      "generation_token",
      "patches"
    ],
    "title": "RevisionProposal",
    "type": "object"
  },
  "RevisionRead": {
    "additionalProperties": false,
    "properties": {
      "applicable": {
        "title": "Applicable",
        "type": "boolean"
      },
      "application_command_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Application Command Id"
      },
      "base_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Base Version",
        "type": "integer"
      },
      "checks": {
        "items": {
          "$ref": "#/components/schemas/RevisionCheck"
        },
        "title": "Checks",
        "type": "array"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "decisions": {
        "items": {
          "$ref": "#/components/schemas/RevisionDecision"
        },
        "title": "Decisions",
        "type": "array"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "generation_token": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Generation Token"
      },
      "goal": {
        "title": "Goal",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "patches": {
        "items": {
          "$ref": "#/components/schemas/RevisionPatch"
        },
        "title": "Patches",
        "type": "array"
      },
      "policy_version": {
        "title": "Policy Version",
        "type": "string"
      },
      "producer": {
        "const": "deterministic_preview",
        "title": "Producer",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "result_version": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Version"
      },
      "revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Revision",
        "type": "integer"
      },
      "selection": {
        "$ref": "#/components/schemas/RevisionSelection"
      },
      "status": {
        "enum": [
          "generating",
          "ready",
          "invalid",
          "cancelled",
          "applied",
          "undone"
        ],
        "title": "Status",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "document_id",
      "base_version",
      "document_version",
      "revision",
      "status",
      "result_version",
      "created_at",
      "updated_at",
      "selection",
      "goal",
      "policy_version",
      "producer",
      "generation_token",
      "patches",
      "decisions",
      "checks",
      "applicable",
      "application_command_id"
    ],
    "title": "RevisionRead",
    "type": "object"
  },
  "RevisionRevert": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Document Version",
        "type": "integer"
      },
      "target_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Target Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_document_version",
      "target_version"
    ],
    "title": "RevisionRevert",
    "type": "object"
  },
  "RevisionSelection": {
    "additionalProperties": false,
    "properties": {
      "from": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "From",
        "type": "integer"
      },
      "text": {
        "maxLength": 32768,
        "minLength": 1,
        "title": "Text",
        "type": "string"
      },
      "textblock_path": {
        "items": {
          "maximum": 100000,
          "minimum": 0,
          "type": "integer"
        },
        "maxItems": 80,
        "minItems": 1,
        "title": "Textblock Path",
        "type": "array"
      },
      "to": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "To",
        "type": "integer"
      }
    },
    "required": [
      "textblock_path",
      "from",
      "to",
      "text"
    ],
    "title": "RevisionSelection",
    "type": "object"
  },
  "RevisionSummary": {
    "additionalProperties": false,
    "properties": {
      "base_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Base Version",
        "type": "integer"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "result_version": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Version"
      },
      "revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Revision",
        "type": "integer"
      },
      "status": {
        "enum": [
          "generating",
          "ready",
          "invalid",
          "cancelled",
          "applied",
          "undone"
        ],
        "title": "Status",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "document_id",
      "base_version",
      "document_version",
      "revision",
      "status",
      "result_version",
      "created_at",
      "updated_at"
    ],
    "title": "RevisionSummary",
    "type": "object"
  },
  "RevisionUndo": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Document Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_document_version"
    ],
    "title": "RevisionUndo",
    "type": "object"
  },
  "SessionCreate": {
    "additionalProperties": false,
    "properties": {
      "access_key": {
        "format": "password",
        "maxLength": 4096,
        "minLength": 1,
        "title": "Access Key",
        "type": "string",
        "writeOnly": true
      }
    },
    "required": [
      "access_key"
    ],
    "title": "SessionCreate",
    "type": "object"
  },
  "SessionRead": {
    "properties": {
      "expires_at": {
        "format": "date-time",
        "title": "Expires At",
        "type": "string"
      },
      "profile": {
        "$ref": "#/components/schemas/ProfileRead"
      },
      "workspace_id": {
        "format": "uuid",
        "title": "Workspace Id",
        "type": "string"
      }
    },
    "required": [
      "workspace_id",
      "expires_at",
      "profile"
    ],
    "title": "SessionRead",
    "type": "object"
  },
  "SourceAnchor": {
    "additionalProperties": false,
    "properties": {
      "editable": {
        "default": false,
        "title": "Editable",
        "type": "boolean"
      },
      "editor_path": {
        "anyOf": [
          {
            "items": {
              "type": "integer"
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Editor Path"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "title": "Kind",
        "type": "string"
      },
      "line": {
        "anyOf": [
          {
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Line"
      },
      "original_text": {
        "title": "Original Text",
        "type": "string"
      },
      "original_version_id": {
        "format": "uuid",
        "title": "Original Version Id",
        "type": "string"
      },
      "part": {
        "title": "Part",
        "type": "string"
      },
      "sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Sha256",
        "type": "string"
      },
      "xml_path": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Xml Path"
      },
      "xml_sha256": {
        "anyOf": [
          {
            "pattern": "^[0-9a-f]{64}$",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Xml Sha256"
      }
    },
    "required": [
      "id",
      "original_version_id",
      "kind",
      "part",
      "original_text",
      "sha256"
    ],
    "title": "SourceAnchor",
    "type": "object"
  },
  "TemplateItem": {
    "additionalProperties": false,
    "properties": {
      "anchor_ids": {
        "items": {
          "type": "string"
        },
        "title": "Anchor Ids",
        "type": "array"
      },
      "field": {
        "title": "Field",
        "type": "string"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "note": {
        "title": "Note",
        "type": "string"
      },
      "scope": {
        "title": "Scope",
        "type": "string"
      },
      "state": {
        "enum": [
          "recognized",
          "unknown",
          "conflict"
        ],
        "title": "State",
        "type": "string"
      },
      "unit": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Unit"
      },
      "value": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "integer"
          },
          {
            "type": "number"
          },
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Value"
      }
    },
    "required": [
      "id",
      "field",
      "scope",
      "value",
      "state",
      "anchor_ids",
      "note"
    ],
    "title": "TemplateItem",
    "type": "object"
  }
} as const;

export type SchemaName = keyof ApiTypes;
