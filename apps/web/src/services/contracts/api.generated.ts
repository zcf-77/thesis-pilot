// Generated from apps/api/openapi.json. Do not edit manually.
// Contract SHA-256: 283257d62c4282e4b426a283bd217301ec78587cf78a04f8de5da6e976a702aa
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

export type AssistantContentInput = {
  "agent_config_version_id": string;
  "document_id": string;
  "document_version": number;
  "goal": string;
  "literature_entries"?: Array<AssistantLiteratureRef>;
  "material_sources"?: Array<AssistantMaterialRef>;
  "selection": (RevisionSelection) | (RevisionNodeSelection);
  "source_binding_version_id": (string) | (null);
};

export type AssistantLiteratureRef = {
  "entry_id": string;
  "entry_version": number;
};

export type AssistantMaterialRef = {
  "anchor_ids": Array<string>;
  "material_id": string;
  "original_version_id": string;
  "parse_version_id": string;
};

export type AssistantMessagePage = {
  "items": Array<AssistantMessageRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type AssistantMessageRead = {
  "content": string;
  "created_at": string;
  "id": string;
  "role": "user" | "assistant";
  "run_id": (string) | (null);
  "seq": number;
  "session_id": string;
};

export type AssistantRunCommand = {
  "command_id": string;
};

export type AssistantRunContext = {
  "configuration_snapshot": JsonObject;
  "context_snapshot": JsonObject;
  "input": AssistantContentInput;
  "run_id": string;
};

export type AssistantRunCreate = {
  "command_id": string;
  "expected_session_version": number;
  "input": AssistantContentInput;
  "purpose"?: "content_revision";
};

export type AssistantRunPage = {
  "items": Array<AssistantRunRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type AssistantRunRead = {
  "candidate_id": (string) | (null);
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "error_code": (string) | (null);
  "id": string;
  "job_id": string;
  "project_id": string;
  "purpose": "content_revision";
  "result_message_id": (string) | (null);
  "session_id": string;
  "source_run_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "trigger_message_id": string;
  "updated_at": string;
};

export type AssistantRunReceipt = {
  "job": JobRead;
  "message": AssistantMessageRead;
  "run": AssistantRunRead;
  "session": AssistantSessionRead;
};

export type AssistantRunRetryReceipt = {
  "job": JobRead;
  "run": AssistantRunRead;
  "session": AssistantSessionRead;
};

export type AssistantSessionCreate = {
  "role"?: "content";
  "title": string;
};

export type AssistantSessionPage = {
  "items": Array<AssistantSessionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type AssistantSessionRead = {
  "archived": boolean;
  "created_at": string;
  "id": string;
  "project_id": string;
  "role": "content";
  "title": string;
  "updated_at": string;
  "version": number;
};

export type AssistantSessionUpdate = {
  "archived"?: (boolean) | (null);
  "expected_version": number;
  "title"?: (string) | (null);
};

export type BackupConfiguration = {
  "format"?: "thesispilot-backup/1";
  "schema_version"?: 1;
};

export type BackupFileRead = {
  "byte_size": number;
  "created_at": string;
  "filename": string;
  "id": string;
  "object_counts": { [key: string]: number };
  "package_sha256": string;
  "schema_head": string;
  "sha256": string;
};

export type BackupPage = {
  "items": Array<BackupRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type BackupRead = {
  "attempt": number;
  "created_at": string;
  "error_code": (string) | (null);
  "file": (BackupFileRead) | (null);
  "job_id": string;
  "project_id": string;
  "source_job_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type BoardRead = {
  "board_version": number;
  "task_ids": Array<string>;
};

export type ChangeRecordCreate = {
  "document_id": string;
  "format": "html" | "markdown";
  "from_version": number;
  "to_version"?: (number) | (null);
};

export type ChangeRecordInput = {
  "document_id": string;
  "format": "html" | "markdown";
  "from_version": number;
  "schema_version"?: 1;
  "to_version": number;
};

export type ChangeRecordResult = {
  "byte_size": number;
  "content_type": "text/html; charset=utf-8" | "text/plain; charset=utf-8" | "text/markdown; charset=utf-8" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/pdf";
  "document_id": string;
  "file_id": string;
  "filename": string;
  "format": "html" | "markdown";
  "from_version": number;
  "job_id": string;
  "kind": "change_record";
  "model_used": false;
  "project_id": string;
  "schema_version": 1;
  "sha256": string;
  "to_version": number;
  "version_count": number;
  "writes_performed": false;
};

export type ChapterCorrection = {
  "anchor_id": string;
  "kind": "heading" | "paragraph";
  "level"?: (number) | (null);
};

export type ChapterRef = {
  "chapter_id": string;
  "document_id": string;
  "version": number;
};

export type CitationApply = {
  "command_id": string;
  "expected_document_version": number;
  "expected_revision": number;
};

export type CitationCandidatePage = {
  "items": Array<CitationCandidateRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type CitationCandidateRead = {
  "applicable": boolean;
  "application_command_id": (string) | (null);
  "base_version": number;
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "entry": CitationEntrySummary;
  "entry_version": number;
  "id": string;
  "number": number;
  "placement": CitationPlacement;
  "policy_version": string;
  "preview": CitationPreview;
  "project_id": string;
  "result_version": (number) | (null);
  "revision": number;
  "stale": boolean;
  "status": "ready" | "applied" | "rejected" | "undone";
  "undoable": boolean;
  "updated_at": string;
};

export type CitationChange = {
  "after": string;
  "before"?: (string) | (null);
  "end"?: (number) | (null);
  "kind": "marker" | "marker_renumber" | "reference" | "reference_new" | "heading_new";
  "node": string;
  "start"?: (number) | (null);
};

export type CitationCreate = {
  "base_version": number;
  "command_id": string;
  "entry_id": string;
  "placement": CitationPlacement;
};

export type CitationEntrySummary = {
  "id": string;
  "removed": boolean;
  "title": string;
};

export type CitationHeadingPreview = {
  "new": boolean;
  "node": string;
};

export type CitationListRead = {
  "consistent": boolean;
  "document_id": string;
  "document_version": number;
  "items": Array<CitedEntryRead>;
  "references_heading": (string) | (null);
  "schema_version": 1 | 2;
};

export type CitationMarkerPreview = {
  "node": string;
  "offset": number;
  "text": string;
};

export type CitationMarkerRead = {
  "end": number;
  "node": string;
  "protection_id": string;
  "start": number;
};

export type CitationPlacement = {
  "node_id": string;
  "offset": number;
};

export type CitationPreview = {
  "changes": Array<CitationChange>;
  "entry_id": string;
  "heading": CitationHeadingPreview;
  "marker": CitationMarkerPreview;
  "number": number;
  "reference": CitationReferencePreview;
  "renumbered": Array<CitationRenumber>;
  "reused": boolean;
};

export type CitationReferencePreview = {
  "new": boolean;
  "node": string;
  "text": string;
};

export type CitationReject = {
  "command_id": string;
  "expected_revision": number;
};

export type CitationRenumber = {
  "after": number;
  "before": number;
  "entry_id": string;
};

export type CitationUndo = {
  "command_id": string;
  "expected_document_version": number;
};

export type CitedEntryRead = {
  "entry_id": string;
  "markers": Array<CitationMarkerRead>;
  "number": number;
  "reference_node": (string) | (null);
  "reference_text": (string) | (null);
  "removed": boolean;
  "title": string;
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

export type ContentRevisionInput = {
  "run_id": string;
  "schema_version"?: 1;
};

export type ContentRevisionResult = {
  "assistant_message_id": string;
  "candidate_id": string;
  "document_id": string;
  "document_version": number;
  "job_id": string;
  "kind": "content_revision";
  "model_used": true;
  "project_id": string;
  "requested_model": string;
  "response_model": string;
  "run_id": string;
  "schema_version": 1;
  "session_id": string;
  "writes_performed": false;
};

export type CurrentStageRead = {
  "confirmation_id": (string) | (null);
  "confirmed": boolean;
  "deliverables": Array<DeliverableFact>;
  "entered_at": (string) | (null);
  "next_stages": Array<StageOption>;
  "prerequisites": Array<StagePrerequisite>;
  "prerequisites_met": boolean;
  "stage": FlowStage;
};

export type DateRange = {
  "due_date": (string) | (null);
  "start_date": (string) | (null);
};

export type DeliverableFact = {
  "material_ids": Array<string>;
  "name": string;
  "status": "confirmed_task" | "material" | "none";
  "task_ids": Array<string>;
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

export type DocsAnchorPos = {
  "align"?: ("start" | "center" | "end") | (null);
  "from": "page" | "margin";
  "offset"?: number;
};

export type DocsAutoColor = {
  "kind": "auto";
};

export type DocsBookmarkInline = {
  "name": string;
  "type": "bookmark";
};

export type DocsBorder = {
  "color"?: ((DocsRgbColor) | (DocsThemeColorValue) | (DocsAutoColor)) | (null);
  "style": "none" | "single" | "double" | "dashed" | "dotted";
  "width"?: (number) | (null);
};

export type DocsBorders = {
  "bottom"?: (DocsBorder) | (null);
  "insideH"?: (DocsBorder) | (null);
  "insideV"?: (DocsBorder) | (null);
  "left"?: (DocsBorder) | (null);
  "right"?: (DocsBorder) | (null);
  "top"?: (DocsBorder) | (null);
};

export type DocsBreakInline = {
  "kind"?: "line" | "column";
  "type": "break";
};

export type DocsCellProps = {
  "borders"?: (DocsBorders) | (null);
  "shading"?: ((DocsRgbColor) | (DocsThemeColorValue) | (DocsAutoColor)) | (null);
  "valign"?: ("top" | "center" | "bottom") | (null);
  "width"?: (number) | (null);
};

export type DocsChapter = {
  "block": number;
  "end": number;
  "id": string;
  "level": number;
  "title": string;
  "words": number;
};

export type DocsCodeBlock = {
  "id": string;
  "lang"?: (string) | (null);
  "text": string;
  "type": "code_block";
};

export type DocsDocGrid = {
  "charSpace"?: (number) | (null);
  "kind": "lines" | "lines_and_chars" | "snap_to_chars";
  "linePitch": number;
};

export type DocsEmuWidth = {
  "kind": "emu";
  "value": number;
};

export type DocsFieldInline = {
  "kind": "page_number" | "num_pages" | "date" | "title" | "author";
  "type": "field";
};

export type DocsHeaderFooter = {
  "blocks"?: Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>;
  "evenPage"?: (Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>) | (null);
  "firstPage"?: (Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>) | (null);
};

export type DocsHeadingBlock = {
  "id": string;
  "inlines": Array<(DocsRunInline) | (DocsBreakInline) | (DocsTabInline) | (DocsImageInline) | (DocsFieldInline) | (DocsBookmarkInline)>;
  "level": number;
  "props"?: DocsParaProps;
  "type": "heading";
};

export type DocsImageAnchor = {
  "behindText"?: boolean;
  "x": DocsAnchorPos;
  "y": DocsAnchorPos;
};

export type DocsImageBlock = {
  "align"?: ("start" | "center" | "end" | "justify" | "distributed") | (null);
  "alt"?: (string) | (null);
  "caption"?: (Array<(DocsRunInline) | (DocsBreakInline) | (DocsTabInline) | (DocsImageInline) | (DocsFieldInline) | (DocsBookmarkInline)>) | (null);
  "height"?: (number) | (null);
  "id": string;
  "resource": string;
  "type": "image";
  "width"?: (number) | (null);
};

export type DocsImageInline = {
  "alt"?: (string) | (null);
  "anchor"?: (DocsImageAnchor) | (null);
  "height"?: (number) | (null);
  "resource": string;
  "title"?: (string) | (null);
  "type": "image";
  "width"?: (number) | (null);
};

export type DocsIndent = {
  "end"?: (number) | (null);
  "endChars"?: (number) | (null);
  "firstLine"?: (number) | (null);
  "firstLineChars"?: (number) | (null);
  "hanging"?: (number) | (null);
  "start"?: (number) | (null);
  "startChars"?: (number) | (null);
};

export type DocsInlineProps = {
  "bold"?: (boolean) | (null);
  "code"?: (boolean) | (null);
  "color"?: ((DocsRgbColor) | (DocsThemeColorValue) | (DocsAutoColor)) | (null);
  "font"?: ((DocsThemeFontRef) | (DocsNamedFontRef)) | (null);
  "fontEastAsia"?: ((DocsThemeFontRef) | (DocsNamedFontRef)) | (null);
  "highlight"?: ((DocsRgbColor) | (DocsThemeColorValue) | (DocsAutoColor)) | (null);
  "italic"?: (boolean) | (null);
  "lang"?: (string) | (null);
  "letterSpacing"?: (number) | (null);
  "link"?: (DocsLink) | (null);
  "size"?: (number) | (null);
  "strike"?: (boolean) | (null);
  "style"?: (string) | (null);
  "underline"?: ("none" | "single" | "double" | "dotted" | "dashed" | "wavy") | (null);
  "verticalAlign"?: ("baseline" | "superscript" | "subscript") | (null);
};

export type DocsLineAtLeast = {
  "kind": "at_least";
  "value": number;
};

export type DocsLineExact = {
  "kind": "exact";
  "value": number;
};

export type DocsLineMultiple = {
  "kind": "multiple";
  "value": number;
};

export type DocsLink = {
  "href": string;
  "title"?: (string) | (null);
};

export type DocsListBlock = {
  "id": string;
  "items": Array<DocsListItem>;
  "kind": "bullet" | "decimal" | "lower_alpha" | "upper_alpha" | "lower_roman" | "upper_roman" | "chinese_counting" | "chinese_paren" | "task" | "decimal_enclosed_circle";
  "numbering"?: (string) | (null);
  "start"?: (number) | (null);
  "type": "list";
};

export type DocsListItem = {
  "blocks": Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>;
  "checked"?: (boolean) | (null);
  "id": string;
};

export type DocsListLabel = {
  "level"?: number;
  "run"?: DocsInlineProps;
  "suffix"?: ("tab" | "space" | "nothing") | (null);
  "text"?: string;
};

export type DocsMargins = {
  "bottom": number;
  "footer"?: (number) | (null);
  "gutter"?: (number) | (null);
  "header"?: (number) | (null);
  "left": number;
  "right": number;
  "top": number;
};

export type DocsMeta = {
  "author"?: (string) | (null);
  "custom"?: { [key: string]: string };
  "date"?: (string) | (null);
  "keywords"?: Array<string>;
  "lang"?: (string) | (null);
  "subtitle"?: (string) | (null);
  "title"?: (string) | (null);
};

export type DocsModel = {
  "id": string;
  "kind": "docs";
  "meta"?: DocsMeta;
  "resources"?: Array<DocsResource>;
  "schemaVersion": 1;
  "sections": Array<DocsSection>;
  "theme": DocsThemeRef;
  "unsupported"?: Array<DocsUnsupported>;
};

export type DocsNamedFontRef = {
  "kind": "named";
  "value": string;
};

export type DocsPageBreakBlock = {
  "id": string;
  "type": "page_break";
};

export type DocsPageProps = {
  "columns"?: (number) | (null);
  "grid"?: (DocsDocGrid) | (null);
  "margins": DocsMargins;
  "orientation": "portrait" | "landscape";
  "size": DocsPageSize;
};

export type DocsPageSize = {
  "height": number;
  "width": number;
};

export type DocsParaProps = {
  "adjustRightInd"?: (boolean) | (null);
  "align"?: ("start" | "center" | "end" | "justify" | "distributed") | (null);
  "autoSpaceDe"?: (boolean) | (null);
  "autoSpaceDn"?: (boolean) | (null);
  "borders"?: (DocsBorders) | (null);
  "indent"?: DocsIndent;
  "keepLines"?: (boolean) | (null);
  "keepWithNext"?: (boolean) | (null);
  "kinsoku"?: (boolean) | (null);
  "listLabel"?: (DocsListLabel) | (null);
  "outlineLevel"?: (number) | (null);
  "overflowPunct"?: (boolean) | (null);
  "pageBreakBefore"?: (boolean) | (null);
  "run"?: DocsInlineProps;
  "shading"?: ((DocsRgbColor) | (DocsThemeColorValue) | (DocsAutoColor)) | (null);
  "snapToGrid"?: (boolean) | (null);
  "spacing"?: DocsSpacing;
  "style"?: (string) | (null);
  "tabs"?: Array<DocsTabStop>;
  "topLinePunct"?: (boolean) | (null);
  "widowControl"?: (boolean) | (null);
};

export type DocsParagraphBlock = {
  "id": string;
  "inlines": Array<(DocsRunInline) | (DocsBreakInline) | (DocsTabInline) | (DocsImageInline) | (DocsFieldInline) | (DocsBookmarkInline)>;
  "props"?: DocsParaProps;
  "type": "paragraph";
};

export type DocsPctWidth = {
  "kind": "pct";
  "value": number;
};

export type DocsProtection = {
  "anchor": DocsProtectionAnchor;
  "binding"?: (string) | (null);
  "id": string;
  "kind": "number" | "citation" | "formula" | "lock" | "object" | "source";
};

export type DocsProtectionAnchor = {
  "end"?: (number) | (null);
  "node": string;
  "start"?: (number) | (null);
};

export type DocsQuoteBlock = {
  "blocks": Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>;
  "id": string;
  "type": "quote";
};

export type DocsResource = {
  "data": DocsUriData;
  "heightPx"?: (number) | (null);
  "id": string;
  "mime": "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  "name"?: (string) | (null);
  "sha256"?: (string) | (null);
  "widthPx"?: (number) | (null);
};

export type DocsRgbColor = {
  "kind": "rgb";
  "value": string;
};

export type DocsRuleBlock = {
  "id": string;
  "type": "rule";
};

export type DocsRunInline = {
  "props"?: DocsInlineProps;
  "text": string;
  "type": "run";
};

export type DocsSection = {
  "blocks": Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>;
  "breakKind"?: ("next_page" | "continuous" | "even_page" | "odd_page") | (null);
  "footer"?: (DocsHeaderFooter) | (null);
  "header"?: (DocsHeaderFooter) | (null);
  "id": string;
  "page"?: (DocsPageProps) | (null);
  "pageNumberStart"?: (number) | (null);
};

export type DocsSpacing = {
  "after"?: (number) | (null);
  "before"?: (number) | (null);
  "line"?: ((DocsLineMultiple) | (DocsLineExact) | (DocsLineAtLeast)) | (null);
};

export type DocsTabInline = {
  "type": "tab";
};

export type DocsTabStop = {
  "kind": "start" | "center" | "end" | "decimal" | "clear";
  "leader"?: ("none" | "dot" | "hyphen" | "underscore") | (null);
  "pos": number;
};

export type DocsTableBlock = {
  "caption"?: (Array<(DocsRunInline) | (DocsBreakInline) | (DocsTabInline) | (DocsImageInline) | (DocsFieldInline) | (DocsBookmarkInline)>) | (null);
  "colWidths"?: Array<number>;
  "id": string;
  "props"?: DocsTableProps;
  "rows": Array<DocsTableRow>;
  "type": "table";
};

export type DocsTableCell = {
  "blocks": Array<(DocsParagraphBlock) | (DocsHeadingBlock) | (DocsListBlock) | (DocsTableBlock) | (DocsImageBlock) | (DocsCodeBlock) | (DocsQuoteBlock) | (DocsPageBreakBlock) | (DocsRuleBlock) | (DocsTocBlock)>;
  "colSpan"?: number;
  "id": string;
  "props"?: DocsCellProps;
  "rowSpan"?: number;
};

export type DocsTableContinuation = {
  "label": string;
  "props": DocsParaProps;
};

export type DocsTableProps = {
  "align"?: ("start" | "center" | "end" | "justify" | "distributed") | (null);
  "borders"?: (DocsBorders) | (null);
  "cellMargin"?: (number) | (null);
  "cellMarginVertical"?: (number) | (null);
  "continuation"?: (DocsTableContinuation) | (null);
  "headerRows"?: number;
  "layout"?: ("fixed" | "autofit") | (null);
  "style"?: (string) | (null);
  "width"?: ((DocsEmuWidth) | (DocsPctWidth)) | (null);
};

export type DocsTableRow = {
  "cantSplit"?: (boolean) | (null);
  "cells": Array<DocsTableCell>;
  "header"?: boolean;
  "height"?: (number) | (null);
  "id": string;
  "keepWithNext"?: (boolean) | (null);
};

export type DocsThemeColorValue = {
  "kind": "theme";
  "value": "dk1" | "lt1" | "dk2" | "lt2" | "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6" | "hlink" | "folHlink";
};

export type DocsThemeFontRef = {
  "kind": "theme";
  "value": "body" | "heading" | "mono";
};

export type DocsThemeRef = {
  "name": string;
};

export type DocsTocBlock = {
  "id": string;
  "levels"?: number;
  "title"?: (string) | (null);
  "type": "toc";
};

export type DocsUnsupported = {
  "detail"?: (string) | (null);
  "kind": string;
  "path": string;
};

export type DocsUriData = {
  "kind": "uri";
  "value": string;
};

export type DocumentContent_Input = {
  "json": { [key: string]: EditorJsonValue_Input };
  "schema_version": 1;
};

export type DocumentContent_Output = {
  "json": { [key: string]: EditorJsonValue_Output };
  "schema_version": 1;
};

export type DocumentContentV2 = {
  "json": {
  "chapters"?: (Array<DocsChapter>) | (null);
  "model": DocsModel;
  "protections"?: Array<DocsProtection>;
  "schemaVersion": 2;
};
  "schema_version": 2;
};

export type DocumentEvidence = {
  "document_id": string;
  "kind": "document";
  "selection": (RevisionSelection) | (RevisionNodeSelection);
  "version": number;
};

export type DocumentExportCreate = {
  "document_id": string;
  "document_version": number;
  "format": "html" | "txt" | "markdown" | "docx" | "pdf";
  "office_mode"?: ("preserve" | "regenerate") | (null);
  "track_changes"?: boolean;
};

export type DocumentExportInput = {
  "document_id": string;
  "document_version": number;
  "format": "html" | "txt" | "markdown" | "docx" | "pdf";
  "office_mode"?: ("preserve" | "regenerate") | (null);
  "schema_version"?: 1;
  "track_changes"?: boolean;
};

export type DocumentExportResult = {
  "byte_size": number;
  "content_type": "text/html; charset=utf-8" | "text/plain; charset=utf-8" | "text/markdown; charset=utf-8" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/pdf";
  "document_id": string;
  "document_version": number;
  "file_id": string;
  "filename": string;
  "format": "html" | "txt" | "markdown" | "docx" | "pdf";
  "job_id": string;
  "kind": "document_export";
  "model_used": false;
  "project_id": string;
  "report"?: (OfficeExportReport) | (null);
  "schema_version": 1;
  "sha256": string;
  "writes_performed": false;
};

export type DocumentImport = {
  "content": (DocumentContent_Input) | (DocumentContentV2);
};

export type DocumentOfficeSourceRead = {
  "document_id": string;
  "document_version": number;
  "filename": string;
  "import_id": string;
  "imported_at": string;
  "material_id": string;
  "original_id": string;
  "original_sha256": string;
};

export type DocumentPointer = {
  "document_id": string;
  "version": number;
};

export type DocumentRead = {
  "content": (DocumentContent_Output) | (DocumentContentV2);
  "created_at": string;
  "id": string;
  "project_id": string;
  "updated_at": string;
  "version": number;
};

export type DocumentResourceRead = {
  "byte_size": number;
  "created_at": string;
  "height_px": (number) | (null);
  "mime": "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  "sha256": string;
  "uri": string;
  "width_px": (number) | (null);
};

export type DocumentResourceUpload = {
  "content_base64": string;
  "mime": "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

export type DocumentSave = {
  "content": (DocumentContent_Input) | (DocumentContentV2);
  "expected_version": number;
};

export type DocumentSchemaUpgradeCreate = {
  "command_id": string;
  "expected_version": number;
};

export type DocumentSchemaUpgradeRead = {
  "document": DocumentRead;
  "replayed": boolean;
  "upgrade": DocumentSchemaUpgradeRecord;
};

export type DocumentSchemaUpgradeRecord = {
  "command_id": string;
  "converter_sha256": string;
  "converter_version": string;
  "created_at": string;
  "document_id": string;
  "from_schema_version": 1;
  "from_version": number;
  "id": string;
  "loss_report": Array<LossItem>;
  "to_schema_version": 2;
  "to_version": number;
};

export type DocumentSourceChapter = {
  "allowed_kinds": Array<"heading" | "paragraph">;
  "anchor_id": string;
  "editable": boolean;
  "editor_path": Array<number>;
  "kind": "heading" | "paragraph";
  "level": (number) | (null);
  "title": string;
};

export type DocumentSourceImport = {
  "chapter_corrections"?: Array<ChapterCorrection>;
  "command_id": string;
  "material_id": string;
  "original_version_id": string;
  "parse_version_id": string;
};

export type DocumentSourceImportReceipt = {
  "command_id": string;
  "document_id": string;
  "document_version"?: 1;
  "material_id": string;
  "original_version_id": string;
  "parse_version_id": string;
  "source_id": string;
};

export type DocumentSourcePreview = {
  "can_import": boolean;
  "chapters": Array<DocumentSourceChapter>;
  "chapters_truncated": boolean;
  "diagnostics": Array<string>;
  "existing_document_id": (string) | (null);
  "file_type": "docx" | "text";
  "filename": string;
  "manifest_sha256": string;
  "material_id": string;
  "original_sha256": string;
  "original_version_id": string;
  "parse_version_id": string;
  "parser_version": string;
  "project_id": string;
  "status": "complete" | "partial";
};

export type DocumentSourcePreviewRequest = {
  "material_id": string;
  "original_version_id": string;
  "parse_version_id": string;
};

export type DocumentSourceRead = {
  "document_id": string;
  "document_version": number;
  "file_type": "docx" | "text";
  "filename": string;
  "guard_contract": JsonObject;
  "guard_version": string;
  "imported_at": string;
  "manifest_sha256": string;
  "material_id": string;
  "original_sha256": string;
  "original_version_id": string;
  "parse_version_id": string;
  "source_id": string;
};

export type DocumentVersionPage = {
  "items": Array<DocumentVersionSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type DocumentVersionRead = {
  "content": (DocumentContent_Output) | (DocumentContentV2);
  "converted"?: boolean;
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert" | "blank" | "schema_upgrade" | "office_import";
  "version": number;
};

export type DocumentVersionSummary = {
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert" | "blank" | "schema_upgrade" | "office_import";
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

export type EvidenceCandidate = {
  "task_id": string;
  "title": string;
  "version": number;
};

export type EvidenceSnapshot = {
  "fingerprint": string;
  "label": string;
  "reference": (DocumentEvidence) | (MaterialEvidence);
  "stale"?: boolean;
};

export type EvidenceTaskRef = {
  "task_id": string;
  "version": number;
};

export type EvidenceTaskSnapshot = {
  "task_id": string;
  "title": string;
  "version": number;
};

export type ExportConfiguration = {
  "renderer_version"?: "thesispilot-export-1";
  "schema_version"?: 1;
  "source_sha256": string;
};

export type ExportFileRead = {
  "byte_size": number;
  "content_type": string;
  "created_at": string;
  "filename": string;
  "id": string;
  "sha256": string;
};

export type ExportPage = {
  "items": Array<ExportRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type ExportRead = {
  "attempt": number;
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "error_code": (string) | (null);
  "file": (ExportFileRead) | (null);
  "format": "html" | "txt" | "markdown" | "docx" | "pdf";
  "from_version": (number) | (null);
  "job_id": string;
  "kind": "document_export" | "change_record";
  "office_mode"?: ("preserve" | "regenerate") | (null);
  "project_id": string;
  "report"?: (OfficeExportReport) | (null);
  "source_job_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "track_changes"?: boolean;
  "updated_at": string;
};

export type FeedbackContent = {
  "certainty": "certain" | "uncertain";
  "correction"?: string;
  "evidence"?: Array<(DocumentEvidence) | (MaterialEvidence)>;
  "interpretation": string;
  "new_task"?: (TaskContent) | (null);
  "source_checked": boolean;
  "source_range": SourceRange;
  "task_id"?: (string) | (null);
};

export type FeedbackCreate = {
  "command_id": string;
  "expected_version"?: number;
  "original_text": string;
};

export type FeedbackDecision = {
  "action": "processed" | "reopen";
  "command_id": string;
  "expected_version": number;
  "reason"?: string;
};

export type FeedbackItemCreate = {
  "command_id": string;
  "content": FeedbackContent;
  "expected_version"?: number;
};

export type FeedbackItemPage = {
  "items": Array<FeedbackItemSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FeedbackItemRead = {
  "batch_id": string;
  "content": FeedbackContent;
  "created_at": string;
  "evidence_snapshots": Array<EvidenceSnapshot>;
  "id": string;
  "needs_review": boolean;
  "origin"?: "manual" | "ai_suggested";
  "project_id": string;
  "review_reasons": Array<string>;
  "status": "open" | "processed" | "withdrawn";
  "updated_at": string;
  "version": number;
};

export type FeedbackItemSummary = {
  "batch_id": string;
  "certainty": "certain" | "uncertain";
  "id": string;
  "needs_review": boolean;
  "origin"?: "manual" | "ai_suggested";
  "preview": string;
  "review_reasons": Array<string>;
  "status": "open" | "processed" | "withdrawn";
  "task_id": (string) | (null);
  "updated_at": string;
  "version": number;
};

export type FeedbackItemUpdate = {
  "command_id": string;
  "content": FeedbackContent;
  "expected_version": number;
};

export type FeedbackPage = {
  "items": Array<FeedbackSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FeedbackRead = {
  "created_at": string;
  "id": string;
  "item_count": number;
  "origin"?: "manual";
  "original_text": string;
  "preview": string;
  "project_id": string;
};

export type FeedbackSplitCreate = {
  "agent_config_version_id": string;
  "command_id": string;
};

export type FeedbackSplitDecide = {
  "command_id": string;
  "decisions": Array<SuggestionDecision>;
};

export type FeedbackSplitInput = {
  "schema_version"?: 1;
  "split_id": string;
};

export type FeedbackSplitPage = {
  "items": Array<FeedbackSplitRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FeedbackSplitRead = {
  "agent_config_version_id": string;
  "agent_name": string;
  "attempt": number;
  "batch_id": string;
  "config_version_ids": { [key: string]: string };
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "job_id": string;
  "note": string;
  "project_id": string;
  "requested_model": (string) | (null);
  "response_model": (string) | (null);
  "source_split_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "suggestions": Array<FeedbackSuggestionRead>;
  "updated_at": string;
};

export type FeedbackSplitReceipt = {
  "job": JobRead;
  "split": FeedbackSplitRead;
};

export type FeedbackSplitResult = {
  "batch_id": string;
  "job_id": string;
  "kind": "feedback_decomposition";
  "model_used": true;
  "note": string;
  "project_id": string;
  "requested_model": string;
  "response_model": string;
  "schema_version": 1;
  "split_id": string;
  "suggestion_count": number;
  "writes_performed": false;
};

export type FeedbackSplitRetry = {
  "command_id": string;
};

export type FeedbackSuggestionRead = {
  "ambiguous": boolean;
  "certainty": "certain" | "uncertain";
  "feedback_item_id": (string) | (null);
  "history": Array<SuggestionHistoryRead>;
  "id": string;
  "interpretation": string;
  "position": number;
  "source_range": SourceRange;
  "stale": boolean;
  "stale_reasons": Array<string>;
  "state": "pending" | "adopted" | "rejected";
  "task_title": (string) | (null);
  "version": number;
};

export type FeedbackSummary = {
  "created_at": string;
  "id": string;
  "item_count": number;
  "origin"?: "manual";
  "preview": string;
  "project_id": string;
};

export type FeedbackVersionPage = {
  "items": Array<FeedbackVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FeedbackVersionRead = {
  "action": string;
  "created_at": string;
  "reason": string;
  "snapshot": FeedbackItemRead;
  "version": number;
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

export type FormatApply = {
  "command_id": string;
  "expected_document_version": number;
  "expected_revision": number;
};

export type FormatCommandRead = {
  "base_version": number;
  "candidate_id": string;
  "candidate_revision": number;
  "command_id": string;
  "operation": "create" | "decide" | "apply" | "undo";
  "result_version": (number) | (null);
};

export type FormatContext = {
  "binding_version": number;
  "binding_version_id": string;
  "content_schema_version"?: 1 | 2;
  "document_version": number;
  "requirement_parse_version_ids": Array<string>;
  "rules": Array<FormatRule>;
  "source_guard_digest": string;
  "targets": Array<FormatTarget>;
  "template_parse_version_id": (string) | (null);
};

export type FormatCreate = {
  "base_version": number;
  "binding_version_id": string;
  "command_id": string;
  "selections": Array<FormatSelection>;
  "source_guard_digest": string;
};

export type FormatDecide = {
  "command_id": string;
  "decisions": Array<FormatDecision>;
  "expected_revision": number;
};

export type FormatDecision = {
  "decision": "accept" | "reject" | "pending";
  "patch_id": string;
};

export type FormatPage = {
  "items": Array<FormatRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type FormatPatch = {
  "after": (string) | (number);
  "anchor_id": string;
  "before": EditorJsonValue_Output;
  "editor_path"?: (Array<number>) | (null);
  "evidence": string;
  "field": "level" | "templateAlign" | "templateWeight" | "alignment";
  "id": string;
  "node_id"?: (string) | (null);
  "rule_id": string;
};

export type FormatRead = {
  "applicable": boolean;
  "application_command_id": (string) | (null);
  "base_version": number;
  "content_schema_version"?: 1 | 2;
  "created_at": string;
  "decisions": Array<FormatDecision>;
  "document_id": string;
  "document_version": number;
  "id": string;
  "patches": Array<FormatPatch>;
  "project_id": string;
  "revision": number;
  "status": "ready" | "applied" | "undone";
  "updated_at": string;
};

export type FormatRule = {
  "anchor_id": string;
  "evidence": string;
  "field": "level" | "templateAlign" | "templateWeight" | "alignment";
  "id": string;
  "parse_version_id": string;
  "scope": "heading" | "paragraph";
  "value": (string) | (number);
};

export type FormatSelection = {
  "rule_id": string;
  "target_anchor_ids": Array<string>;
};

export type FormatTarget = {
  "anchor_id": string;
  "attrs": (JsonObject) | (null);
  "editor_path"?: (Array<number>) | (null);
  "kind": "heading" | "paragraph";
  "node_id"?: (string) | (null);
  "title": string;
};

export type FormatUndo = {
  "command_id": string;
  "expected_document_version": number;
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
  "kind": "document_inspection" | "configuration_probe" | "material_parse" | "content_revision" | "document_export" | "change_record" | "review" | "literature_search" | "feedback_decomposition" | "plan_adjustment" | "project_backup" | "project_restore" | "office_import";
  "result": (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult) | (ContentRevisionResult) | (DocumentExportResult) | (ChangeRecordResult) | (ReviewResult) | (LiteratureSearchJobResult) | (FeedbackSplitResult) | (PlanAdjustmentResult) | (ProjectBackupResult) | (ProjectRestoreResult) | (OfficeImportResult);
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
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (ContentRevisionInput) | (DocumentExportInput) | (ChangeRecordInput) | (ReviewInput) | (LiteratureSearchInput) | (FeedbackSplitInput) | (PlanAdjustmentInput) | (ProjectBackupInput) | (ProjectRestoreInput) | (OfficeImportInput) | (null);
  "kind"?: "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse" | "content_revision" | "document_export" | "change_record" | "review" | "literature_search" | "feedback_decomposition" | "plan_adjustment" | "project_backup" | "project_restore" | "office_import";
  "project_id": string;
};

export type JobDetail = {
  "artifacts": Array<JobArtifactRead>;
  "attempt": number;
  "attempts": Array<JobAttemptRead>;
  "configuration"?: (InspectionConfiguration) | (ConfigurationProbeConfiguration) | (MaterialParseConfiguration) | (ExportConfiguration) | (BackupConfiguration) | (null);
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (ContentRevisionInput) | (DocumentExportInput) | (ChangeRecordInput) | (ReviewInput) | (LiteratureSearchInput) | (FeedbackSplitInput) | (PlanAdjustmentInput) | (ProjectBackupInput) | (ProjectRestoreInput) | (OfficeImportInput) | (null);
  "kind": "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse" | "content_revision" | "document_export" | "change_record" | "review" | "literature_search" | "feedback_decomposition" | "plan_adjustment" | "project_backup" | "project_restore" | "office_import";
  "project_id": string;
  "resource_scope"?: (InspectionInput) | (ConfigurationProbeScope) | (MaterialParseInput) | (ContentRevisionInput) | (DocumentExportInput) | (ChangeRecordInput) | (ReviewInput) | (LiteratureSearchInput) | (FeedbackSplitInput) | (PlanAdjustmentInput) | (ProjectBackupInput) | (ProjectRestoreInput) | (OfficeImportInput) | (null);
  "result": (DiagnosticResult) | (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult) | (ContentRevisionResult) | (DocumentExportResult) | (ChangeRecordResult) | (ReviewResult) | (LiteratureSearchJobResult) | (FeedbackSplitResult) | (PlanAdjustmentResult) | (ProjectBackupResult) | (ProjectRestoreResult) | (OfficeImportResult) | (null);
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
  "configuration"?: (InspectionConfiguration) | (ConfigurationProbeConfiguration) | (MaterialParseConfiguration) | (ExportConfiguration) | (BackupConfiguration) | (null);
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "input_snapshot"?: (InspectionInput) | (ConfigurationProbeInput) | (MaterialParseInput) | (ContentRevisionInput) | (DocumentExportInput) | (ChangeRecordInput) | (ReviewInput) | (LiteratureSearchInput) | (FeedbackSplitInput) | (PlanAdjustmentInput) | (ProjectBackupInput) | (ProjectRestoreInput) | (OfficeImportInput) | (null);
  "kind": "diagnostic" | "document_inspection" | "configuration_probe" | "material_parse" | "content_revision" | "document_export" | "change_record" | "review" | "literature_search" | "feedback_decomposition" | "plan_adjustment" | "project_backup" | "project_restore" | "office_import";
  "project_id": string;
  "resource_scope"?: (InspectionInput) | (ConfigurationProbeScope) | (MaterialParseInput) | (ContentRevisionInput) | (DocumentExportInput) | (ChangeRecordInput) | (ReviewInput) | (LiteratureSearchInput) | (FeedbackSplitInput) | (PlanAdjustmentInput) | (ProjectBackupInput) | (ProjectRestoreInput) | (OfficeImportInput) | (null);
  "result": (DiagnosticResult) | (InspectionResult) | (ConfigurationProbeResult) | (MaterialParseResult) | (ContentRevisionResult) | (DocumentExportResult) | (ChangeRecordResult) | (ReviewResult) | (LiteratureSearchJobResult) | (FeedbackSplitResult) | (PlanAdjustmentResult) | (ProjectBackupResult) | (ProjectRestoreResult) | (OfficeImportResult) | (null);
  "source_job_id"?: (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type JsonObject = { [key: string]: EditorJsonValue_Output };

export type LiteratureEntryCommand = {
  "command_id": string;
  "expected_version": number;
};

export type LiteratureEntryCreate = {
  "command_id": string;
  "result_index": number;
  "search_id": string;
};

export type LiteratureEntryPage = {
  "items": Array<LiteratureEntryRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type LiteratureEntryRead = {
  "created_at": string;
  "id": string;
  "project_id": string;
  "record": LiteratureRecord;
  "removed": boolean;
  "result_index": number;
  "retrieved_at": string;
  "search_id": string;
  "snapshot_id": string;
  "updated_at": string;
  "verification": "verified" | "conflict" | "not_found" | "unverified";
  "verification_detail": LiteratureVerificationDetail;
  "verified_at": (string) | (null);
  "version": number;
};

export type LiteratureEntryVersionPage = {
  "items": Array<LiteratureEntryVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type LiteratureEntryVersionRead = {
  "action": "saved" | "verified" | "removed" | "restored";
  "created_at": string;
  "removed": boolean;
  "verification": "verified" | "conflict" | "not_found" | "unverified";
  "verification_detail": LiteratureVerificationDetail;
  "version": number;
};

export type LiteratureRecord = {
  "abstract": (string) | (null);
  "authors": Array<string>;
  "coverage": "biblio" | "abstract";
  "doi": (string) | (null);
  "issue"?: (string) | (null);
  "pages"?: (string) | (null);
  "publisher": (string) | (null);
  "source": "crossref" | "openalex";
  "source_id": string;
  "source_url": (string) | (null);
  "title": string;
  "venue": (string) | (null);
  "volume"?: (string) | (null);
  "work_type": (string) | (null);
  "year": (number) | (null);
};

export type LiteratureResultItem = {
  "abstract": (string) | (null);
  "authors": Array<string>;
  "coverage": "biblio" | "abstract";
  "doi": (string) | (null);
  "index": number;
  "issue"?: (string) | (null);
  "pages"?: (string) | (null);
  "publisher": (string) | (null);
  "saved_entry_id": (string) | (null);
  "source": "crossref" | "openalex";
  "source_id": string;
  "source_url": (string) | (null);
  "title": string;
  "venue": (string) | (null);
  "volume"?: (string) | (null);
  "work_type": (string) | (null);
  "year": (number) | (null);
};

export type LiteratureSearchCreate = {
  "command_id": string;
  "query": string;
  "rows"?: number;
  "source"?: "crossref" | "openalex";
  "year_from"?: (number) | (null);
  "year_to"?: (number) | (null);
};

export type LiteratureSearchInput = {
  "schema_version"?: 1;
  "search_id": string;
};

export type LiteratureSearchJobResult = {
  "adapter_version": "thesispilot-literature-1";
  "item_count": number;
  "job_id": string;
  "kind": "literature_search";
  "model_used": false;
  "project_id": string;
  "response_sha256": string;
  "schema_version": 1;
  "search_id": string;
  "snapshot_id": string;
  "source": "crossref" | "openalex";
  "writes_performed": false;
};

export type LiteratureSearchPage = {
  "items": Array<LiteratureSearchRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type LiteratureSearchRead = {
  "attempt": number;
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "job_id": string;
  "project_id": string;
  "query": string;
  "rows": number;
  "snapshot": (LiteratureSnapshotRead) | (null);
  "source": "crossref" | "openalex";
  "source_search_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
  "year_from": (number) | (null);
  "year_to": (number) | (null);
};

export type LiteratureSearchReceipt = {
  "job": JobRead;
  "search": LiteratureSearchRead;
};

export type LiteratureSearchRetry = {
  "command_id": string;
};

export type LiteratureSnapshotRead = {
  "adapter_version": string;
  "id": string;
  "items": Array<LiteratureResultItem>;
  "response_sha256": string;
  "retrieved_at": string;
  "skipped_count": number;
  "source": "crossref" | "openalex";
  "total_results": number;
};

export type LiteratureVerificationDetail = {
  "checked": boolean;
  "error_code"?: (string) | (null);
  "reason": "match" | "title_mismatch" | "year_mismatch" | "doi_not_found" | "no_doi" | "lookup_failed";
  "registry_title"?: (string) | (null);
  "registry_year"?: (number) | (null);
};

export type LossItem = {
  "detail"?: (string) | (null);
  "kind": string;
  "path": string;
};

export type MaterialEvidence = {
  "anchor_ids": Array<string>;
  "kind": "material";
  "material_id": string;
  "original_id": string;
  "parse_version_id": string;
};

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

export type NotificationEventPage = {
  "items": Array<NotificationEventRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type NotificationEventRead = {
  "action": "created" | "read" | "snooze" | "dismiss" | "restore" | "progress_note" | "snooze_expired";
  "actor": "student" | "system";
  "created_at": string;
  "from_status": ("unread" | "read" | "snoozed" | "dismissed") | (null);
  "id": string;
  "note": string;
  "notification_id": string;
  "notification_title": string;
  "object": ObjectRef;
  "snooze_until": (string) | (null);
  "to_status": "unread" | "read" | "snoozed" | "dismissed";
  "version": number;
};

export type NotificationPage = {
  "items": Array<NotificationRead>;
  "limit": number;
  "offset": number;
  "total": number;
  "unread_count": number;
};

export type NotificationRead = {
  "basis": Array<string>;
  "created_at": string;
  "dedupe_key": string;
  "delivery": "alerted" | "quiet" | "muted";
  "id": string;
  "kind": "task_due_soon" | "task_overdue" | "feedback_stale" | "project_deadline" | "job_failed";
  "object": ObjectRef;
  "progress_notes": Array<ProgressNote>;
  "project_id": string;
  "snooze_until": (string) | (null);
  "status": "unread" | "read" | "snoozed" | "dismissed";
  "title": string;
  "trigger": string;
  "uncertainty": string;
  "updated_at": string;
  "version": number;
};

export type NotificationTransition = {
  "action": "read" | "snooze" | "dismiss" | "restore";
  "command_id": string;
  "expected_version": number;
  "snooze_until"?: (string) | (null);
};

export type ObjectRef = {
  "id": string;
  "parent_id": (string) | (null);
  "source_version": number;
  "type": "task" | "feedback_item" | "project" | "job";
};

export type OfficeExportChange = {
  "detail": string;
  "kind": string;
  "node_id"?: (string) | (null);
};

export type OfficeExportLoss = {
  "kind": string;
  "label": string;
  "path": string;
};

export type OfficeExportReport = {
  "applied_changes": number;
  "baseline_version": (number) | (null);
  "losses": Array<OfficeExportLoss>;
  "mode": "preserve" | "regenerate";
  "track_changes": boolean;
  "unsupported_changes": Array<OfficeExportChange>;
  "warning_total": number;
  "warnings": Array<OfficeExportWarning>;
};

export type OfficeExportWarning = {
  "code": string;
  "message": string;
  "path": string;
};

export type OfficeImportChapter = {
  "id": string;
  "level": number;
  "title": string;
};

export type OfficeImportConfirm = {
  "command_id": string;
  "expected_version"?: (number) | (null);
  "mode": "create" | "new_version";
};

export type OfficeImportCreate = {
  "material_id": string;
  "original_id": string;
};

export type OfficeImportInput = {
  "material_id": string;
  "original_id": string;
  "original_sha256": string;
  "schema_version"?: 1;
};

export type OfficeImportLoss = {
  "action": "protected" | "noted";
  "detail"?: (string) | (null);
  "kind": string;
  "label": string;
  "node_id"?: (string) | (null);
  "path": string;
};

export type OfficeImportObject = {
  "block_type": string;
  "excerpt": string;
  "node_id": string;
};

export type OfficeImportPage = {
  "items": Array<OfficeImportRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type OfficeImportPreview = {
  "append_blocked_reason": (string) | (null);
  "block_count": number;
  "can_append": boolean;
  "can_create": boolean;
  "chapters": Array<OfficeImportChapter>;
  "chapters_truncated": boolean;
  "converter": string;
  "existing_document_id": (string) | (null);
  "existing_version": (number) | (null);
  "filename": string;
  "image_count": number;
  "import_id": string;
  "losses": Array<OfficeImportLoss>;
  "objects": Array<OfficeImportObject>;
  "original_sha256": string;
  "paragraph_count": number;
  "table_count": number;
  "text_characters": number;
};

export type OfficeImportRead = {
  "attempt": number;
  "created_at": string;
  "error_code": (string) | (null);
  "job_id": string;
  "material_id": string;
  "original_id": string;
  "original_sha256": string;
  "preview": (OfficeImportPreview) | (null);
  "project_id": string;
  "source_job_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type OfficeImportReceipt = {
  "command_id": string;
  "document_id": string;
  "document_version": number;
  "import_id": string;
  "mode": "create" | "new_version";
};

export type OfficeImportResult = {
  "block_count": number;
  "chapter_count": number;
  "import_id": string;
  "job_id": string;
  "kind": "office_import";
  "loss_count": number;
  "model_used": false;
  "object_count": number;
  "original_sha256": string;
  "project_id": string;
  "schema_version": 1;
  "writes_performed": false;
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

export type PlanAdjustmentCreate = {
  "agent_config_version_id": string;
  "command_id": string;
};

export type PlanAdjustmentDecide = {
  "accepted_item_ids"?: Array<string>;
  "action": "adopt" | "keep";
  "command_id": string;
};

export type PlanAdjustmentInput = {
  "adjustment_id": string;
  "schema_version"?: 1;
};

export type PlanAdjustmentItem = {
  "after": DateRange;
  "base_version": (number) | (null);
  "before": DateRange;
  "blocked": boolean;
  "id": string;
  "reason": string;
  "task_id": (string) | (null);
  "task_key": string;
  "title": string;
  "violations": Array<PlanViolation>;
};

export type PlanAdjustmentPage = {
  "items": Array<PlanAdjustmentRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type PlanAdjustmentRead = {
  "agent_config_version_id": string;
  "agent_name": string;
  "attempt": number;
  "base_plan_version": number;
  "config_version_ids": { [key: string]: string };
  "created_at": string;
  "deadline": (string) | (null);
  "decision": (PlanDecisionRead) | (null);
  "error_code": (string) | (null);
  "id": string;
  "job_id": string;
  "planning_mode": "none" | "personal";
  "project_id": string;
  "proposal": (PlanProposalContent) | (null);
  "requested_model": (string) | (null);
  "response_model": (string) | (null);
  "revert": (PlanDecisionRead) | (null);
  "state": "queued" | "running" | "failed" | "cancelled" | "pending" | "expired" | "adopted" | "kept" | "reverted";
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "task_count": number;
  "updated_at": string;
};

export type PlanAdjustmentReceipt = {
  "adjustment": PlanAdjustmentRead;
  "job": JobRead;
};

export type PlanAdjustmentResult = {
  "adjustment_id": string;
  "blocked_count": number;
  "item_count": number;
  "job_id": string;
  "kind": "plan_adjustment";
  "model_used": true;
  "project_id": string;
  "proposal_id": string;
  "requested_model": string;
  "response_model": string;
  "schema_version": 1;
  "writes_performed": false;
};

export type PlanAdjustmentRevert = {
  "command_id": string;
};

export type PlanChange = {
  "after": DateRange;
  "after_version": number;
  "before": DateRange;
  "before_version": number;
  "task_id": string;
  "title": string;
};

export type PlanDecisionRead = {
  "accepted_item_ids": Array<string>;
  "action": "adopt" | "keep" | "revert";
  "created_at": string;
  "plan_version": (number) | (null);
  "rejected_item_ids": Array<string>;
};

export type PlanProposalContent = {
  "items": Array<PlanAdjustmentItem>;
  "notes": Array<string>;
  "schema_version": 1;
  "summary": string;
};

export type PlanRead = {
  "deadline": (string) | (null);
  "latest_adjustment_id": (string) | (null);
  "plan_version": number;
  "planning_mode": "none" | "personal";
  "project_id": string;
};

export type PlanSchedule = {
  "changes": Array<ScheduleChange>;
  "command_id": string;
  "reason"?: string;
};

export type PlanTaskState = {
  "archived": boolean;
  "depends_on": Array<string>;
  "due_date": (string) | (null);
  "hard_deadline": (string) | (null);
  "position": number;
  "start_date": (string) | (null);
  "status": "todo" | "doing" | "verify" | "confirmed" | "rework";
  "task_id": string;
  "title": string;
  "version": number;
};

export type PlanVersionPage = {
  "items": Array<PlanVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type PlanVersionRead = {
  "action": "adopt" | "revert" | "manual";
  "adjustment_id": (string) | (null);
  "changes": Array<PlanChange>;
  "created_at": string;
  "project_id": string;
  "reason": string;
  "tasks": Array<PlanTaskState>;
  "version": number;
};

export type PlanViolation = {
  "code": "UNKNOWN_TASK" | "ARCHIVED_TASK" | "CONFIRMED_TASK" | "DUPLICATE" | "INVALID_DATE" | "NO_CHANGE" | "DATE_ORDER" | "PAST_DATE" | "HARD_DEADLINE" | "PROJECT_DEADLINE" | "DEPENDENCY_ORDER";
  "message": string;
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

export type ProgressNote = {
  "created_at": string;
  "text": string;
};

export type ProgressNoteCreate = {
  "command_id": string;
  "expected_version": number;
  "text": string;
};

export type ProjectBackupInput = {
  "kind"?: "project_backup";
  "project_id": string;
  "schema_version"?: 1;
};

export type ProjectBackupResult = {
  "archive_id": string;
  "byte_size": number;
  "filename": string;
  "format": "thesispilot-backup/1";
  "job_id": string;
  "kind": "project_backup";
  "model_used": false;
  "object_counts": { [key: string]: unknown };
  "package_sha256": string;
  "project_id": string;
  "schema_version": 1;
  "sha256": string;
  "writes_performed": false;
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

export type ProjectRestoreInput = {
  "kind"?: "project_restore";
  "restore_id": string;
  "schema_version"?: 1;
  "upload_sha256": string;
};

export type ProjectRestoreResult = {
  "format": "thesispilot-backup/1";
  "interrupted_jobs": number;
  "job_id": string;
  "kind": "project_restore";
  "model_used": false;
  "object_counts": { [key: string]: unknown };
  "package_sha256": string;
  "project_id": string;
  "restore_id": string;
  "schema_version": 1;
  "source_project_id": string;
  "writes_performed": true;
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

export type RefreshResult = {
  "created": number;
  "project_id": string;
  "unread_count": number;
  "woken": number;
};

export type ReminderSettingsRead = {
  "cooldown_hours": number;
  "enabled": boolean;
  "overdue_days": number;
  "updated_at": (string) | (null);
  "version": number;
};

export type ReminderSettingsUpdate = {
  "cooldown_hours": number;
  "enabled": boolean;
  "expected_version": number;
  "overdue_days": number;
};

export type RestorePage = {
  "items": Array<RestoreRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type RestoreRead = {
  "attempt": number;
  "byte_size": number;
  "created_at": string;
  "error_code": (string) | (null);
  "exported_at": string;
  "filename": string;
  "job_id": string;
  "object_counts": { [key: string]: number };
  "package_sha256": string;
  "restore_id": string;
  "result_project_id": (string) | (null);
  "schema_head": string;
  "sha256": string;
  "source_project_id": string;
  "source_project_name": string;
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type ReviewBasis = {
  "item_id": string;
  "key": string;
  "kind": "requirement" | "template" | "rubric";
  "label": string;
  "source_id": (string) | (null);
};

export type ReviewCreate = {
  "agent_config_version_id": string;
  "chapter_id"?: (string) | (null);
  "command_id": string;
  "document_id": string;
  "document_version": number;
  "rubric_version": string;
  "source_binding_version_id"?: (string) | (null);
};

export type ReviewInput = {
  "review_id": string;
  "schema_version"?: 1;
};

export type ReviewIssue = {
  "basis": Array<ReviewBasis>;
  "basis_status": "cited" | "missing";
  "direction": string;
  "explanation": string;
  "id": string;
  "location": ReviewLocation;
  "severity": "major" | "minor" | "advice";
  "title": string;
};

export type ReviewLocation = {
  "block_index": (number) | (null);
  "chapter_id": (string) | (null);
  "chapter_title": (string) | (null);
  "end": (number) | (null);
  "node_id"?: (string) | (null);
  "quote": (string) | (null);
  "start": (number) | (null);
  "status": "range" | "block" | "chapter" | "unlocated";
};

export type ReviewPage = {
  "items": Array<ReviewRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type ReviewRead = {
  "agent_config_version_id": string;
  "agent_name": string;
  "attempt": number;
  "chapter_id": (string) | (null);
  "config_version_ids": { [key: string]: string };
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "error_code": (string) | (null);
  "id": string;
  "job_id": string;
  "project_id": string;
  "report_id": (string) | (null);
  "requirement_parse_version_ids": Array<string>;
  "rubric_version": string;
  "scope_title": string;
  "source_binding_version_id": (string) | (null);
  "source_review_id": (string) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "template_parse_version_id": (string) | (null);
  "updated_at": string;
};

export type ReviewReceipt = {
  "job": JobRead;
  "review": ReviewRead;
};

export type ReviewReportContent = {
  "issues": Array<ReviewIssue>;
  "limitations": Array<string>;
  "rubric": ReviewRubricRead;
  "schema_version"?: 1;
  "scope": ReviewScopeRead;
  "scores": Array<ReviewScore>;
  "summary": string;
  "unchecked": Array<ReviewUnchecked>;
};

export type ReviewReportRead = {
  "content": ReviewReportContent;
  "created_at": string;
  "document_id": string;
  "document_version": number;
  "id": string;
  "job_id": string;
  "project_id": string;
  "requested_model": string;
  "response_model": string;
  "review_id": string;
};

export type ReviewResult = {
  "document_id": string;
  "document_version": number;
  "job_id": string;
  "kind": "review";
  "model_used": true;
  "project_id": string;
  "report_id": string;
  "requested_model": string;
  "response_model": string;
  "review_id": string;
  "schema_version": 1;
  "writes_performed": false;
};

export type ReviewRetry = {
  "command_id": string;
};

export type ReviewRubricDimension = {
  "description": string;
  "full": number;
  "id": string;
  "name": string;
};

export type ReviewRubricList = {
  "items": Array<ReviewRubricRead>;
};

export type ReviewRubricRead = {
  "description": string;
  "dimensions": Array<ReviewRubricDimension>;
  "limitations": Array<string>;
  "title": string;
  "version": string;
};

export type ReviewScopeRead = {
  "chapter_id": (string) | (null);
  "title": string;
};

export type ReviewScore = {
  "dimension_id": string;
  "full": number;
  "name": string;
  "reason": string;
  "score": (number) | (null);
};

export type ReviewUnchecked = {
  "item": string;
  "origin": "model" | "system";
  "reason": string;
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
  "end"?: (number) | (null);
  "from"?: (number) | (null);
  "patch_id"?: (string) | (null);
  "result": "pass" | "fail" | "unsupported";
  "rule": "version" | "range" | "number" | "citation" | "formula" | "lock" | "overlap" | "structure";
  "start"?: (number) | (null);
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
  "selection": (RevisionSelection) | (RevisionNodeSelection);
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

export type RevisionNodePatch = {
  "after": string;
  "before": string;
  "end": number;
  "id": string;
  "start": number;
};

export type RevisionNodeSelection = {
  "end": number;
  "expected_text": string;
  "node_id": string;
  "start": number;
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
  "patches": Array<(RevisionPatch) | (RevisionNodePatch)>;
};

export type RevisionRead = {
  "applicable": boolean;
  "application_command_id": (string) | (null);
  "base_version": number;
  "checks": Array<RevisionCheck>;
  "content_schema_version"?: 1 | 2;
  "created_at": string;
  "decisions": Array<RevisionDecision>;
  "document_id": string;
  "document_version": number;
  "generation_error_code"?: (string) | (null);
  "generation_token": (string) | (null);
  "goal": string;
  "id": string;
  "patches": Array<(RevisionPatch) | (RevisionNodePatch)>;
  "policy_version": string;
  "producer": "deterministic_preview" | "model_run";
  "project_id": string;
  "result_version": (number) | (null);
  "revision": number;
  "run_id"?: (string) | (null);
  "selection": (RevisionSelection) | (RevisionNodeSelection);
  "status": "generating" | "ready" | "invalid" | "cancelled" | "applied" | "undone" | "failed";
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
  "status": "generating" | "ready" | "invalid" | "cancelled" | "applied" | "undone" | "failed";
  "updated_at": string;
};

export type RevisionUndo = {
  "command_id": string;
  "expected_document_version": number;
};

export type ScheduleChange = {
  "due_date": (string) | (null);
  "expected_version": number;
  "start_date": (string) | (null);
  "task_id": string;
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

export type SourceRange = {
  "from": number;
  "text": string;
  "to": number;
};

export type StageCommandRead = {
  "confirmation": StageConfirmationRead;
  "project": ProjectRead;
};

export type StageConfirm = {
  "command_id": string;
  "document_version"?: (number) | (null);
  "evidence"?: Array<EvidenceTaskRef>;
  "expected_project_version": number;
  "flow_version_id": string;
  "next_stage_id"?: (string) | (null);
  "note": string;
  "stage_id": string;
};

export type StageConfirmationPage = {
  "items": Array<StageConfirmationRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type StageConfirmationRead = {
  "created_at": string;
  "document_id": (string) | (null);
  "document_version": (number) | (null);
  "evidence": Array<EvidenceTaskSnapshot>;
  "flow_version_id": string;
  "id": string;
  "kind": "confirm" | "revoke";
  "next_stage_id": (string) | (null);
  "note": string;
  "project_id": string;
  "project_version_after": number;
  "resulting_stage_id": string;
  "resulting_stage_name": string;
  "revoked_by_id": (string) | (null);
  "revokes_id": (string) | (null);
  "sequence": number;
  "stage_id": string;
  "stage_name": string;
};

export type StageOption = {
  "id": string;
  "name": string;
};

export type StagePrerequisite = {
  "confirmed": boolean;
  "name": string;
  "stage_id": string;
};

export type StageProgressRead = {
  "binding": "unbound" | "ready" | "invalid";
  "current": (CurrentStageRead) | (null);
  "document": (DocumentPointer) | (null);
  "evidence_candidates": Array<EvidenceCandidate>;
  "flow_id": (string) | (null);
  "flow_name": (string) | (null);
  "flow_version": (number) | (null);
  "flow_version_id": (string) | (null);
  "project_id": string;
  "project_version": number;
  "revocable_id": (string) | (null);
  "stage_id": (string) | (null);
  "stages": Array<StageRouteItem>;
};

export type StageRevoke = {
  "command_id": string;
  "expected_project_version": number;
  "note"?: string;
};

export type StageRouteItem = {
  "confirmation_id": (string) | (null);
  "deadline": (string) | (null);
  "id": string;
  "name": string;
  "start": (string) | (null);
  "state": "confirmed" | "current" | "upcoming";
};

export type SuggestionDecision = {
  "action": "adopt" | "reject" | "undo";
  "content"?: (FeedbackContent) | (null);
  "expected_version": number;
  "reason"?: string;
  "suggestion_id": string;
};

export type SuggestionHistoryRead = {
  "action": "adopt" | "adopt_modified" | "reject" | "undo";
  "created_at": string;
  "feedback_item_id": (string) | (null);
  "reason": string;
  "version": number;
};

export type TaskContent = {
  "acceptance": string;
  "archived"?: boolean;
  "chapter"?: (ChapterRef) | (null);
  "depends_on"?: Array<string>;
  "description"?: string;
  "due_date"?: (string) | (null);
  "evidence"?: Array<(DocumentEvidence) | (MaterialEvidence)>;
  "hard_deadline"?: (string) | (null);
  "start_date"?: (string) | (null);
  "status"?: "todo" | "doing" | "verify";
  "title": string;
};

export type TaskCreate = {
  "command_id": string;
  "content": TaskContent;
  "expected_board_version": number;
};

export type TaskDecision = {
  "action": "confirm" | "rework" | "reopen";
  "command_id": string;
  "expected_version": number;
  "reason"?: string;
};

export type TaskPage = {
  "board_version": number;
  "items": Array<TaskSummary>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type TaskRead = {
  "content": TaskContent;
  "created_at": string;
  "evidence_snapshots": Array<EvidenceSnapshot>;
  "id": string;
  "needs_review": boolean;
  "origin"?: "manual";
  "position": number;
  "project_id": string;
  "review_reasons": Array<string>;
  "status": "todo" | "doing" | "verify" | "confirmed" | "rework";
  "updated_at": string;
  "version": number;
};

export type TaskReorder = {
  "command_id": string;
  "expected_board_version": number;
  "task_ids": Array<string>;
};

export type TaskSummary = {
  "archived": boolean;
  "depends_on"?: Array<string>;
  "due_date": (string) | (null);
  "hard_deadline"?: (string) | (null);
  "id": string;
  "needs_review": boolean;
  "position": number;
  "project_id": string;
  "review_reasons": Array<string>;
  "start_date"?: (string) | (null);
  "status": "todo" | "doing" | "verify" | "confirmed" | "rework";
  "title": string;
  "updated_at": string;
  "version": number;
};

export type TaskUpdate = {
  "command_id": string;
  "content": TaskContent;
  "expected_version": number;
};

export type TaskVersionPage = {
  "items": Array<TaskVersionRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type TaskVersionRead = {
  "action": string;
  "created_at": string;
  "reason": string;
  "snapshot": TaskRead;
  "version": number;
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

export type UnreadCount = {
  "project_id": string;
  "unread_count": number;
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
  "AssistantContentInput": AssistantContentInput;
  "AssistantLiteratureRef": AssistantLiteratureRef;
  "AssistantMaterialRef": AssistantMaterialRef;
  "AssistantMessagePage": AssistantMessagePage;
  "AssistantMessageRead": AssistantMessageRead;
  "AssistantRunCommand": AssistantRunCommand;
  "AssistantRunContext": AssistantRunContext;
  "AssistantRunCreate": AssistantRunCreate;
  "AssistantRunPage": AssistantRunPage;
  "AssistantRunRead": AssistantRunRead;
  "AssistantRunReceipt": AssistantRunReceipt;
  "AssistantRunRetryReceipt": AssistantRunRetryReceipt;
  "AssistantSessionCreate": AssistantSessionCreate;
  "AssistantSessionPage": AssistantSessionPage;
  "AssistantSessionRead": AssistantSessionRead;
  "AssistantSessionUpdate": AssistantSessionUpdate;
  "BackupConfiguration": BackupConfiguration;
  "BackupFileRead": BackupFileRead;
  "BackupPage": BackupPage;
  "BackupRead": BackupRead;
  "BoardRead": BoardRead;
  "ChangeRecordCreate": ChangeRecordCreate;
  "ChangeRecordInput": ChangeRecordInput;
  "ChangeRecordResult": ChangeRecordResult;
  "ChapterCorrection": ChapterCorrection;
  "ChapterRef": ChapterRef;
  "CitationApply": CitationApply;
  "CitationCandidatePage": CitationCandidatePage;
  "CitationCandidateRead": CitationCandidateRead;
  "CitationChange": CitationChange;
  "CitationCreate": CitationCreate;
  "CitationEntrySummary": CitationEntrySummary;
  "CitationHeadingPreview": CitationHeadingPreview;
  "CitationListRead": CitationListRead;
  "CitationMarkerPreview": CitationMarkerPreview;
  "CitationMarkerRead": CitationMarkerRead;
  "CitationPlacement": CitationPlacement;
  "CitationPreview": CitationPreview;
  "CitationReferencePreview": CitationReferencePreview;
  "CitationReject": CitationReject;
  "CitationRenumber": CitationRenumber;
  "CitationUndo": CitationUndo;
  "CitedEntryRead": CitedEntryRead;
  "ConfigurationProbeConfiguration": ConfigurationProbeConfiguration;
  "ConfigurationProbeInput": ConfigurationProbeInput;
  "ConfigurationProbeResult": ConfigurationProbeResult;
  "ConfigurationProbeScope": ConfigurationProbeScope;
  "ContentRevisionInput": ContentRevisionInput;
  "ContentRevisionResult": ContentRevisionResult;
  "CurrentStageRead": CurrentStageRead;
  "DateRange": DateRange;
  "DeliverableFact": DeliverableFact;
  "DiagnosticResult": DiagnosticResult;
  "DocsAnchorPos": DocsAnchorPos;
  "DocsAutoColor": DocsAutoColor;
  "DocsBookmarkInline": DocsBookmarkInline;
  "DocsBorder": DocsBorder;
  "DocsBorders": DocsBorders;
  "DocsBreakInline": DocsBreakInline;
  "DocsCellProps": DocsCellProps;
  "DocsChapter": DocsChapter;
  "DocsCodeBlock": DocsCodeBlock;
  "DocsDocGrid": DocsDocGrid;
  "DocsEmuWidth": DocsEmuWidth;
  "DocsFieldInline": DocsFieldInline;
  "DocsHeaderFooter": DocsHeaderFooter;
  "DocsHeadingBlock": DocsHeadingBlock;
  "DocsImageAnchor": DocsImageAnchor;
  "DocsImageBlock": DocsImageBlock;
  "DocsImageInline": DocsImageInline;
  "DocsIndent": DocsIndent;
  "DocsInlineProps": DocsInlineProps;
  "DocsLineAtLeast": DocsLineAtLeast;
  "DocsLineExact": DocsLineExact;
  "DocsLineMultiple": DocsLineMultiple;
  "DocsLink": DocsLink;
  "DocsListBlock": DocsListBlock;
  "DocsListItem": DocsListItem;
  "DocsListLabel": DocsListLabel;
  "DocsMargins": DocsMargins;
  "DocsMeta": DocsMeta;
  "DocsModel": DocsModel;
  "DocsNamedFontRef": DocsNamedFontRef;
  "DocsPageBreakBlock": DocsPageBreakBlock;
  "DocsPageProps": DocsPageProps;
  "DocsPageSize": DocsPageSize;
  "DocsParaProps": DocsParaProps;
  "DocsParagraphBlock": DocsParagraphBlock;
  "DocsPctWidth": DocsPctWidth;
  "DocsProtection": DocsProtection;
  "DocsProtectionAnchor": DocsProtectionAnchor;
  "DocsQuoteBlock": DocsQuoteBlock;
  "DocsResource": DocsResource;
  "DocsRgbColor": DocsRgbColor;
  "DocsRuleBlock": DocsRuleBlock;
  "DocsRunInline": DocsRunInline;
  "DocsSection": DocsSection;
  "DocsSpacing": DocsSpacing;
  "DocsTabInline": DocsTabInline;
  "DocsTabStop": DocsTabStop;
  "DocsTableBlock": DocsTableBlock;
  "DocsTableCell": DocsTableCell;
  "DocsTableContinuation": DocsTableContinuation;
  "DocsTableProps": DocsTableProps;
  "DocsTableRow": DocsTableRow;
  "DocsThemeColorValue": DocsThemeColorValue;
  "DocsThemeFontRef": DocsThemeFontRef;
  "DocsThemeRef": DocsThemeRef;
  "DocsTocBlock": DocsTocBlock;
  "DocsUnsupported": DocsUnsupported;
  "DocsUriData": DocsUriData;
  "DocumentContent-Input": DocumentContent_Input;
  "DocumentContent-Output": DocumentContent_Output;
  "DocumentContentV2": DocumentContentV2;
  "DocumentEvidence": DocumentEvidence;
  "DocumentExportCreate": DocumentExportCreate;
  "DocumentExportInput": DocumentExportInput;
  "DocumentExportResult": DocumentExportResult;
  "DocumentImport": DocumentImport;
  "DocumentOfficeSourceRead": DocumentOfficeSourceRead;
  "DocumentPointer": DocumentPointer;
  "DocumentRead": DocumentRead;
  "DocumentResourceRead": DocumentResourceRead;
  "DocumentResourceUpload": DocumentResourceUpload;
  "DocumentSave": DocumentSave;
  "DocumentSchemaUpgradeCreate": DocumentSchemaUpgradeCreate;
  "DocumentSchemaUpgradeRead": DocumentSchemaUpgradeRead;
  "DocumentSchemaUpgradeRecord": DocumentSchemaUpgradeRecord;
  "DocumentSourceChapter": DocumentSourceChapter;
  "DocumentSourceImport": DocumentSourceImport;
  "DocumentSourceImportReceipt": DocumentSourceImportReceipt;
  "DocumentSourcePreview": DocumentSourcePreview;
  "DocumentSourcePreviewRequest": DocumentSourcePreviewRequest;
  "DocumentSourceRead": DocumentSourceRead;
  "DocumentVersionPage": DocumentVersionPage;
  "DocumentVersionRead": DocumentVersionRead;
  "DocumentVersionSummary": DocumentVersionSummary;
  "EditorJsonValue-Input": EditorJsonValue_Input;
  "EditorJsonValue-Output": EditorJsonValue_Output;
  "ErrorDetail": ErrorDetail;
  "ErrorResponse": ErrorResponse;
  "EvidenceCandidate": EvidenceCandidate;
  "EvidenceSnapshot": EvidenceSnapshot;
  "EvidenceTaskRef": EvidenceTaskRef;
  "EvidenceTaskSnapshot": EvidenceTaskSnapshot;
  "ExportConfiguration": ExportConfiguration;
  "ExportFileRead": ExportFileRead;
  "ExportPage": ExportPage;
  "ExportRead": ExportRead;
  "FeedbackContent": FeedbackContent;
  "FeedbackCreate": FeedbackCreate;
  "FeedbackDecision": FeedbackDecision;
  "FeedbackItemCreate": FeedbackItemCreate;
  "FeedbackItemPage": FeedbackItemPage;
  "FeedbackItemRead": FeedbackItemRead;
  "FeedbackItemSummary": FeedbackItemSummary;
  "FeedbackItemUpdate": FeedbackItemUpdate;
  "FeedbackPage": FeedbackPage;
  "FeedbackRead": FeedbackRead;
  "FeedbackSplitCreate": FeedbackSplitCreate;
  "FeedbackSplitDecide": FeedbackSplitDecide;
  "FeedbackSplitInput": FeedbackSplitInput;
  "FeedbackSplitPage": FeedbackSplitPage;
  "FeedbackSplitRead": FeedbackSplitRead;
  "FeedbackSplitReceipt": FeedbackSplitReceipt;
  "FeedbackSplitResult": FeedbackSplitResult;
  "FeedbackSplitRetry": FeedbackSplitRetry;
  "FeedbackSuggestionRead": FeedbackSuggestionRead;
  "FeedbackSummary": FeedbackSummary;
  "FeedbackVersionPage": FeedbackVersionPage;
  "FeedbackVersionRead": FeedbackVersionRead;
  "FlowCreate": FlowCreate;
  "FlowPage": FlowPage;
  "FlowRead": FlowRead;
  "FlowStage": FlowStage;
  "FlowUpdate": FlowUpdate;
  "FlowVersionPage": FlowVersionPage;
  "FlowVersionRead": FlowVersionRead;
  "FormatApply": FormatApply;
  "FormatCommandRead": FormatCommandRead;
  "FormatContext": FormatContext;
  "FormatCreate": FormatCreate;
  "FormatDecide": FormatDecide;
  "FormatDecision": FormatDecision;
  "FormatPage": FormatPage;
  "FormatPatch": FormatPatch;
  "FormatRead": FormatRead;
  "FormatRule": FormatRule;
  "FormatSelection": FormatSelection;
  "FormatTarget": FormatTarget;
  "FormatUndo": FormatUndo;
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
  "LiteratureEntryCommand": LiteratureEntryCommand;
  "LiteratureEntryCreate": LiteratureEntryCreate;
  "LiteratureEntryPage": LiteratureEntryPage;
  "LiteratureEntryRead": LiteratureEntryRead;
  "LiteratureEntryVersionPage": LiteratureEntryVersionPage;
  "LiteratureEntryVersionRead": LiteratureEntryVersionRead;
  "LiteratureRecord": LiteratureRecord;
  "LiteratureResultItem": LiteratureResultItem;
  "LiteratureSearchCreate": LiteratureSearchCreate;
  "LiteratureSearchInput": LiteratureSearchInput;
  "LiteratureSearchJobResult": LiteratureSearchJobResult;
  "LiteratureSearchPage": LiteratureSearchPage;
  "LiteratureSearchRead": LiteratureSearchRead;
  "LiteratureSearchReceipt": LiteratureSearchReceipt;
  "LiteratureSearchRetry": LiteratureSearchRetry;
  "LiteratureSnapshotRead": LiteratureSnapshotRead;
  "LiteratureVerificationDetail": LiteratureVerificationDetail;
  "LossItem": LossItem;
  "MaterialEvidence": MaterialEvidence;
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
  "NotificationEventPage": NotificationEventPage;
  "NotificationEventRead": NotificationEventRead;
  "NotificationPage": NotificationPage;
  "NotificationRead": NotificationRead;
  "NotificationTransition": NotificationTransition;
  "ObjectRef": ObjectRef;
  "OfficeExportChange": OfficeExportChange;
  "OfficeExportLoss": OfficeExportLoss;
  "OfficeExportReport": OfficeExportReport;
  "OfficeExportWarning": OfficeExportWarning;
  "OfficeImportChapter": OfficeImportChapter;
  "OfficeImportConfirm": OfficeImportConfirm;
  "OfficeImportCreate": OfficeImportCreate;
  "OfficeImportInput": OfficeImportInput;
  "OfficeImportLoss": OfficeImportLoss;
  "OfficeImportObject": OfficeImportObject;
  "OfficeImportPage": OfficeImportPage;
  "OfficeImportPreview": OfficeImportPreview;
  "OfficeImportRead": OfficeImportRead;
  "OfficeImportReceipt": OfficeImportReceipt;
  "OfficeImportResult": OfficeImportResult;
  "ParsedMaterial": ParsedMaterial;
  "ParsedRequirement": ParsedRequirement;
  "PlanAdjustmentCreate": PlanAdjustmentCreate;
  "PlanAdjustmentDecide": PlanAdjustmentDecide;
  "PlanAdjustmentInput": PlanAdjustmentInput;
  "PlanAdjustmentItem": PlanAdjustmentItem;
  "PlanAdjustmentPage": PlanAdjustmentPage;
  "PlanAdjustmentRead": PlanAdjustmentRead;
  "PlanAdjustmentReceipt": PlanAdjustmentReceipt;
  "PlanAdjustmentResult": PlanAdjustmentResult;
  "PlanAdjustmentRevert": PlanAdjustmentRevert;
  "PlanChange": PlanChange;
  "PlanDecisionRead": PlanDecisionRead;
  "PlanProposalContent": PlanProposalContent;
  "PlanRead": PlanRead;
  "PlanSchedule": PlanSchedule;
  "PlanTaskState": PlanTaskState;
  "PlanVersionPage": PlanVersionPage;
  "PlanVersionRead": PlanVersionRead;
  "PlanViolation": PlanViolation;
  "ProfileRead": ProfileRead;
  "ProfileUpdate": ProfileUpdate;
  "ProgressNote": ProgressNote;
  "ProgressNoteCreate": ProgressNoteCreate;
  "ProjectBackupInput": ProjectBackupInput;
  "ProjectBackupResult": ProjectBackupResult;
  "ProjectCreate": ProjectCreate;
  "ProjectPage": ProjectPage;
  "ProjectRead": ProjectRead;
  "ProjectRestoreInput": ProjectRestoreInput;
  "ProjectRestoreResult": ProjectRestoreResult;
  "ProjectSourceBindingRead": ProjectSourceBindingRead;
  "ProjectSourceBindingUpdate": ProjectSourceBindingUpdate;
  "ProjectSourceBindingVersionPage": ProjectSourceBindingVersionPage;
  "ProjectSourceBindingVersionRead": ProjectSourceBindingVersionRead;
  "ProjectUpdate": ProjectUpdate;
  "PromptConfigContent": PromptConfigContent;
  "RefreshResult": RefreshResult;
  "ReminderSettingsRead": ReminderSettingsRead;
  "ReminderSettingsUpdate": ReminderSettingsUpdate;
  "RestorePage": RestorePage;
  "RestoreRead": RestoreRead;
  "ReviewBasis": ReviewBasis;
  "ReviewCreate": ReviewCreate;
  "ReviewInput": ReviewInput;
  "ReviewIssue": ReviewIssue;
  "ReviewLocation": ReviewLocation;
  "ReviewPage": ReviewPage;
  "ReviewRead": ReviewRead;
  "ReviewReceipt": ReviewReceipt;
  "ReviewReportContent": ReviewReportContent;
  "ReviewReportRead": ReviewReportRead;
  "ReviewResult": ReviewResult;
  "ReviewRetry": ReviewRetry;
  "ReviewRubricDimension": ReviewRubricDimension;
  "ReviewRubricList": ReviewRubricList;
  "ReviewRubricRead": ReviewRubricRead;
  "ReviewScopeRead": ReviewScopeRead;
  "ReviewScore": ReviewScore;
  "ReviewUnchecked": ReviewUnchecked;
  "RevisionApply": RevisionApply;
  "RevisionCancel": RevisionCancel;
  "RevisionCheck": RevisionCheck;
  "RevisionCommandRead": RevisionCommandRead;
  "RevisionCreate": RevisionCreate;
  "RevisionDecide": RevisionDecide;
  "RevisionDecision": RevisionDecision;
  "RevisionNodePatch": RevisionNodePatch;
  "RevisionNodeSelection": RevisionNodeSelection;
  "RevisionPage": RevisionPage;
  "RevisionPatch": RevisionPatch;
  "RevisionProposal": RevisionProposal;
  "RevisionRead": RevisionRead;
  "RevisionRevert": RevisionRevert;
  "RevisionSelection": RevisionSelection;
  "RevisionSummary": RevisionSummary;
  "RevisionUndo": RevisionUndo;
  "ScheduleChange": ScheduleChange;
  "SessionCreate": SessionCreate;
  "SessionRead": SessionRead;
  "SourceAnchor": SourceAnchor;
  "SourceRange": SourceRange;
  "StageCommandRead": StageCommandRead;
  "StageConfirm": StageConfirm;
  "StageConfirmationPage": StageConfirmationPage;
  "StageConfirmationRead": StageConfirmationRead;
  "StageOption": StageOption;
  "StagePrerequisite": StagePrerequisite;
  "StageProgressRead": StageProgressRead;
  "StageRevoke": StageRevoke;
  "StageRouteItem": StageRouteItem;
  "SuggestionDecision": SuggestionDecision;
  "SuggestionHistoryRead": SuggestionHistoryRead;
  "TaskContent": TaskContent;
  "TaskCreate": TaskCreate;
  "TaskDecision": TaskDecision;
  "TaskPage": TaskPage;
  "TaskRead": TaskRead;
  "TaskReorder": TaskReorder;
  "TaskSummary": TaskSummary;
  "TaskUpdate": TaskUpdate;
  "TaskVersionPage": TaskVersionPage;
  "TaskVersionRead": TaskVersionRead;
  "TemplateItem": TemplateItem;
  "UnreadCount": UnreadCount;
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
  "AssistantContentInput": {
    "additionalProperties": false,
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
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
      "goal": {
        "maxLength": 2000,
        "minLength": 1,
        "title": "Goal",
        "type": "string"
      },
      "literature_entries": {
        "items": {
          "$ref": "#/components/schemas/AssistantLiteratureRef"
        },
        "maxItems": 10,
        "title": "Literature Entries",
        "type": "array"
      },
      "material_sources": {
        "items": {
          "$ref": "#/components/schemas/AssistantMaterialRef"
        },
        "maxItems": 10,
        "title": "Material Sources",
        "type": "array"
      },
      "selection": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/RevisionSelection"
          },
          {
            "$ref": "#/components/schemas/RevisionNodeSelection"
          }
        ],
        "title": "Selection"
      },
      "source_binding_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Binding Version Id"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "selection",
      "goal",
      "agent_config_version_id",
      "source_binding_version_id"
    ],
    "title": "AssistantContentInput",
    "type": "object"
  },
  "AssistantLiteratureRef": {
    "additionalProperties": false,
    "description": "A saved project literature entry pinned at the version the student chose.",
    "properties": {
      "entry_id": {
        "format": "uuid",
        "title": "Entry Id",
        "type": "string"
      },
      "entry_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Entry Version",
        "type": "integer"
      }
    },
    "required": [
      "entry_id",
      "entry_version"
    ],
    "title": "AssistantLiteratureRef",
    "type": "object"
  },
  "AssistantMaterialRef": {
    "additionalProperties": false,
    "properties": {
      "anchor_ids": {
        "items": {
          "maxLength": 200,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 20,
        "minItems": 1,
        "title": "Anchor Ids",
        "type": "array"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
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
      }
    },
    "required": [
      "material_id",
      "original_version_id",
      "parse_version_id",
      "anchor_ids"
    ],
    "title": "AssistantMaterialRef",
    "type": "object"
  },
  "AssistantMessagePage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/AssistantMessageRead"
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
    "title": "AssistantMessagePage",
    "type": "object"
  },
  "AssistantMessageRead": {
    "properties": {
      "content": {
        "maxLength": 4000,
        "title": "Content",
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
      "role": {
        "enum": [
          "user",
          "assistant"
        ],
        "title": "Role",
        "type": "string"
      },
      "run_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Run Id"
      },
      "seq": {
        "title": "Seq",
        "type": "integer"
      },
      "session_id": {
        "format": "uuid",
        "title": "Session Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "session_id",
      "seq",
      "role",
      "content",
      "run_id",
      "created_at"
    ],
    "title": "AssistantMessageRead",
    "type": "object"
  },
  "AssistantRunCommand": {
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
    "title": "AssistantRunCommand",
    "type": "object"
  },
  "AssistantRunContext": {
    "properties": {
      "configuration_snapshot": {
        "$ref": "#/components/schemas/JsonObject"
      },
      "context_snapshot": {
        "$ref": "#/components/schemas/JsonObject"
      },
      "input": {
        "$ref": "#/components/schemas/AssistantContentInput"
      },
      "run_id": {
        "format": "uuid",
        "title": "Run Id",
        "type": "string"
      }
    },
    "required": [
      "run_id",
      "input",
      "context_snapshot",
      "configuration_snapshot"
    ],
    "title": "AssistantRunContext",
    "type": "object"
  },
  "AssistantRunCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_session_version": {
        "minimum": 1,
        "title": "Expected Session Version",
        "type": "integer"
      },
      "input": {
        "$ref": "#/components/schemas/AssistantContentInput"
      },
      "purpose": {
        "const": "content_revision",
        "default": "content_revision",
        "title": "Purpose",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_session_version",
      "input"
    ],
    "title": "AssistantRunCreate",
    "type": "object"
  },
  "AssistantRunPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/AssistantRunRead"
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
    "title": "AssistantRunPage",
    "type": "object"
  },
  "AssistantRunRead": {
    "properties": {
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
        "title": "Document Version",
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
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "purpose": {
        "const": "content_revision",
        "title": "Purpose",
        "type": "string"
      },
      "result_message_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Message Id"
      },
      "session_id": {
        "format": "uuid",
        "title": "Session Id",
        "type": "string"
      },
      "source_run_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Run Id"
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
      "trigger_message_id": {
        "format": "uuid",
        "title": "Trigger Message Id",
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
      "session_id",
      "purpose",
      "job_id",
      "status",
      "trigger_message_id",
      "result_message_id",
      "candidate_id",
      "source_run_id",
      "document_id",
      "document_version",
      "error_code",
      "created_at",
      "updated_at"
    ],
    "title": "AssistantRunRead",
    "type": "object"
  },
  "AssistantRunReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "message": {
        "$ref": "#/components/schemas/AssistantMessageRead"
      },
      "run": {
        "$ref": "#/components/schemas/AssistantRunRead"
      },
      "session": {
        "$ref": "#/components/schemas/AssistantSessionRead"
      }
    },
    "required": [
      "session",
      "message",
      "run",
      "job"
    ],
    "title": "AssistantRunReceipt",
    "type": "object"
  },
  "AssistantRunRetryReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "run": {
        "$ref": "#/components/schemas/AssistantRunRead"
      },
      "session": {
        "$ref": "#/components/schemas/AssistantSessionRead"
      }
    },
    "required": [
      "session",
      "run",
      "job"
    ],
    "title": "AssistantRunRetryReceipt",
    "type": "object"
  },
  "AssistantSessionCreate": {
    "additionalProperties": false,
    "properties": {
      "role": {
        "const": "content",
        "default": "content",
        "title": "Role",
        "type": "string"
      },
      "title": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "title"
    ],
    "title": "AssistantSessionCreate",
    "type": "object"
  },
  "AssistantSessionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/AssistantSessionRead"
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
    "title": "AssistantSessionPage",
    "type": "object"
  },
  "AssistantSessionRead": {
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
      "role": {
        "const": "content",
        "title": "Role",
        "type": "string"
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
      "project_id",
      "title",
      "role",
      "version",
      "archived",
      "created_at",
      "updated_at"
    ],
    "title": "AssistantSessionRead",
    "type": "object"
  },
  "AssistantSessionUpdate": {
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
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "title": {
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
        "title": "Title"
      }
    },
    "required": [
      "expected_version"
    ],
    "title": "AssistantSessionUpdate",
    "type": "object"
  },
  "BackupConfiguration": {
    "additionalProperties": false,
    "description": "Server-frozen package format; a restore also fixes the uploaded bytes' digest.",
    "properties": {
      "format": {
        "const": "thesispilot-backup/1",
        "default": "thesispilot-backup/1",
        "title": "Format",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "title": "BackupConfiguration",
    "type": "object"
  },
  "BackupFileRead": {
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
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "object_counts": {
        "additionalProperties": {
          "type": "integer"
        },
        "title": "Object Counts",
        "type": "object"
      },
      "package_sha256": {
        "title": "Package Sha256",
        "type": "string"
      },
      "schema_head": {
        "title": "Schema Head",
        "type": "string"
      },
      "sha256": {
        "title": "Sha256",
        "type": "string"
      }
    },
    "required": [
      "id",
      "filename",
      "sha256",
      "package_sha256",
      "byte_size",
      "schema_head",
      "object_counts",
      "created_at"
    ],
    "title": "BackupFileRead",
    "type": "object"
  },
  "BackupPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/BackupRead"
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
    "title": "BackupPage",
    "type": "object"
  },
  "BackupRead": {
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
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
      "file": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/BackupFileRead"
          },
          {
            "type": "null"
          }
        ]
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
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
      "job_id",
      "project_id",
      "status",
      "attempt",
      "source_job_id",
      "error_code",
      "file",
      "created_at",
      "updated_at"
    ],
    "title": "BackupRead",
    "type": "object"
  },
  "BoardRead": {
    "additionalProperties": false,
    "properties": {
      "board_version": {
        "title": "Board Version",
        "type": "integer"
      },
      "task_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Task Ids",
        "type": "array"
      }
    },
    "required": [
      "board_version",
      "task_ids"
    ],
    "title": "BoardRead",
    "type": "object"
  },
  "ChangeRecordCreate": {
    "additionalProperties": false,
    "description": "``to_version`` omitted means the current version, frozen when the job is created.",
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "format": {
        "enum": [
          "html",
          "markdown"
        ],
        "title": "Format",
        "type": "string"
      },
      "from_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "From Version",
        "type": "integer"
      },
      "to_version": {
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
        "title": "To Version"
      }
    },
    "required": [
      "document_id",
      "from_version",
      "format"
    ],
    "title": "ChangeRecordCreate",
    "type": "object"
  },
  "ChangeRecordInput": {
    "additionalProperties": false,
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "format": {
        "enum": [
          "html",
          "markdown"
        ],
        "title": "Format",
        "type": "string"
      },
      "from_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "From Version",
        "type": "integer"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "to_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "To Version",
        "type": "integer"
      }
    },
    "required": [
      "document_id",
      "from_version",
      "to_version",
      "format"
    ],
    "title": "ChangeRecordInput",
    "type": "object"
  },
  "ChangeRecordResult": {
    "additionalProperties": false,
    "properties": {
      "byte_size": {
        "maximum": 67108864,
        "minimum": 1,
        "title": "Byte Size",
        "type": "integer"
      },
      "content_type": {
        "enum": [
          "text/html; charset=utf-8",
          "text/plain; charset=utf-8",
          "text/markdown; charset=utf-8",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/pdf"
        ],
        "title": "Content Type",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "file_id": {
        "format": "uuid",
        "title": "File Id",
        "type": "string"
      },
      "filename": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Filename",
        "type": "string"
      },
      "format": {
        "enum": [
          "html",
          "markdown"
        ],
        "title": "Format",
        "type": "string"
      },
      "from_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "From Version",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "change_record",
        "title": "Kind",
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
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Sha256",
        "type": "string"
      },
      "to_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "To Version",
        "type": "integer"
      },
      "version_count": {
        "maximum": 200,
        "minimum": 1,
        "title": "Version Count",
        "type": "integer"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "schema_version",
      "job_id",
      "project_id",
      "document_id",
      "file_id",
      "filename",
      "content_type",
      "sha256",
      "byte_size",
      "model_used",
      "writes_performed",
      "kind",
      "from_version",
      "to_version",
      "format",
      "version_count"
    ],
    "title": "ChangeRecordResult",
    "type": "object"
  },
  "ChapterCorrection": {
    "additionalProperties": false,
    "properties": {
      "anchor_id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Anchor Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "heading",
          "paragraph"
        ],
        "title": "Kind",
        "type": "string"
      },
      "level": {
        "anyOf": [
          {
            "maximum": 6,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Level"
      }
    },
    "required": [
      "anchor_id",
      "kind"
    ],
    "title": "ChapterCorrection",
    "type": "object"
  },
  "ChapterRef": {
    "additionalProperties": false,
    "properties": {
      "chapter_id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Chapter Id",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
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
      "version",
      "chapter_id"
    ],
    "title": "ChapterRef",
    "type": "object"
  },
  "CitationApply": {
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
    "title": "CitationApply",
    "type": "object"
  },
  "CitationCandidatePage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/CitationCandidateRead"
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
    "title": "CitationCandidatePage",
    "type": "object"
  },
  "CitationCandidateRead": {
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
        "title": "Document Version",
        "type": "integer"
      },
      "entry": {
        "$ref": "#/components/schemas/CitationEntrySummary"
      },
      "entry_version": {
        "title": "Entry Version",
        "type": "integer"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "number": {
        "title": "Number",
        "type": "integer"
      },
      "placement": {
        "$ref": "#/components/schemas/CitationPlacement"
      },
      "policy_version": {
        "title": "Policy Version",
        "type": "string"
      },
      "preview": {
        "$ref": "#/components/schemas/CitationPreview"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "result_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Version"
      },
      "revision": {
        "title": "Revision",
        "type": "integer"
      },
      "stale": {
        "title": "Stale",
        "type": "boolean"
      },
      "status": {
        "enum": [
          "ready",
          "applied",
          "rejected",
          "undone"
        ],
        "title": "Status",
        "type": "string"
      },
      "undoable": {
        "title": "Undoable",
        "type": "boolean"
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
      "entry",
      "entry_version",
      "placement",
      "number",
      "status",
      "revision",
      "policy_version",
      "preview",
      "result_version",
      "applicable",
      "stale",
      "application_command_id",
      "undoable",
      "created_at",
      "updated_at"
    ],
    "title": "CitationCandidateRead",
    "type": "object"
  },
  "CitationChange": {
    "description": "One body change: a new or renumbered marker, a rewritten/new reference, a heading.",
    "properties": {
      "after": {
        "title": "After",
        "type": "string"
      },
      "before": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Before"
      },
      "end": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "End"
      },
      "kind": {
        "enum": [
          "marker",
          "marker_renumber",
          "reference",
          "reference_new",
          "heading_new"
        ],
        "title": "Kind",
        "type": "string"
      },
      "node": {
        "title": "Node",
        "type": "string"
      },
      "start": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      }
    },
    "required": [
      "kind",
      "node",
      "after"
    ],
    "title": "CitationChange",
    "type": "object"
  },
  "CitationCreate": {
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
      "entry_id": {
        "format": "uuid",
        "title": "Entry Id",
        "type": "string"
      },
      "placement": {
        "$ref": "#/components/schemas/CitationPlacement"
      }
    },
    "required": [
      "command_id",
      "base_version",
      "entry_id",
      "placement"
    ],
    "title": "CitationCreate",
    "type": "object"
  },
  "CitationEntrySummary": {
    "properties": {
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "removed": {
        "title": "Removed",
        "type": "boolean"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "id",
      "title",
      "removed"
    ],
    "title": "CitationEntrySummary",
    "type": "object"
  },
  "CitationHeadingPreview": {
    "properties": {
      "new": {
        "title": "New",
        "type": "boolean"
      },
      "node": {
        "title": "Node",
        "type": "string"
      }
    },
    "required": [
      "node",
      "new"
    ],
    "title": "CitationHeadingPreview",
    "type": "object"
  },
  "CitationListRead": {
    "description": "Managed citations of one stored version, numbered by first appearance.",
    "properties": {
      "consistent": {
        "title": "Consistent",
        "type": "boolean"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "title": "Document Version",
        "type": "integer"
      },
      "items": {
        "items": {
          "$ref": "#/components/schemas/CitedEntryRead"
        },
        "title": "Items",
        "type": "array"
      },
      "references_heading": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "References Heading"
      },
      "schema_version": {
        "enum": [
          1,
          2
        ],
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "schema_version",
      "references_heading",
      "consistent",
      "items"
    ],
    "title": "CitationListRead",
    "type": "object"
  },
  "CitationMarkerPreview": {
    "properties": {
      "node": {
        "title": "Node",
        "type": "string"
      },
      "offset": {
        "title": "Offset",
        "type": "integer"
      },
      "text": {
        "title": "Text",
        "type": "string"
      }
    },
    "required": [
      "node",
      "offset",
      "text"
    ],
    "title": "CitationMarkerPreview",
    "type": "object"
  },
  "CitationMarkerRead": {
    "properties": {
      "end": {
        "title": "End",
        "type": "integer"
      },
      "node": {
        "title": "Node",
        "type": "string"
      },
      "protection_id": {
        "title": "Protection Id",
        "type": "string"
      },
      "start": {
        "title": "Start",
        "type": "integer"
      }
    },
    "required": [
      "protection_id",
      "node",
      "start",
      "end"
    ],
    "title": "CitationMarkerRead",
    "type": "object"
  },
  "CitationPlacement": {
    "additionalProperties": false,
    "description": "Collapsed cursor in a v2 body paragraph; ``offset`` counts Unicode scalars.",
    "properties": {
      "node_id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Node Id",
        "type": "string"
      },
      "offset": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Offset",
        "type": "integer"
      }
    },
    "required": [
      "node_id",
      "offset"
    ],
    "title": "CitationPlacement",
    "type": "object"
  },
  "CitationPreview": {
    "properties": {
      "changes": {
        "items": {
          "$ref": "#/components/schemas/CitationChange"
        },
        "title": "Changes",
        "type": "array"
      },
      "entry_id": {
        "format": "uuid",
        "title": "Entry Id",
        "type": "string"
      },
      "heading": {
        "$ref": "#/components/schemas/CitationHeadingPreview"
      },
      "marker": {
        "$ref": "#/components/schemas/CitationMarkerPreview"
      },
      "number": {
        "title": "Number",
        "type": "integer"
      },
      "reference": {
        "$ref": "#/components/schemas/CitationReferencePreview"
      },
      "renumbered": {
        "items": {
          "$ref": "#/components/schemas/CitationRenumber"
        },
        "title": "Renumbered",
        "type": "array"
      },
      "reused": {
        "title": "Reused",
        "type": "boolean"
      }
    },
    "required": [
      "entry_id",
      "number",
      "reused",
      "marker",
      "reference",
      "heading",
      "renumbered",
      "changes"
    ],
    "title": "CitationPreview",
    "type": "object"
  },
  "CitationReferencePreview": {
    "properties": {
      "new": {
        "title": "New",
        "type": "boolean"
      },
      "node": {
        "title": "Node",
        "type": "string"
      },
      "text": {
        "title": "Text",
        "type": "string"
      }
    },
    "required": [
      "node",
      "new",
      "text"
    ],
    "title": "CitationReferencePreview",
    "type": "object"
  },
  "CitationReject": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
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
      "expected_revision"
    ],
    "title": "CitationReject",
    "type": "object"
  },
  "CitationRenumber": {
    "properties": {
      "after": {
        "title": "After",
        "type": "integer"
      },
      "before": {
        "title": "Before",
        "type": "integer"
      },
      "entry_id": {
        "format": "uuid",
        "title": "Entry Id",
        "type": "string"
      }
    },
    "required": [
      "entry_id",
      "before",
      "after"
    ],
    "title": "CitationRenumber",
    "type": "object"
  },
  "CitationUndo": {
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
    "title": "CitationUndo",
    "type": "object"
  },
  "CitedEntryRead": {
    "properties": {
      "entry_id": {
        "format": "uuid",
        "title": "Entry Id",
        "type": "string"
      },
      "markers": {
        "items": {
          "$ref": "#/components/schemas/CitationMarkerRead"
        },
        "title": "Markers",
        "type": "array"
      },
      "number": {
        "title": "Number",
        "type": "integer"
      },
      "reference_node": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Reference Node"
      },
      "reference_text": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Reference Text"
      },
      "removed": {
        "title": "Removed",
        "type": "boolean"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "entry_id",
      "number",
      "title",
      "removed",
      "reference_node",
      "reference_text",
      "markers"
    ],
    "title": "CitedEntryRead",
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
  "ContentRevisionInput": {
    "additionalProperties": false,
    "properties": {
      "run_id": {
        "format": "uuid",
        "title": "Run Id",
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
      "run_id"
    ],
    "title": "ContentRevisionInput",
    "type": "object"
  },
  "ContentRevisionResult": {
    "additionalProperties": false,
    "description": "Only references; private assistant text stays in its project-scoped session.",
    "properties": {
      "assistant_message_id": {
        "format": "uuid",
        "title": "Assistant Message Id",
        "type": "string"
      },
      "candidate_id": {
        "format": "uuid",
        "title": "Candidate Id",
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "content_revision",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": true,
        "title": "Model Used",
        "type": "boolean"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requested_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Requested Model",
        "type": "string"
      },
      "response_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Response Model",
        "type": "string"
      },
      "run_id": {
        "format": "uuid",
        "title": "Run Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "session_id": {
        "format": "uuid",
        "title": "Session Id",
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
      "schema_version",
      "job_id",
      "project_id",
      "run_id",
      "session_id",
      "document_id",
      "document_version",
      "assistant_message_id",
      "candidate_id",
      "requested_model",
      "response_model",
      "model_used",
      "writes_performed"
    ],
    "title": "ContentRevisionResult",
    "type": "object"
  },
  "CurrentStageRead": {
    "additionalProperties": false,
    "properties": {
      "confirmation_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Confirmation Id"
      },
      "confirmed": {
        "title": "Confirmed",
        "type": "boolean"
      },
      "deliverables": {
        "items": {
          "$ref": "#/components/schemas/DeliverableFact"
        },
        "title": "Deliverables",
        "type": "array"
      },
      "entered_at": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Entered At"
      },
      "next_stages": {
        "items": {
          "$ref": "#/components/schemas/StageOption"
        },
        "title": "Next Stages",
        "type": "array"
      },
      "prerequisites": {
        "items": {
          "$ref": "#/components/schemas/StagePrerequisite"
        },
        "title": "Prerequisites",
        "type": "array"
      },
      "prerequisites_met": {
        "title": "Prerequisites Met",
        "type": "boolean"
      },
      "stage": {
        "$ref": "#/components/schemas/FlowStage"
      }
    },
    "required": [
      "stage",
      "confirmed",
      "confirmation_id",
      "entered_at",
      "prerequisites",
      "prerequisites_met",
      "deliverables",
      "next_stages"
    ],
    "title": "CurrentStageRead",
    "type": "object"
  },
  "DateRange": {
    "additionalProperties": false,
    "properties": {
      "due_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Due Date"
      },
      "start_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start Date"
      }
    },
    "required": [
      "start_date",
      "due_date"
    ],
    "title": "DateRange",
    "type": "object"
  },
  "DeliverableFact": {
    "additionalProperties": false,
    "description": "Read-only facts. A matching task or material never confirms the stage.",
    "properties": {
      "material_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Material Ids",
        "type": "array"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "status": {
        "enum": [
          "confirmed_task",
          "material",
          "none"
        ],
        "title": "Status",
        "type": "string"
      },
      "task_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Task Ids",
        "type": "array"
      }
    },
    "required": [
      "name",
      "status",
      "task_ids",
      "material_ids"
    ],
    "title": "DeliverableFact",
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
  "DocsAnchorPos": {
    "additionalProperties": false,
    "properties": {
      "align": {
        "anyOf": [
          {
            "enum": [
              "start",
              "center",
              "end"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Align"
      },
      "from": {
        "enum": [
          "page",
          "margin"
        ],
        "title": "From",
        "type": "string"
      },
      "offset": {
        "default": 0,
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Offset",
        "type": "integer"
      }
    },
    "required": [
      "from"
    ],
    "title": "DocsAnchorPos",
    "type": "object"
  },
  "DocsAutoColor": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "auto",
        "title": "Kind",
        "type": "string"
      }
    },
    "required": [
      "kind"
    ],
    "title": "DocsAutoColor",
    "type": "object"
  },
  "DocsBookmarkInline": {
    "additionalProperties": false,
    "properties": {
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      },
      "type": {
        "const": "bookmark",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "name"
    ],
    "title": "DocsBookmarkInline",
    "type": "object"
  },
  "DocsBorder": {
    "additionalProperties": false,
    "properties": {
      "color": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "auto": "#/components/schemas/DocsAutoColor",
                "rgb": "#/components/schemas/DocsRgbColor",
                "theme": "#/components/schemas/DocsThemeColorValue"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsRgbColor"
              },
              {
                "$ref": "#/components/schemas/DocsThemeColorValue"
              },
              {
                "$ref": "#/components/schemas/DocsAutoColor"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Color"
      },
      "style": {
        "enum": [
          "none",
          "single",
          "double",
          "dashed",
          "dotted"
        ],
        "title": "Style",
        "type": "string"
      },
      "width": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Width"
      }
    },
    "required": [
      "style"
    ],
    "title": "DocsBorder",
    "type": "object"
  },
  "DocsBorders": {
    "additionalProperties": false,
    "properties": {
      "bottom": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      },
      "insideH": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      },
      "insideV": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      },
      "left": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      },
      "right": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      },
      "top": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorder"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "title": "DocsBorders",
    "type": "object"
  },
  "DocsBreakInline": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "default": "line",
        "enum": [
          "line",
          "column"
        ],
        "title": "Kind",
        "type": "string"
      },
      "type": {
        "const": "break",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type"
    ],
    "title": "DocsBreakInline",
    "type": "object"
  },
  "DocsCellProps": {
    "additionalProperties": false,
    "properties": {
      "borders": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorders"
          },
          {
            "type": "null"
          }
        ]
      },
      "shading": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "auto": "#/components/schemas/DocsAutoColor",
                "rgb": "#/components/schemas/DocsRgbColor",
                "theme": "#/components/schemas/DocsThemeColorValue"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsRgbColor"
              },
              {
                "$ref": "#/components/schemas/DocsThemeColorValue"
              },
              {
                "$ref": "#/components/schemas/DocsAutoColor"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Shading"
      },
      "valign": {
        "anyOf": [
          {
            "enum": [
              "top",
              "center",
              "bottom"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Valign"
      },
      "width": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Width"
      }
    },
    "title": "DocsCellProps",
    "type": "object"
  },
  "DocsChapter": {
    "additionalProperties": false,
    "description": "Derived outline entry; same rule as the editor's ``deriveChapters``.",
    "properties": {
      "block": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Block",
        "type": "integer"
      },
      "end": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "End",
        "type": "integer"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "level": {
        "maximum": 6,
        "minimum": 1,
        "title": "Level",
        "type": "integer"
      },
      "title": {
        "title": "Title",
        "type": "string"
      },
      "words": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Words",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "level",
      "title",
      "block",
      "end",
      "words"
    ],
    "title": "DocsChapter",
    "type": "object"
  },
  "DocsCodeBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "lang": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Lang"
      },
      "text": {
        "title": "Text",
        "type": "string"
      },
      "type": {
        "const": "code_block",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "text"
    ],
    "title": "DocsCodeBlock",
    "type": "object"
  },
  "DocsDocGrid": {
    "additionalProperties": false,
    "properties": {
      "charSpace": {
        "anyOf": [
          {
            "maximum": 2147483647,
            "minimum": -2147483648,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Charspace"
      },
      "kind": {
        "enum": [
          "lines",
          "lines_and_chars",
          "snap_to_chars"
        ],
        "title": "Kind",
        "type": "string"
      },
      "linePitch": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Linepitch",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "linePitch"
    ],
    "title": "DocsDocGrid",
    "type": "object"
  },
  "DocsEmuWidth": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "emu",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Value",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsEmuWidth",
    "type": "object"
  },
  "DocsFieldInline": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "enum": [
          "page_number",
          "num_pages",
          "date",
          "title",
          "author"
        ],
        "title": "Kind",
        "type": "string"
      },
      "type": {
        "const": "field",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "kind"
    ],
    "title": "DocsFieldInline",
    "type": "object"
  },
  "DocsHeaderFooter": {
    "additionalProperties": false,
    "properties": {
      "blocks": {
        "items": {
          "discriminator": {
            "mapping": {
              "code_block": "#/components/schemas/DocsCodeBlock",
              "heading": "#/components/schemas/DocsHeadingBlock",
              "image": "#/components/schemas/DocsImageBlock",
              "list": "#/components/schemas/DocsListBlock",
              "page_break": "#/components/schemas/DocsPageBreakBlock",
              "paragraph": "#/components/schemas/DocsParagraphBlock",
              "quote": "#/components/schemas/DocsQuoteBlock",
              "rule": "#/components/schemas/DocsRuleBlock",
              "table": "#/components/schemas/DocsTableBlock",
              "toc": "#/components/schemas/DocsTocBlock"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsParagraphBlock"
            },
            {
              "$ref": "#/components/schemas/DocsHeadingBlock"
            },
            {
              "$ref": "#/components/schemas/DocsListBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTableBlock"
            },
            {
              "$ref": "#/components/schemas/DocsImageBlock"
            },
            {
              "$ref": "#/components/schemas/DocsCodeBlock"
            },
            {
              "$ref": "#/components/schemas/DocsQuoteBlock"
            },
            {
              "$ref": "#/components/schemas/DocsPageBreakBlock"
            },
            {
              "$ref": "#/components/schemas/DocsRuleBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTocBlock"
            }
          ]
        },
        "title": "Blocks",
        "type": "array"
      },
      "evenPage": {
        "anyOf": [
          {
            "items": {
              "discriminator": {
                "mapping": {
                  "code_block": "#/components/schemas/DocsCodeBlock",
                  "heading": "#/components/schemas/DocsHeadingBlock",
                  "image": "#/components/schemas/DocsImageBlock",
                  "list": "#/components/schemas/DocsListBlock",
                  "page_break": "#/components/schemas/DocsPageBreakBlock",
                  "paragraph": "#/components/schemas/DocsParagraphBlock",
                  "quote": "#/components/schemas/DocsQuoteBlock",
                  "rule": "#/components/schemas/DocsRuleBlock",
                  "table": "#/components/schemas/DocsTableBlock",
                  "toc": "#/components/schemas/DocsTocBlock"
                },
                "propertyName": "type"
              },
              "oneOf": [
                {
                  "$ref": "#/components/schemas/DocsParagraphBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsHeadingBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsListBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsTableBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsImageBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsCodeBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsQuoteBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsPageBreakBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsRuleBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsTocBlock"
                }
              ]
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Evenpage"
      },
      "firstPage": {
        "anyOf": [
          {
            "items": {
              "discriminator": {
                "mapping": {
                  "code_block": "#/components/schemas/DocsCodeBlock",
                  "heading": "#/components/schemas/DocsHeadingBlock",
                  "image": "#/components/schemas/DocsImageBlock",
                  "list": "#/components/schemas/DocsListBlock",
                  "page_break": "#/components/schemas/DocsPageBreakBlock",
                  "paragraph": "#/components/schemas/DocsParagraphBlock",
                  "quote": "#/components/schemas/DocsQuoteBlock",
                  "rule": "#/components/schemas/DocsRuleBlock",
                  "table": "#/components/schemas/DocsTableBlock",
                  "toc": "#/components/schemas/DocsTocBlock"
                },
                "propertyName": "type"
              },
              "oneOf": [
                {
                  "$ref": "#/components/schemas/DocsParagraphBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsHeadingBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsListBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsTableBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsImageBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsCodeBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsQuoteBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsPageBreakBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsRuleBlock"
                },
                {
                  "$ref": "#/components/schemas/DocsTocBlock"
                }
              ]
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Firstpage"
      }
    },
    "title": "DocsHeaderFooter",
    "type": "object"
  },
  "DocsHeadingBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "inlines": {
        "items": {
          "discriminator": {
            "mapping": {
              "bookmark": "#/components/schemas/DocsBookmarkInline",
              "break": "#/components/schemas/DocsBreakInline",
              "field": "#/components/schemas/DocsFieldInline",
              "image": "#/components/schemas/DocsImageInline",
              "run": "#/components/schemas/DocsRunInline",
              "tab": "#/components/schemas/DocsTabInline"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsRunInline"
            },
            {
              "$ref": "#/components/schemas/DocsBreakInline"
            },
            {
              "$ref": "#/components/schemas/DocsTabInline"
            },
            {
              "$ref": "#/components/schemas/DocsImageInline"
            },
            {
              "$ref": "#/components/schemas/DocsFieldInline"
            },
            {
              "$ref": "#/components/schemas/DocsBookmarkInline"
            }
          ]
        },
        "title": "Inlines",
        "type": "array"
      },
      "level": {
        "maximum": 6,
        "minimum": 1,
        "title": "Level",
        "type": "integer"
      },
      "props": {
        "$ref": "#/components/schemas/DocsParaProps"
      },
      "type": {
        "const": "heading",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "level",
      "inlines"
    ],
    "title": "DocsHeadingBlock",
    "type": "object"
  },
  "DocsImageAnchor": {
    "additionalProperties": false,
    "properties": {
      "behindText": {
        "default": false,
        "title": "Behindtext",
        "type": "boolean"
      },
      "x": {
        "$ref": "#/components/schemas/DocsAnchorPos"
      },
      "y": {
        "$ref": "#/components/schemas/DocsAnchorPos"
      }
    },
    "required": [
      "x",
      "y"
    ],
    "title": "DocsImageAnchor",
    "type": "object"
  },
  "DocsImageBlock": {
    "additionalProperties": false,
    "properties": {
      "align": {
        "anyOf": [
          {
            "enum": [
              "start",
              "center",
              "end",
              "justify",
              "distributed"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Align"
      },
      "alt": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Alt"
      },
      "caption": {
        "anyOf": [
          {
            "items": {
              "discriminator": {
                "mapping": {
                  "bookmark": "#/components/schemas/DocsBookmarkInline",
                  "break": "#/components/schemas/DocsBreakInline",
                  "field": "#/components/schemas/DocsFieldInline",
                  "image": "#/components/schemas/DocsImageInline",
                  "run": "#/components/schemas/DocsRunInline",
                  "tab": "#/components/schemas/DocsTabInline"
                },
                "propertyName": "type"
              },
              "oneOf": [
                {
                  "$ref": "#/components/schemas/DocsRunInline"
                },
                {
                  "$ref": "#/components/schemas/DocsBreakInline"
                },
                {
                  "$ref": "#/components/schemas/DocsTabInline"
                },
                {
                  "$ref": "#/components/schemas/DocsImageInline"
                },
                {
                  "$ref": "#/components/schemas/DocsFieldInline"
                },
                {
                  "$ref": "#/components/schemas/DocsBookmarkInline"
                }
              ]
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Caption"
      },
      "height": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Height"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "resource": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Resource",
        "type": "string"
      },
      "type": {
        "const": "image",
        "title": "Type",
        "type": "string"
      },
      "width": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Width"
      }
    },
    "required": [
      "type",
      "id",
      "resource"
    ],
    "title": "DocsImageBlock",
    "type": "object"
  },
  "DocsImageInline": {
    "additionalProperties": false,
    "properties": {
      "alt": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Alt"
      },
      "anchor": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsImageAnchor"
          },
          {
            "type": "null"
          }
        ]
      },
      "height": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Height"
      },
      "resource": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Resource",
        "type": "string"
      },
      "title": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Title"
      },
      "type": {
        "const": "image",
        "title": "Type",
        "type": "string"
      },
      "width": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Width"
      }
    },
    "required": [
      "type",
      "resource"
    ],
    "title": "DocsImageInline",
    "type": "object"
  },
  "DocsIndent": {
    "additionalProperties": false,
    "properties": {
      "end": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "End"
      },
      "endChars": {
        "anyOf": [
          {
            "maximum": 2147483647,
            "minimum": -2147483648,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Endchars"
      },
      "firstLine": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Firstline"
      },
      "firstLineChars": {
        "anyOf": [
          {
            "maximum": 2147483647,
            "minimum": -2147483648,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Firstlinechars"
      },
      "hanging": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Hanging"
      },
      "start": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      },
      "startChars": {
        "anyOf": [
          {
            "maximum": 2147483647,
            "minimum": -2147483648,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Startchars"
      }
    },
    "title": "DocsIndent",
    "type": "object"
  },
  "DocsInlineProps": {
    "additionalProperties": false,
    "properties": {
      "bold": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Bold"
      },
      "code": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Code"
      },
      "color": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "auto": "#/components/schemas/DocsAutoColor",
                "rgb": "#/components/schemas/DocsRgbColor",
                "theme": "#/components/schemas/DocsThemeColorValue"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsRgbColor"
              },
              {
                "$ref": "#/components/schemas/DocsThemeColorValue"
              },
              {
                "$ref": "#/components/schemas/DocsAutoColor"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Color"
      },
      "font": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "named": "#/components/schemas/DocsNamedFontRef",
                "theme": "#/components/schemas/DocsThemeFontRef"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsThemeFontRef"
              },
              {
                "$ref": "#/components/schemas/DocsNamedFontRef"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Font"
      },
      "fontEastAsia": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "named": "#/components/schemas/DocsNamedFontRef",
                "theme": "#/components/schemas/DocsThemeFontRef"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsThemeFontRef"
              },
              {
                "$ref": "#/components/schemas/DocsNamedFontRef"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Fonteastasia"
      },
      "highlight": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "auto": "#/components/schemas/DocsAutoColor",
                "rgb": "#/components/schemas/DocsRgbColor",
                "theme": "#/components/schemas/DocsThemeColorValue"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsRgbColor"
              },
              {
                "$ref": "#/components/schemas/DocsThemeColorValue"
              },
              {
                "$ref": "#/components/schemas/DocsAutoColor"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Highlight"
      },
      "italic": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Italic"
      },
      "lang": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Lang"
      },
      "letterSpacing": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Letterspacing"
      },
      "link": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsLink"
          },
          {
            "type": "null"
          }
        ]
      },
      "size": {
        "anyOf": [
          {
            "maximum": 4294967295,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Size"
      },
      "strike": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Strike"
      },
      "style": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Style"
      },
      "underline": {
        "anyOf": [
          {
            "enum": [
              "none",
              "single",
              "double",
              "dotted",
              "dashed",
              "wavy"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Underline"
      },
      "verticalAlign": {
        "anyOf": [
          {
            "enum": [
              "baseline",
              "superscript",
              "subscript"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Verticalalign"
      }
    },
    "title": "DocsInlineProps",
    "type": "object"
  },
  "DocsLineAtLeast": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "at_least",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Value",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsLineAtLeast",
    "type": "object"
  },
  "DocsLineExact": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "exact",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Value",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsLineExact",
    "type": "object"
  },
  "DocsLineMultiple": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "multiple",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maximum": 4294967295,
        "minimum": 0,
        "title": "Value",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsLineMultiple",
    "type": "object"
  },
  "DocsLink": {
    "additionalProperties": false,
    "properties": {
      "href": {
        "maxLength": 4096,
        "minLength": 1,
        "title": "Href",
        "type": "string"
      },
      "title": {
        "anyOf": [
          {
            "maxLength": 4096,
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
      "href"
    ],
    "title": "DocsLink",
    "type": "object"
  },
  "DocsListBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "items": {
        "items": {
          "$ref": "#/components/schemas/DocsListItem"
        },
        "title": "Items",
        "type": "array"
      },
      "kind": {
        "enum": [
          "bullet",
          "decimal",
          "lower_alpha",
          "upper_alpha",
          "lower_roman",
          "upper_roman",
          "chinese_counting",
          "chinese_paren",
          "task",
          "decimal_enclosed_circle"
        ],
        "title": "Kind",
        "type": "string"
      },
      "numbering": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Numbering"
      },
      "start": {
        "anyOf": [
          {
            "maximum": 4294967295,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      },
      "type": {
        "const": "list",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "kind",
      "items"
    ],
    "title": "DocsListBlock",
    "type": "object"
  },
  "DocsListItem": {
    "additionalProperties": false,
    "properties": {
      "blocks": {
        "items": {
          "discriminator": {
            "mapping": {
              "code_block": "#/components/schemas/DocsCodeBlock",
              "heading": "#/components/schemas/DocsHeadingBlock",
              "image": "#/components/schemas/DocsImageBlock",
              "list": "#/components/schemas/DocsListBlock",
              "page_break": "#/components/schemas/DocsPageBreakBlock",
              "paragraph": "#/components/schemas/DocsParagraphBlock",
              "quote": "#/components/schemas/DocsQuoteBlock",
              "rule": "#/components/schemas/DocsRuleBlock",
              "table": "#/components/schemas/DocsTableBlock",
              "toc": "#/components/schemas/DocsTocBlock"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsParagraphBlock"
            },
            {
              "$ref": "#/components/schemas/DocsHeadingBlock"
            },
            {
              "$ref": "#/components/schemas/DocsListBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTableBlock"
            },
            {
              "$ref": "#/components/schemas/DocsImageBlock"
            },
            {
              "$ref": "#/components/schemas/DocsCodeBlock"
            },
            {
              "$ref": "#/components/schemas/DocsQuoteBlock"
            },
            {
              "$ref": "#/components/schemas/DocsPageBreakBlock"
            },
            {
              "$ref": "#/components/schemas/DocsRuleBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTocBlock"
            }
          ]
        },
        "title": "Blocks",
        "type": "array"
      },
      "checked": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Checked"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "blocks"
    ],
    "title": "DocsListItem",
    "type": "object"
  },
  "DocsListLabel": {
    "additionalProperties": false,
    "properties": {
      "level": {
        "default": 0,
        "maximum": 255,
        "minimum": 0,
        "title": "Level",
        "type": "integer"
      },
      "run": {
        "$ref": "#/components/schemas/DocsInlineProps"
      },
      "suffix": {
        "anyOf": [
          {
            "enum": [
              "tab",
              "space",
              "nothing"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Suffix"
      },
      "text": {
        "default": "",
        "maxLength": 4096,
        "title": "Text",
        "type": "string"
      }
    },
    "title": "DocsListLabel",
    "type": "object"
  },
  "DocsMargins": {
    "additionalProperties": false,
    "properties": {
      "bottom": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Bottom",
        "type": "integer"
      },
      "footer": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Footer"
      },
      "gutter": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Gutter"
      },
      "header": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Header"
      },
      "left": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Left",
        "type": "integer"
      },
      "right": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Right",
        "type": "integer"
      },
      "top": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Top",
        "type": "integer"
      }
    },
    "required": [
      "top",
      "bottom",
      "left",
      "right"
    ],
    "title": "DocsMargins",
    "type": "object"
  },
  "DocsMeta": {
    "additionalProperties": false,
    "properties": {
      "author": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Author"
      },
      "custom": {
        "additionalProperties": {
          "maxLength": 4096,
          "type": "string"
        },
        "maxProperties": 200,
        "title": "Custom",
        "type": "object"
      },
      "date": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Date"
      },
      "keywords": {
        "items": {
          "maxLength": 4096,
          "type": "string"
        },
        "maxItems": 200,
        "title": "Keywords",
        "type": "array"
      },
      "lang": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Lang"
      },
      "subtitle": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Subtitle"
      },
      "title": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Title"
      }
    },
    "title": "DocsMeta",
    "type": "object"
  },
  "DocsModel": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "const": "docs",
        "title": "Kind",
        "type": "string"
      },
      "meta": {
        "$ref": "#/components/schemas/DocsMeta"
      },
      "resources": {
        "items": {
          "$ref": "#/components/schemas/DocsResource"
        },
        "maxItems": 2000,
        "title": "Resources",
        "type": "array"
      },
      "schemaVersion": {
        "const": 1,
        "title": "Schemaversion",
        "type": "integer"
      },
      "sections": {
        "items": {
          "$ref": "#/components/schemas/DocsSection"
        },
        "maxItems": 1000,
        "minItems": 1,
        "title": "Sections",
        "type": "array"
      },
      "theme": {
        "$ref": "#/components/schemas/DocsThemeRef"
      },
      "unsupported": {
        "items": {
          "$ref": "#/components/schemas/DocsUnsupported"
        },
        "maxItems": 10000,
        "title": "Unsupported",
        "type": "array"
      }
    },
    "required": [
      "kind",
      "schemaVersion",
      "id",
      "theme",
      "sections"
    ],
    "title": "DocsModel",
    "type": "object"
  },
  "DocsNamedFontRef": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "named",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Value",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsNamedFontRef",
    "type": "object"
  },
  "DocsPageBreakBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "type": {
        "const": "page_break",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id"
    ],
    "title": "DocsPageBreakBlock",
    "type": "object"
  },
  "DocsPageProps": {
    "additionalProperties": false,
    "properties": {
      "columns": {
        "anyOf": [
          {
            "maximum": 255,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Columns"
      },
      "grid": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsDocGrid"
          },
          {
            "type": "null"
          }
        ]
      },
      "margins": {
        "$ref": "#/components/schemas/DocsMargins"
      },
      "orientation": {
        "enum": [
          "portrait",
          "landscape"
        ],
        "title": "Orientation",
        "type": "string"
      },
      "size": {
        "$ref": "#/components/schemas/DocsPageSize"
      }
    },
    "required": [
      "size",
      "orientation",
      "margins"
    ],
    "title": "DocsPageProps",
    "type": "object"
  },
  "DocsPageSize": {
    "additionalProperties": false,
    "properties": {
      "height": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Height",
        "type": "integer"
      },
      "width": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Width",
        "type": "integer"
      }
    },
    "required": [
      "width",
      "height"
    ],
    "title": "DocsPageSize",
    "type": "object"
  },
  "DocsParaProps": {
    "additionalProperties": false,
    "properties": {
      "adjustRightInd": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Adjustrightind"
      },
      "align": {
        "anyOf": [
          {
            "enum": [
              "start",
              "center",
              "end",
              "justify",
              "distributed"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Align"
      },
      "autoSpaceDe": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Autospacede"
      },
      "autoSpaceDn": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Autospacedn"
      },
      "borders": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorders"
          },
          {
            "type": "null"
          }
        ]
      },
      "indent": {
        "$ref": "#/components/schemas/DocsIndent"
      },
      "keepLines": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Keeplines"
      },
      "keepWithNext": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Keepwithnext"
      },
      "kinsoku": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Kinsoku"
      },
      "listLabel": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsListLabel"
          },
          {
            "type": "null"
          }
        ]
      },
      "outlineLevel": {
        "anyOf": [
          {
            "maximum": 255,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Outlinelevel"
      },
      "overflowPunct": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Overflowpunct"
      },
      "pageBreakBefore": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Pagebreakbefore"
      },
      "run": {
        "$ref": "#/components/schemas/DocsInlineProps"
      },
      "shading": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "auto": "#/components/schemas/DocsAutoColor",
                "rgb": "#/components/schemas/DocsRgbColor",
                "theme": "#/components/schemas/DocsThemeColorValue"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsRgbColor"
              },
              {
                "$ref": "#/components/schemas/DocsThemeColorValue"
              },
              {
                "$ref": "#/components/schemas/DocsAutoColor"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Shading"
      },
      "snapToGrid": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Snaptogrid"
      },
      "spacing": {
        "$ref": "#/components/schemas/DocsSpacing"
      },
      "style": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Style"
      },
      "tabs": {
        "items": {
          "$ref": "#/components/schemas/DocsTabStop"
        },
        "maxItems": 64,
        "title": "Tabs",
        "type": "array"
      },
      "topLinePunct": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Toplinepunct"
      },
      "widowControl": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Widowcontrol"
      }
    },
    "title": "DocsParaProps",
    "type": "object"
  },
  "DocsParagraphBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "inlines": {
        "items": {
          "discriminator": {
            "mapping": {
              "bookmark": "#/components/schemas/DocsBookmarkInline",
              "break": "#/components/schemas/DocsBreakInline",
              "field": "#/components/schemas/DocsFieldInline",
              "image": "#/components/schemas/DocsImageInline",
              "run": "#/components/schemas/DocsRunInline",
              "tab": "#/components/schemas/DocsTabInline"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsRunInline"
            },
            {
              "$ref": "#/components/schemas/DocsBreakInline"
            },
            {
              "$ref": "#/components/schemas/DocsTabInline"
            },
            {
              "$ref": "#/components/schemas/DocsImageInline"
            },
            {
              "$ref": "#/components/schemas/DocsFieldInline"
            },
            {
              "$ref": "#/components/schemas/DocsBookmarkInline"
            }
          ]
        },
        "title": "Inlines",
        "type": "array"
      },
      "props": {
        "$ref": "#/components/schemas/DocsParaProps"
      },
      "type": {
        "const": "paragraph",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "inlines"
    ],
    "title": "DocsParagraphBlock",
    "type": "object"
  },
  "DocsPctWidth": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "pct",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "maximum": 4294967295,
        "minimum": 0,
        "title": "Value",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsPctWidth",
    "type": "object"
  },
  "DocsProtection": {
    "additionalProperties": false,
    "properties": {
      "anchor": {
        "$ref": "#/components/schemas/DocsProtectionAnchor"
      },
      "binding": {
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
        "title": "Binding"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "number",
          "citation",
          "formula",
          "lock",
          "object",
          "source"
        ],
        "title": "Kind",
        "type": "string"
      }
    },
    "required": [
      "id",
      "kind",
      "anchor"
    ],
    "title": "DocsProtection",
    "type": "object"
  },
  "DocsProtectionAnchor": {
    "additionalProperties": false,
    "properties": {
      "end": {
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
        "title": "End"
      },
      "node": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Node",
        "type": "string"
      },
      "start": {
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
        "title": "Start"
      }
    },
    "required": [
      "node"
    ],
    "title": "DocsProtectionAnchor",
    "type": "object"
  },
  "DocsQuoteBlock": {
    "additionalProperties": false,
    "properties": {
      "blocks": {
        "items": {
          "discriminator": {
            "mapping": {
              "code_block": "#/components/schemas/DocsCodeBlock",
              "heading": "#/components/schemas/DocsHeadingBlock",
              "image": "#/components/schemas/DocsImageBlock",
              "list": "#/components/schemas/DocsListBlock",
              "page_break": "#/components/schemas/DocsPageBreakBlock",
              "paragraph": "#/components/schemas/DocsParagraphBlock",
              "quote": "#/components/schemas/DocsQuoteBlock",
              "rule": "#/components/schemas/DocsRuleBlock",
              "table": "#/components/schemas/DocsTableBlock",
              "toc": "#/components/schemas/DocsTocBlock"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsParagraphBlock"
            },
            {
              "$ref": "#/components/schemas/DocsHeadingBlock"
            },
            {
              "$ref": "#/components/schemas/DocsListBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTableBlock"
            },
            {
              "$ref": "#/components/schemas/DocsImageBlock"
            },
            {
              "$ref": "#/components/schemas/DocsCodeBlock"
            },
            {
              "$ref": "#/components/schemas/DocsQuoteBlock"
            },
            {
              "$ref": "#/components/schemas/DocsPageBreakBlock"
            },
            {
              "$ref": "#/components/schemas/DocsRuleBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTocBlock"
            }
          ]
        },
        "title": "Blocks",
        "type": "array"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "type": {
        "const": "quote",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "blocks"
    ],
    "title": "DocsQuoteBlock",
    "type": "object"
  },
  "DocsResource": {
    "additionalProperties": false,
    "properties": {
      "data": {
        "$ref": "#/components/schemas/DocsUriData"
      },
      "heightPx": {
        "anyOf": [
          {
            "maximum": 4294967295,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Heightpx"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "mime": {
        "enum": [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp"
        ],
        "title": "Mime",
        "type": "string"
      },
      "name": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Name"
      },
      "sha256": {
        "anyOf": [
          {
            "pattern": "^[0-9a-f]{64}$",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Sha256"
      },
      "widthPx": {
        "anyOf": [
          {
            "maximum": 4294967295,
            "minimum": 0,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Widthpx"
      }
    },
    "required": [
      "id",
      "mime",
      "data"
    ],
    "title": "DocsResource",
    "type": "object"
  },
  "DocsRgbColor": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "rgb",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "pattern": "^[0-9A-Fa-f]{6}$",
        "title": "Value",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsRgbColor",
    "type": "object"
  },
  "DocsRuleBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "type": {
        "const": "rule",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id"
    ],
    "title": "DocsRuleBlock",
    "type": "object"
  },
  "DocsRunInline": {
    "additionalProperties": false,
    "properties": {
      "props": {
        "$ref": "#/components/schemas/DocsInlineProps"
      },
      "text": {
        "title": "Text",
        "type": "string"
      },
      "type": {
        "const": "run",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "text"
    ],
    "title": "DocsRunInline",
    "type": "object"
  },
  "DocsSection": {
    "additionalProperties": false,
    "properties": {
      "blocks": {
        "items": {
          "discriminator": {
            "mapping": {
              "code_block": "#/components/schemas/DocsCodeBlock",
              "heading": "#/components/schemas/DocsHeadingBlock",
              "image": "#/components/schemas/DocsImageBlock",
              "list": "#/components/schemas/DocsListBlock",
              "page_break": "#/components/schemas/DocsPageBreakBlock",
              "paragraph": "#/components/schemas/DocsParagraphBlock",
              "quote": "#/components/schemas/DocsQuoteBlock",
              "rule": "#/components/schemas/DocsRuleBlock",
              "table": "#/components/schemas/DocsTableBlock",
              "toc": "#/components/schemas/DocsTocBlock"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsParagraphBlock"
            },
            {
              "$ref": "#/components/schemas/DocsHeadingBlock"
            },
            {
              "$ref": "#/components/schemas/DocsListBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTableBlock"
            },
            {
              "$ref": "#/components/schemas/DocsImageBlock"
            },
            {
              "$ref": "#/components/schemas/DocsCodeBlock"
            },
            {
              "$ref": "#/components/schemas/DocsQuoteBlock"
            },
            {
              "$ref": "#/components/schemas/DocsPageBreakBlock"
            },
            {
              "$ref": "#/components/schemas/DocsRuleBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTocBlock"
            }
          ]
        },
        "title": "Blocks",
        "type": "array"
      },
      "breakKind": {
        "anyOf": [
          {
            "enum": [
              "next_page",
              "continuous",
              "even_page",
              "odd_page"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Breakkind"
      },
      "footer": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsHeaderFooter"
          },
          {
            "type": "null"
          }
        ]
      },
      "header": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsHeaderFooter"
          },
          {
            "type": "null"
          }
        ]
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "page": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsPageProps"
          },
          {
            "type": "null"
          }
        ]
      },
      "pageNumberStart": {
        "anyOf": [
          {
            "maximum": 4294967295,
            "minimum": 1,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Pagenumberstart"
      }
    },
    "required": [
      "id",
      "blocks"
    ],
    "title": "DocsSection",
    "type": "object"
  },
  "DocsSpacing": {
    "additionalProperties": false,
    "properties": {
      "after": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "After"
      },
      "before": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Before"
      },
      "line": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "at_least": "#/components/schemas/DocsLineAtLeast",
                "exact": "#/components/schemas/DocsLineExact",
                "multiple": "#/components/schemas/DocsLineMultiple"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsLineMultiple"
              },
              {
                "$ref": "#/components/schemas/DocsLineExact"
              },
              {
                "$ref": "#/components/schemas/DocsLineAtLeast"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Line"
      }
    },
    "title": "DocsSpacing",
    "type": "object"
  },
  "DocsTabInline": {
    "additionalProperties": false,
    "properties": {
      "type": {
        "const": "tab",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type"
    ],
    "title": "DocsTabInline",
    "type": "object"
  },
  "DocsTabStop": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "enum": [
          "start",
          "center",
          "end",
          "decimal",
          "clear"
        ],
        "title": "Kind",
        "type": "string"
      },
      "leader": {
        "anyOf": [
          {
            "enum": [
              "none",
              "dot",
              "hyphen",
              "underscore"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Leader"
      },
      "pos": {
        "maximum": 9007199254740991,
        "minimum": -9007199254740991,
        "title": "Pos",
        "type": "integer"
      }
    },
    "required": [
      "pos",
      "kind"
    ],
    "title": "DocsTabStop",
    "type": "object"
  },
  "DocsTableBlock": {
    "additionalProperties": false,
    "properties": {
      "caption": {
        "anyOf": [
          {
            "items": {
              "discriminator": {
                "mapping": {
                  "bookmark": "#/components/schemas/DocsBookmarkInline",
                  "break": "#/components/schemas/DocsBreakInline",
                  "field": "#/components/schemas/DocsFieldInline",
                  "image": "#/components/schemas/DocsImageInline",
                  "run": "#/components/schemas/DocsRunInline",
                  "tab": "#/components/schemas/DocsTabInline"
                },
                "propertyName": "type"
              },
              "oneOf": [
                {
                  "$ref": "#/components/schemas/DocsRunInline"
                },
                {
                  "$ref": "#/components/schemas/DocsBreakInline"
                },
                {
                  "$ref": "#/components/schemas/DocsTabInline"
                },
                {
                  "$ref": "#/components/schemas/DocsImageInline"
                },
                {
                  "$ref": "#/components/schemas/DocsFieldInline"
                },
                {
                  "$ref": "#/components/schemas/DocsBookmarkInline"
                }
              ]
            },
            "type": "array"
          },
          {
            "type": "null"
          }
        ],
        "title": "Caption"
      },
      "colWidths": {
        "items": {
          "maximum": 9007199254740991,
          "minimum": -9007199254740991,
          "type": "integer"
        },
        "title": "Colwidths",
        "type": "array"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "props": {
        "$ref": "#/components/schemas/DocsTableProps"
      },
      "rows": {
        "items": {
          "$ref": "#/components/schemas/DocsTableRow"
        },
        "title": "Rows",
        "type": "array"
      },
      "type": {
        "const": "table",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "rows"
    ],
    "title": "DocsTableBlock",
    "type": "object"
  },
  "DocsTableCell": {
    "additionalProperties": false,
    "properties": {
      "blocks": {
        "items": {
          "discriminator": {
            "mapping": {
              "code_block": "#/components/schemas/DocsCodeBlock",
              "heading": "#/components/schemas/DocsHeadingBlock",
              "image": "#/components/schemas/DocsImageBlock",
              "list": "#/components/schemas/DocsListBlock",
              "page_break": "#/components/schemas/DocsPageBreakBlock",
              "paragraph": "#/components/schemas/DocsParagraphBlock",
              "quote": "#/components/schemas/DocsQuoteBlock",
              "rule": "#/components/schemas/DocsRuleBlock",
              "table": "#/components/schemas/DocsTableBlock",
              "toc": "#/components/schemas/DocsTocBlock"
            },
            "propertyName": "type"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocsParagraphBlock"
            },
            {
              "$ref": "#/components/schemas/DocsHeadingBlock"
            },
            {
              "$ref": "#/components/schemas/DocsListBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTableBlock"
            },
            {
              "$ref": "#/components/schemas/DocsImageBlock"
            },
            {
              "$ref": "#/components/schemas/DocsCodeBlock"
            },
            {
              "$ref": "#/components/schemas/DocsQuoteBlock"
            },
            {
              "$ref": "#/components/schemas/DocsPageBreakBlock"
            },
            {
              "$ref": "#/components/schemas/DocsRuleBlock"
            },
            {
              "$ref": "#/components/schemas/DocsTocBlock"
            }
          ]
        },
        "title": "Blocks",
        "type": "array"
      },
      "colSpan": {
        "default": 1,
        "maximum": 10000,
        "minimum": 1,
        "title": "Colspan",
        "type": "integer"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "props": {
        "$ref": "#/components/schemas/DocsCellProps"
      },
      "rowSpan": {
        "default": 1,
        "maximum": 10000,
        "minimum": 1,
        "title": "Rowspan",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "blocks"
    ],
    "title": "DocsTableCell",
    "type": "object"
  },
  "DocsTableContinuation": {
    "additionalProperties": false,
    "properties": {
      "label": {
        "maxLength": 4096,
        "title": "Label",
        "type": "string"
      },
      "props": {
        "$ref": "#/components/schemas/DocsParaProps"
      }
    },
    "required": [
      "label",
      "props"
    ],
    "title": "DocsTableContinuation",
    "type": "object"
  },
  "DocsTableProps": {
    "additionalProperties": false,
    "properties": {
      "align": {
        "anyOf": [
          {
            "enum": [
              "start",
              "center",
              "end",
              "justify",
              "distributed"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Align"
      },
      "borders": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsBorders"
          },
          {
            "type": "null"
          }
        ]
      },
      "cellMargin": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Cellmargin"
      },
      "cellMarginVertical": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Cellmarginvertical"
      },
      "continuation": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocsTableContinuation"
          },
          {
            "type": "null"
          }
        ]
      },
      "headerRows": {
        "default": 0,
        "maximum": 4294967295,
        "minimum": 0,
        "title": "Headerrows",
        "type": "integer"
      },
      "layout": {
        "anyOf": [
          {
            "enum": [
              "fixed",
              "autofit"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Layout"
      },
      "style": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Style"
      },
      "width": {
        "anyOf": [
          {
            "discriminator": {
              "mapping": {
                "emu": "#/components/schemas/DocsEmuWidth",
                "pct": "#/components/schemas/DocsPctWidth"
              },
              "propertyName": "kind"
            },
            "oneOf": [
              {
                "$ref": "#/components/schemas/DocsEmuWidth"
              },
              {
                "$ref": "#/components/schemas/DocsPctWidth"
              }
            ]
          },
          {
            "type": "null"
          }
        ],
        "title": "Width"
      }
    },
    "title": "DocsTableProps",
    "type": "object"
  },
  "DocsTableRow": {
    "additionalProperties": false,
    "properties": {
      "cantSplit": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Cantsplit"
      },
      "cells": {
        "items": {
          "$ref": "#/components/schemas/DocsTableCell"
        },
        "title": "Cells",
        "type": "array"
      },
      "header": {
        "default": false,
        "title": "Header",
        "type": "boolean"
      },
      "height": {
        "anyOf": [
          {
            "maximum": 9007199254740991,
            "minimum": -9007199254740991,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Height"
      },
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "keepWithNext": {
        "anyOf": [
          {
            "type": "boolean"
          },
          {
            "type": "null"
          }
        ],
        "title": "Keepwithnext"
      }
    },
    "required": [
      "id",
      "cells"
    ],
    "title": "DocsTableRow",
    "type": "object"
  },
  "DocsThemeColorValue": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "theme",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "enum": [
          "dk1",
          "lt1",
          "dk2",
          "lt2",
          "accent1",
          "accent2",
          "accent3",
          "accent4",
          "accent5",
          "accent6",
          "hlink",
          "folHlink"
        ],
        "title": "Value",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsThemeColorValue",
    "type": "object"
  },
  "DocsThemeFontRef": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "theme",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "enum": [
          "body",
          "heading",
          "mono"
        ],
        "title": "Value",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsThemeFontRef",
    "type": "object"
  },
  "DocsThemeRef": {
    "additionalProperties": false,
    "properties": {
      "name": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Name",
        "type": "string"
      }
    },
    "required": [
      "name"
    ],
    "title": "DocsThemeRef",
    "type": "object"
  },
  "DocsTocBlock": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Id",
        "type": "string"
      },
      "levels": {
        "default": 3,
        "maximum": 255,
        "minimum": 0,
        "title": "Levels",
        "type": "integer"
      },
      "title": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Title"
      },
      "type": {
        "const": "toc",
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id"
    ],
    "title": "DocsTocBlock",
    "type": "object"
  },
  "DocsUnsupported": {
    "additionalProperties": false,
    "properties": {
      "detail": {
        "anyOf": [
          {
            "maxLength": 4096,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Detail"
      },
      "kind": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Kind",
        "type": "string"
      },
      "path": {
        "maxLength": 4096,
        "title": "Path",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "path"
    ],
    "title": "DocsUnsupported",
    "type": "object"
  },
  "DocsUriData": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "uri",
        "title": "Kind",
        "type": "string"
      },
      "value": {
        "pattern": "^tp-resource:[0-9a-f]{64}$",
        "title": "Value",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "value"
    ],
    "title": "DocsUriData",
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
  "DocumentContentV2": {
    "additionalProperties": false,
    "properties": {
      "json": {
        "additionalProperties": false,
        "description": "Stored in ``document_versions.content_json`` when ``schema_version`` is 2.",
        "properties": {
          "chapters": {
            "anyOf": [
              {
                "items": {
                  "$ref": "#/components/schemas/DocsChapter"
                },
                "type": "array"
              },
              {
                "type": "null"
              }
            ],
            "title": "Chapters"
          },
          "model": {
            "$ref": "#/components/schemas/DocsModel"
          },
          "protections": {
            "items": {
              "$ref": "#/components/schemas/DocsProtection"
            },
            "maxItems": 100000,
            "title": "Protections",
            "type": "array"
          },
          "schemaVersion": {
            "const": 2,
            "title": "Schemaversion",
            "type": "integer"
          }
        },
        "required": [
          "schemaVersion",
          "model"
        ],
        "title": "DocsSnapshot",
        "type": "object"
      },
      "schema_version": {
        "const": 2,
        "title": "Schema Version",
        "type": "integer"
      }
    },
    "required": [
      "schema_version",
      "json"
    ],
    "title": "DocumentContentV2",
    "type": "object"
  },
  "DocumentEvidence": {
    "additionalProperties": false,
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "kind": {
        "const": "document",
        "title": "Kind",
        "type": "string"
      },
      "selection": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/RevisionSelection"
          },
          {
            "$ref": "#/components/schemas/RevisionNodeSelection"
          }
        ],
        "title": "Selection"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "kind",
      "document_id",
      "version",
      "selection"
    ],
    "title": "DocumentEvidence",
    "type": "object"
  },
  "DocumentExportCreate": {
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
      "format": {
        "enum": [
          "html",
          "txt",
          "markdown",
          "docx",
          "pdf"
        ],
        "title": "Format",
        "type": "string"
      },
      "office_mode": {
        "anyOf": [
          {
            "enum": [
              "preserve",
              "regenerate"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Office Mode"
      },
      "track_changes": {
        "default": false,
        "title": "Track Changes",
        "type": "boolean"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "format"
    ],
    "title": "DocumentExportCreate",
    "type": "object"
  },
  "DocumentExportInput": {
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
      "format": {
        "enum": [
          "html",
          "txt",
          "markdown",
          "docx",
          "pdf"
        ],
        "title": "Format",
        "type": "string"
      },
      "office_mode": {
        "anyOf": [
          {
            "enum": [
              "preserve",
              "regenerate"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Office Mode"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "track_changes": {
        "default": false,
        "title": "Track Changes",
        "type": "boolean"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "format"
    ],
    "title": "DocumentExportInput",
    "type": "object"
  },
  "DocumentExportResult": {
    "additionalProperties": false,
    "properties": {
      "byte_size": {
        "maximum": 67108864,
        "minimum": 1,
        "title": "Byte Size",
        "type": "integer"
      },
      "content_type": {
        "enum": [
          "text/html; charset=utf-8",
          "text/plain; charset=utf-8",
          "text/markdown; charset=utf-8",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/pdf"
        ],
        "title": "Content Type",
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
      "file_id": {
        "format": "uuid",
        "title": "File Id",
        "type": "string"
      },
      "filename": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Filename",
        "type": "string"
      },
      "format": {
        "enum": [
          "html",
          "txt",
          "markdown",
          "docx",
          "pdf"
        ],
        "title": "Format",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "document_export",
        "title": "Kind",
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
      "report": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/OfficeExportReport"
          },
          {
            "type": "null"
          }
        ]
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Sha256",
        "type": "string"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "schema_version",
      "job_id",
      "project_id",
      "document_id",
      "file_id",
      "filename",
      "content_type",
      "sha256",
      "byte_size",
      "model_used",
      "writes_performed",
      "kind",
      "document_version",
      "format"
    ],
    "title": "DocumentExportResult",
    "type": "object"
  },
  "DocumentImport": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentContent-Input"
          },
          {
            "$ref": "#/components/schemas/DocumentContentV2"
          }
        ],
        "title": "Content"
      }
    },
    "required": [
      "content"
    ],
    "title": "DocumentImport",
    "type": "object"
  },
  "DocumentOfficeSourceRead": {
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "title": "Document Version",
        "type": "integer"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "import_id": {
        "format": "uuid",
        "title": "Import Id",
        "type": "string"
      },
      "imported_at": {
        "format": "date-time",
        "title": "Imported At",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_id": {
        "format": "uuid",
        "title": "Original Id",
        "type": "string"
      },
      "original_sha256": {
        "title": "Original Sha256",
        "type": "string"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "import_id",
      "material_id",
      "original_id",
      "original_sha256",
      "filename",
      "imported_at"
    ],
    "title": "DocumentOfficeSourceRead",
    "type": "object"
  },
  "DocumentPointer": {
    "additionalProperties": false,
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
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
      "version"
    ],
    "title": "DocumentPointer",
    "type": "object"
  },
  "DocumentRead": {
    "properties": {
      "content": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentContent-Output"
          },
          {
            "$ref": "#/components/schemas/DocumentContentV2"
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
  "DocumentResourceRead": {
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
      "height_px": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Height Px"
      },
      "mime": {
        "enum": [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp"
        ],
        "title": "Mime",
        "type": "string"
      },
      "sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Sha256",
        "type": "string"
      },
      "uri": {
        "title": "Uri",
        "type": "string"
      },
      "width_px": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Width Px"
      }
    },
    "required": [
      "sha256",
      "uri",
      "mime",
      "byte_size",
      "width_px",
      "height_px",
      "created_at"
    ],
    "title": "DocumentResourceRead",
    "type": "object"
  },
  "DocumentResourceUpload": {
    "additionalProperties": false,
    "properties": {
      "content_base64": {
        "maxLength": 13981016,
        "minLength": 4,
        "title": "Content Base64",
        "type": "string"
      },
      "mime": {
        "enum": [
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp"
        ],
        "title": "Mime",
        "type": "string"
      }
    },
    "required": [
      "mime",
      "content_base64"
    ],
    "title": "DocumentResourceUpload",
    "type": "object"
  },
  "DocumentSave": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentContent-Input"
          },
          {
            "$ref": "#/components/schemas/DocumentContentV2"
          }
        ],
        "title": "Content"
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
  "DocumentSchemaUpgradeCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_version"
    ],
    "title": "DocumentSchemaUpgradeCreate",
    "type": "object"
  },
  "DocumentSchemaUpgradeRead": {
    "properties": {
      "document": {
        "$ref": "#/components/schemas/DocumentRead"
      },
      "replayed": {
        "title": "Replayed",
        "type": "boolean"
      },
      "upgrade": {
        "$ref": "#/components/schemas/DocumentSchemaUpgradeRecord"
      }
    },
    "required": [
      "document",
      "upgrade",
      "replayed"
    ],
    "title": "DocumentSchemaUpgradeRead",
    "type": "object"
  },
  "DocumentSchemaUpgradeRecord": {
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "converter_sha256": {
        "title": "Converter Sha256",
        "type": "string"
      },
      "converter_version": {
        "title": "Converter Version",
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
      "from_schema_version": {
        "const": 1,
        "title": "From Schema Version",
        "type": "integer"
      },
      "from_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "From Version",
        "type": "integer"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "loss_report": {
        "items": {
          "$ref": "#/components/schemas/LossItem"
        },
        "title": "Loss Report",
        "type": "array"
      },
      "to_schema_version": {
        "const": 2,
        "title": "To Schema Version",
        "type": "integer"
      },
      "to_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "To Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "document_id",
      "command_id",
      "from_version",
      "to_version",
      "from_schema_version",
      "to_schema_version",
      "converter_version",
      "converter_sha256",
      "loss_report",
      "created_at"
    ],
    "title": "DocumentSchemaUpgradeRecord",
    "type": "object"
  },
  "DocumentSourceChapter": {
    "properties": {
      "allowed_kinds": {
        "items": {
          "enum": [
            "heading",
            "paragraph"
          ],
          "type": "string"
        },
        "title": "Allowed Kinds",
        "type": "array"
      },
      "anchor_id": {
        "title": "Anchor Id",
        "type": "string"
      },
      "editable": {
        "title": "Editable",
        "type": "boolean"
      },
      "editor_path": {
        "items": {
          "type": "integer"
        },
        "title": "Editor Path",
        "type": "array"
      },
      "kind": {
        "enum": [
          "heading",
          "paragraph"
        ],
        "title": "Kind",
        "type": "string"
      },
      "level": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Level"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "anchor_id",
      "editor_path",
      "title",
      "kind",
      "level",
      "editable",
      "allowed_kinds"
    ],
    "title": "DocumentSourceChapter",
    "type": "object"
  },
  "DocumentSourceImport": {
    "additionalProperties": false,
    "properties": {
      "chapter_corrections": {
        "items": {
          "$ref": "#/components/schemas/ChapterCorrection"
        },
        "maxItems": 1000,
        "title": "Chapter Corrections",
        "type": "array"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
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
      }
    },
    "required": [
      "material_id",
      "original_version_id",
      "parse_version_id",
      "command_id"
    ],
    "title": "DocumentSourceImport",
    "type": "object"
  },
  "DocumentSourceImportReceipt": {
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "const": 1,
        "default": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
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
      "source_id": {
        "format": "uuid",
        "title": "Source Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "document_id",
      "source_id",
      "material_id",
      "original_version_id",
      "parse_version_id"
    ],
    "title": "DocumentSourceImportReceipt",
    "type": "object"
  },
  "DocumentSourcePreview": {
    "properties": {
      "can_import": {
        "title": "Can Import",
        "type": "boolean"
      },
      "chapters": {
        "items": {
          "$ref": "#/components/schemas/DocumentSourceChapter"
        },
        "title": "Chapters",
        "type": "array"
      },
      "chapters_truncated": {
        "title": "Chapters Truncated",
        "type": "boolean"
      },
      "diagnostics": {
        "items": {
          "type": "string"
        },
        "title": "Diagnostics",
        "type": "array"
      },
      "existing_document_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Existing Document Id"
      },
      "file_type": {
        "enum": [
          "docx",
          "text"
        ],
        "title": "File Type",
        "type": "string"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "manifest_sha256": {
        "title": "Manifest Sha256",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_sha256": {
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
        "title": "Parser Version",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "status": {
        "enum": [
          "complete",
          "partial"
        ],
        "title": "Status",
        "type": "string"
      }
    },
    "required": [
      "project_id",
      "material_id",
      "original_version_id",
      "parse_version_id",
      "filename",
      "file_type",
      "original_sha256",
      "manifest_sha256",
      "parser_version",
      "status",
      "can_import",
      "existing_document_id",
      "chapters",
      "chapters_truncated",
      "diagnostics"
    ],
    "title": "DocumentSourcePreview",
    "type": "object"
  },
  "DocumentSourcePreviewRequest": {
    "additionalProperties": false,
    "properties": {
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
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
      }
    },
    "required": [
      "material_id",
      "original_version_id",
      "parse_version_id"
    ],
    "title": "DocumentSourcePreviewRequest",
    "type": "object"
  },
  "DocumentSourceRead": {
    "properties": {
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "title": "Document Version",
        "type": "integer"
      },
      "file_type": {
        "enum": [
          "docx",
          "text"
        ],
        "title": "File Type",
        "type": "string"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "guard_contract": {
        "$ref": "#/components/schemas/JsonObject"
      },
      "guard_version": {
        "title": "Guard Version",
        "type": "string"
      },
      "imported_at": {
        "format": "date-time",
        "title": "Imported At",
        "type": "string"
      },
      "manifest_sha256": {
        "title": "Manifest Sha256",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_sha256": {
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
      "source_id": {
        "format": "uuid",
        "title": "Source Id",
        "type": "string"
      }
    },
    "required": [
      "document_id",
      "document_version",
      "source_id",
      "material_id",
      "original_version_id",
      "parse_version_id",
      "original_sha256",
      "manifest_sha256",
      "filename",
      "file_type",
      "guard_version",
      "guard_contract",
      "imported_at"
    ],
    "title": "DocumentSourceRead",
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
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentContent-Output"
          },
          {
            "$ref": "#/components/schemas/DocumentContentV2"
          }
        ],
        "title": "Content"
      },
      "converted": {
        "default": false,
        "title": "Converted",
        "type": "boolean"
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
          "blank",
          "schema_upgrade",
          "office_import"
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
          "blank",
          "schema_upgrade",
          "office_import"
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
  "EvidenceCandidate": {
    "additionalProperties": false,
    "properties": {
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
        "type": "string"
      },
      "title": {
        "title": "Title",
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
      "task_id",
      "version",
      "title"
    ],
    "title": "EvidenceCandidate",
    "type": "object"
  },
  "EvidenceSnapshot": {
    "additionalProperties": false,
    "properties": {
      "fingerprint": {
        "title": "Fingerprint",
        "type": "string"
      },
      "label": {
        "title": "Label",
        "type": "string"
      },
      "reference": {
        "discriminator": {
          "mapping": {
            "document": "#/components/schemas/DocumentEvidence",
            "material": "#/components/schemas/MaterialEvidence"
          },
          "propertyName": "kind"
        },
        "oneOf": [
          {
            "$ref": "#/components/schemas/DocumentEvidence"
          },
          {
            "$ref": "#/components/schemas/MaterialEvidence"
          }
        ],
        "title": "Reference"
      },
      "stale": {
        "default": false,
        "title": "Stale",
        "type": "boolean"
      }
    },
    "required": [
      "reference",
      "label",
      "fingerprint"
    ],
    "title": "EvidenceSnapshot",
    "type": "object"
  },
  "EvidenceTaskRef": {
    "additionalProperties": false,
    "properties": {
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
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
      "task_id",
      "version"
    ],
    "title": "EvidenceTaskRef",
    "type": "object"
  },
  "EvidenceTaskSnapshot": {
    "additionalProperties": false,
    "properties": {
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
        "type": "string"
      },
      "title": {
        "title": "Title",
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
      "task_id",
      "version",
      "title"
    ],
    "title": "EvidenceTaskSnapshot",
    "type": "object"
  },
  "ExportConfiguration": {
    "additionalProperties": false,
    "description": "Server-frozen renderer and a digest of the exact facts read at enqueue time.",
    "properties": {
      "renderer_version": {
        "const": "thesispilot-export-1",
        "default": "thesispilot-export-1",
        "title": "Renderer Version",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "source_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Source Sha256",
        "type": "string"
      }
    },
    "required": [
      "source_sha256"
    ],
    "title": "ExportConfiguration",
    "type": "object"
  },
  "ExportFileRead": {
    "properties": {
      "byte_size": {
        "title": "Byte Size",
        "type": "integer"
      },
      "content_type": {
        "title": "Content Type",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
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
      "sha256": {
        "title": "Sha256",
        "type": "string"
      }
    },
    "required": [
      "id",
      "filename",
      "content_type",
      "sha256",
      "byte_size",
      "created_at"
    ],
    "title": "ExportFileRead",
    "type": "object"
  },
  "ExportPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/ExportRead"
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
    "title": "ExportPage",
    "type": "object"
  },
  "ExportRead": {
    "properties": {
      "attempt": {
        "title": "Attempt",
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
      "file": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/ExportFileRead"
          },
          {
            "type": "null"
          }
        ]
      },
      "format": {
        "enum": [
          "html",
          "txt",
          "markdown",
          "docx",
          "pdf"
        ],
        "title": "Format",
        "type": "string"
      },
      "from_version": {
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
        "title": "From Version"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "document_export",
          "change_record"
        ],
        "title": "Kind",
        "type": "string"
      },
      "office_mode": {
        "anyOf": [
          {
            "enum": [
              "preserve",
              "regenerate"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Office Mode"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "report": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/OfficeExportReport"
          },
          {
            "type": "null"
          }
        ]
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
      "track_changes": {
        "default": false,
        "title": "Track Changes",
        "type": "boolean"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "job_id",
      "project_id",
      "kind",
      "status",
      "attempt",
      "format",
      "document_id",
      "document_version",
      "from_version",
      "source_job_id",
      "error_code",
      "file",
      "created_at",
      "updated_at"
    ],
    "title": "ExportRead",
    "type": "object"
  },
  "FeedbackContent": {
    "additionalProperties": false,
    "properties": {
      "certainty": {
        "enum": [
          "certain",
          "uncertain"
        ],
        "title": "Certainty",
        "type": "string"
      },
      "correction": {
        "default": "",
        "maxLength": 4000,
        "title": "Correction",
        "type": "string"
      },
      "evidence": {
        "items": {
          "discriminator": {
            "mapping": {
              "document": "#/components/schemas/DocumentEvidence",
              "material": "#/components/schemas/MaterialEvidence"
            },
            "propertyName": "kind"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocumentEvidence"
            },
            {
              "$ref": "#/components/schemas/MaterialEvidence"
            }
          ]
        },
        "maxItems": 20,
        "title": "Evidence",
        "type": "array"
      },
      "interpretation": {
        "maxLength": 4000,
        "minLength": 1,
        "title": "Interpretation",
        "type": "string"
      },
      "new_task": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/TaskContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "source_checked": {
        "title": "Source Checked",
        "type": "boolean"
      },
      "source_range": {
        "$ref": "#/components/schemas/SourceRange"
      },
      "task_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Task Id"
      }
    },
    "required": [
      "source_range",
      "interpretation",
      "certainty",
      "source_checked"
    ],
    "title": "FeedbackContent",
    "type": "object"
  },
  "FeedbackCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "default": 0,
        "maximum": 0,
        "minimum": 0,
        "title": "Expected Version",
        "type": "integer"
      },
      "original_text": {
        "maxLength": 10000,
        "minLength": 1,
        "title": "Original Text",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "original_text"
    ],
    "title": "FeedbackCreate",
    "type": "object"
  },
  "FeedbackDecision": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "processed",
          "reopen"
        ],
        "title": "Action",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "reason": {
        "default": "",
        "maxLength": 2000,
        "title": "Reason",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "action"
    ],
    "title": "FeedbackDecision",
    "type": "object"
  },
  "FeedbackItemCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "content": {
        "$ref": "#/components/schemas/FeedbackContent"
      },
      "expected_version": {
        "default": 0,
        "maximum": 0,
        "minimum": 0,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "content"
    ],
    "title": "FeedbackItemCreate",
    "type": "object"
  },
  "FeedbackItemPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FeedbackItemSummary"
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
    "title": "FeedbackItemPage",
    "type": "object"
  },
  "FeedbackItemRead": {
    "additionalProperties": false,
    "properties": {
      "batch_id": {
        "format": "uuid",
        "title": "Batch Id",
        "type": "string"
      },
      "content": {
        "$ref": "#/components/schemas/FeedbackContent"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "evidence_snapshots": {
        "items": {
          "$ref": "#/components/schemas/EvidenceSnapshot"
        },
        "title": "Evidence Snapshots",
        "type": "array"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "needs_review": {
        "title": "Needs Review",
        "type": "boolean"
      },
      "origin": {
        "default": "manual",
        "enum": [
          "manual",
          "ai_suggested"
        ],
        "title": "Origin",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "review_reasons": {
        "items": {
          "type": "string"
        },
        "title": "Review Reasons",
        "type": "array"
      },
      "status": {
        "enum": [
          "open",
          "processed",
          "withdrawn"
        ],
        "title": "Status",
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
      "batch_id",
      "project_id",
      "version",
      "status",
      "content",
      "evidence_snapshots",
      "needs_review",
      "review_reasons",
      "created_at",
      "updated_at"
    ],
    "title": "FeedbackItemRead",
    "type": "object"
  },
  "FeedbackItemSummary": {
    "additionalProperties": false,
    "properties": {
      "batch_id": {
        "format": "uuid",
        "title": "Batch Id",
        "type": "string"
      },
      "certainty": {
        "enum": [
          "certain",
          "uncertain"
        ],
        "title": "Certainty",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "needs_review": {
        "title": "Needs Review",
        "type": "boolean"
      },
      "origin": {
        "default": "manual",
        "enum": [
          "manual",
          "ai_suggested"
        ],
        "title": "Origin",
        "type": "string"
      },
      "preview": {
        "title": "Preview",
        "type": "string"
      },
      "review_reasons": {
        "items": {
          "type": "string"
        },
        "title": "Review Reasons",
        "type": "array"
      },
      "status": {
        "enum": [
          "open",
          "processed",
          "withdrawn"
        ],
        "title": "Status",
        "type": "string"
      },
      "task_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Task Id"
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
      "batch_id",
      "version",
      "status",
      "preview",
      "certainty",
      "task_id",
      "needs_review",
      "review_reasons",
      "updated_at"
    ],
    "title": "FeedbackItemSummary",
    "type": "object"
  },
  "FeedbackItemUpdate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "content": {
        "$ref": "#/components/schemas/FeedbackContent"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "content"
    ],
    "title": "FeedbackItemUpdate",
    "type": "object"
  },
  "FeedbackPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FeedbackSummary"
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
    "title": "FeedbackPage",
    "type": "object"
  },
  "FeedbackRead": {
    "additionalProperties": false,
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
      "item_count": {
        "title": "Item Count",
        "type": "integer"
      },
      "origin": {
        "const": "manual",
        "default": "manual",
        "title": "Origin",
        "type": "string"
      },
      "original_text": {
        "title": "Original Text",
        "type": "string"
      },
      "preview": {
        "title": "Preview",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "preview",
      "item_count",
      "created_at",
      "original_text"
    ],
    "title": "FeedbackRead",
    "type": "object"
  },
  "FeedbackSplitCreate": {
    "additionalProperties": false,
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "agent_config_version_id"
    ],
    "title": "FeedbackSplitCreate",
    "type": "object"
  },
  "FeedbackSplitDecide": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "decisions": {
        "items": {
          "$ref": "#/components/schemas/SuggestionDecision"
        },
        "maxItems": 50,
        "minItems": 1,
        "title": "Decisions",
        "type": "array"
      }
    },
    "required": [
      "command_id",
      "decisions"
    ],
    "title": "FeedbackSplitDecide",
    "type": "object"
  },
  "FeedbackSplitInput": {
    "additionalProperties": false,
    "description": "The frozen split run owns the batch original and configuration versions.",
    "properties": {
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "split_id": {
        "format": "uuid",
        "title": "Split Id",
        "type": "string"
      }
    },
    "required": [
      "split_id"
    ],
    "title": "FeedbackSplitInput",
    "type": "object"
  },
  "FeedbackSplitPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FeedbackSplitRead"
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
    "title": "FeedbackSplitPage",
    "type": "object"
  },
  "FeedbackSplitRead": {
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "agent_name": {
        "title": "Agent Name",
        "type": "string"
      },
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "batch_id": {
        "format": "uuid",
        "title": "Batch Id",
        "type": "string"
      },
      "config_version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Config Version Ids",
        "type": "object"
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "note": {
        "title": "Note",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requested_model": {
        "anyOf": [
          {
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
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Response Model"
      },
      "source_split_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Split Id"
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
      "suggestions": {
        "items": {
          "$ref": "#/components/schemas/FeedbackSuggestionRead"
        },
        "title": "Suggestions",
        "type": "array"
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
      "batch_id",
      "job_id",
      "status",
      "error_code",
      "attempt",
      "agent_config_version_id",
      "agent_name",
      "config_version_ids",
      "source_split_id",
      "requested_model",
      "response_model",
      "note",
      "suggestions",
      "created_at",
      "updated_at"
    ],
    "title": "FeedbackSplitRead",
    "type": "object"
  },
  "FeedbackSplitReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "split": {
        "$ref": "#/components/schemas/FeedbackSplitRead"
      }
    },
    "required": [
      "split",
      "job"
    ],
    "title": "FeedbackSplitReceipt",
    "type": "object"
  },
  "FeedbackSplitResult": {
    "additionalProperties": false,
    "description": "Only references and counts; immutable suggestions live in the feedback_splits module.",
    "properties": {
      "batch_id": {
        "format": "uuid",
        "title": "Batch Id",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "feedback_decomposition",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": true,
        "title": "Model Used",
        "type": "boolean"
      },
      "note": {
        "maxLength": 2000,
        "title": "Note",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requested_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Requested Model",
        "type": "string"
      },
      "response_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Response Model",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "split_id": {
        "format": "uuid",
        "title": "Split Id",
        "type": "string"
      },
      "suggestion_count": {
        "maximum": 50,
        "minimum": 0,
        "title": "Suggestion Count",
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
      "split_id",
      "batch_id",
      "suggestion_count",
      "requested_model",
      "response_model",
      "note",
      "model_used",
      "writes_performed"
    ],
    "title": "FeedbackSplitResult",
    "type": "object"
  },
  "FeedbackSplitRetry": {
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
    "title": "FeedbackSplitRetry",
    "type": "object"
  },
  "FeedbackSuggestionRead": {
    "properties": {
      "ambiguous": {
        "title": "Ambiguous",
        "type": "boolean"
      },
      "certainty": {
        "enum": [
          "certain",
          "uncertain"
        ],
        "title": "Certainty",
        "type": "string"
      },
      "feedback_item_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Feedback Item Id"
      },
      "history": {
        "items": {
          "$ref": "#/components/schemas/SuggestionHistoryRead"
        },
        "title": "History",
        "type": "array"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "interpretation": {
        "title": "Interpretation",
        "type": "string"
      },
      "position": {
        "title": "Position",
        "type": "integer"
      },
      "source_range": {
        "$ref": "#/components/schemas/SourceRange"
      },
      "stale": {
        "title": "Stale",
        "type": "boolean"
      },
      "stale_reasons": {
        "items": {
          "type": "string"
        },
        "title": "Stale Reasons",
        "type": "array"
      },
      "state": {
        "enum": [
          "pending",
          "adopted",
          "rejected"
        ],
        "title": "State",
        "type": "string"
      },
      "task_title": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Task Title"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "position",
      "source_range",
      "interpretation",
      "certainty",
      "ambiguous",
      "task_title",
      "state",
      "version",
      "feedback_item_id",
      "stale",
      "stale_reasons",
      "history"
    ],
    "title": "FeedbackSuggestionRead",
    "type": "object"
  },
  "FeedbackSummary": {
    "additionalProperties": false,
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
      "item_count": {
        "title": "Item Count",
        "type": "integer"
      },
      "origin": {
        "const": "manual",
        "default": "manual",
        "title": "Origin",
        "type": "string"
      },
      "preview": {
        "title": "Preview",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "preview",
      "item_count",
      "created_at"
    ],
    "title": "FeedbackSummary",
    "type": "object"
  },
  "FeedbackVersionPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FeedbackVersionRead"
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
    "title": "FeedbackVersionPage",
    "type": "object"
  },
  "FeedbackVersionRead": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "title": "Action",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "snapshot": {
        "$ref": "#/components/schemas/FeedbackItemRead"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "version",
      "action",
      "reason",
      "snapshot",
      "created_at"
    ],
    "title": "FeedbackVersionRead",
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
  "FormatApply": {
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
    "title": "FormatApply",
    "type": "object"
  },
  "FormatCommandRead": {
    "properties": {
      "base_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Base Version",
        "type": "integer"
      },
      "candidate_id": {
        "format": "uuid",
        "title": "Candidate Id",
        "type": "string"
      },
      "candidate_revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Candidate Revision",
        "type": "integer"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "operation": {
        "enum": [
          "create",
          "decide",
          "apply",
          "undo"
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
      "candidate_id",
      "candidate_revision",
      "operation",
      "base_version",
      "result_version"
    ],
    "title": "FormatCommandRead",
    "type": "object"
  },
  "FormatContext": {
    "properties": {
      "binding_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Binding Version",
        "type": "integer"
      },
      "binding_version_id": {
        "format": "uuid",
        "title": "Binding Version Id",
        "type": "string"
      },
      "content_schema_version": {
        "default": 1,
        "enum": [
          1,
          2
        ],
        "title": "Content Schema Version",
        "type": "integer"
      },
      "document_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Document Version",
        "type": "integer"
      },
      "requirement_parse_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Requirement Parse Version Ids",
        "type": "array"
      },
      "rules": {
        "items": {
          "$ref": "#/components/schemas/FormatRule"
        },
        "title": "Rules",
        "type": "array"
      },
      "source_guard_digest": {
        "title": "Source Guard Digest",
        "type": "string"
      },
      "targets": {
        "items": {
          "$ref": "#/components/schemas/FormatTarget"
        },
        "title": "Targets",
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
      "document_version",
      "binding_version_id",
      "binding_version",
      "template_parse_version_id",
      "requirement_parse_version_ids",
      "source_guard_digest",
      "targets",
      "rules"
    ],
    "title": "FormatContext",
    "type": "object"
  },
  "FormatCreate": {
    "additionalProperties": false,
    "properties": {
      "base_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Base Version",
        "type": "integer"
      },
      "binding_version_id": {
        "format": "uuid",
        "title": "Binding Version Id",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "selections": {
        "items": {
          "$ref": "#/components/schemas/FormatSelection"
        },
        "maxItems": 100,
        "minItems": 1,
        "title": "Selections",
        "type": "array"
      },
      "source_guard_digest": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Source Guard Digest",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "base_version",
      "binding_version_id",
      "source_guard_digest",
      "selections"
    ],
    "title": "FormatCreate",
    "type": "object"
  },
  "FormatDecide": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "decisions": {
        "items": {
          "$ref": "#/components/schemas/FormatDecision"
        },
        "maxItems": 1000,
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
    "title": "FormatDecide",
    "type": "object"
  },
  "FormatDecision": {
    "additionalProperties": false,
    "properties": {
      "decision": {
        "enum": [
          "accept",
          "reject",
          "pending"
        ],
        "title": "Decision",
        "type": "string"
      },
      "patch_id": {
        "maxLength": 300,
        "minLength": 1,
        "title": "Patch Id",
        "type": "string"
      }
    },
    "required": [
      "patch_id",
      "decision"
    ],
    "title": "FormatDecision",
    "type": "object"
  },
  "FormatPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/FormatRead"
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
    "title": "FormatPage",
    "type": "object"
  },
  "FormatPatch": {
    "description": "v2 patches carry ``node_id`` and kernel values (align start/center/end/justify).",
    "properties": {
      "after": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "integer"
          }
        ],
        "title": "After"
      },
      "anchor_id": {
        "title": "Anchor Id",
        "type": "string"
      },
      "before": {
        "$ref": "#/components/schemas/EditorJsonValue-Output"
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
      "evidence": {
        "title": "Evidence",
        "type": "string"
      },
      "field": {
        "enum": [
          "level",
          "templateAlign",
          "templateWeight",
          "alignment"
        ],
        "title": "Field",
        "type": "string"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "node_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Node Id"
      },
      "rule_id": {
        "title": "Rule Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "anchor_id",
      "field",
      "before",
      "after",
      "rule_id",
      "evidence"
    ],
    "title": "FormatPatch",
    "type": "object"
  },
  "FormatRead": {
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
      "content_schema_version": {
        "default": 1,
        "enum": [
          1,
          2
        ],
        "title": "Content Schema Version",
        "type": "integer"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "decisions": {
        "items": {
          "$ref": "#/components/schemas/FormatDecision"
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
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "patches": {
        "items": {
          "$ref": "#/components/schemas/FormatPatch"
        },
        "title": "Patches",
        "type": "array"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "revision": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Revision",
        "type": "integer"
      },
      "status": {
        "enum": [
          "ready",
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
      "document_id",
      "project_id",
      "base_version",
      "document_version",
      "revision",
      "status",
      "applicable",
      "patches",
      "decisions",
      "application_command_id",
      "created_at",
      "updated_at"
    ],
    "title": "FormatRead",
    "type": "object"
  },
  "FormatRule": {
    "properties": {
      "anchor_id": {
        "title": "Anchor Id",
        "type": "string"
      },
      "evidence": {
        "title": "Evidence",
        "type": "string"
      },
      "field": {
        "enum": [
          "level",
          "templateAlign",
          "templateWeight",
          "alignment"
        ],
        "title": "Field",
        "type": "string"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "parse_version_id": {
        "format": "uuid",
        "title": "Parse Version Id",
        "type": "string"
      },
      "scope": {
        "enum": [
          "heading",
          "paragraph"
        ],
        "title": "Scope",
        "type": "string"
      },
      "value": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "integer"
          }
        ],
        "title": "Value"
      }
    },
    "required": [
      "id",
      "parse_version_id",
      "anchor_id",
      "field",
      "value",
      "evidence",
      "scope"
    ],
    "title": "FormatRule",
    "type": "object"
  },
  "FormatSelection": {
    "additionalProperties": false,
    "properties": {
      "rule_id": {
        "maxLength": 300,
        "minLength": 1,
        "title": "Rule Id",
        "type": "string"
      },
      "target_anchor_ids": {
        "items": {
          "maxLength": 300,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 1000,
        "minItems": 1,
        "title": "Target Anchor Ids",
        "type": "array"
      }
    },
    "required": [
      "rule_id",
      "target_anchor_ids"
    ],
    "title": "FormatSelection",
    "type": "object"
  },
  "FormatTarget": {
    "description": "v1 targets address a Tiptap editor path; v2 targets address a DocsModel node id.",
    "properties": {
      "anchor_id": {
        "title": "Anchor Id",
        "type": "string"
      },
      "attrs": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/JsonObject"
          },
          {
            "type": "null"
          }
        ]
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
      "kind": {
        "enum": [
          "heading",
          "paragraph"
        ],
        "title": "Kind",
        "type": "string"
      },
      "node_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Node Id"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "anchor_id",
      "kind",
      "title",
      "attrs"
    ],
    "title": "FormatTarget",
    "type": "object"
  },
  "FormatUndo": {
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
    "title": "FormatUndo",
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
          "material_parse",
          "content_revision",
          "document_export",
          "change_record",
          "review",
          "literature_search",
          "feedback_decomposition",
          "plan_adjustment",
          "project_backup",
          "project_restore",
          "office_import"
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
          },
          {
            "$ref": "#/components/schemas/ContentRevisionResult"
          },
          {
            "$ref": "#/components/schemas/DocumentExportResult"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordResult"
          },
          {
            "$ref": "#/components/schemas/ReviewResult"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchJobResult"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitResult"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentResult"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupResult"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreResult"
          },
          {
            "$ref": "#/components/schemas/OfficeImportResult"
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
            "$ref": "#/components/schemas/ContentRevisionInput"
          },
          {
            "$ref": "#/components/schemas/DocumentExportInput"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordInput"
          },
          {
            "$ref": "#/components/schemas/ReviewInput"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchInput"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitInput"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentInput"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupInput"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreInput"
          },
          {
            "$ref": "#/components/schemas/OfficeImportInput"
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
          "material_parse",
          "content_revision",
          "document_export",
          "change_record",
          "review",
          "literature_search",
          "feedback_decomposition",
          "plan_adjustment",
          "project_backup",
          "project_restore",
          "office_import"
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
            "$ref": "#/components/schemas/ExportConfiguration"
          },
          {
            "$ref": "#/components/schemas/BackupConfiguration"
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
            "$ref": "#/components/schemas/ContentRevisionInput"
          },
          {
            "$ref": "#/components/schemas/DocumentExportInput"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordInput"
          },
          {
            "$ref": "#/components/schemas/ReviewInput"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchInput"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitInput"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentInput"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupInput"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreInput"
          },
          {
            "$ref": "#/components/schemas/OfficeImportInput"
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
          "material_parse",
          "content_revision",
          "document_export",
          "change_record",
          "review",
          "literature_search",
          "feedback_decomposition",
          "plan_adjustment",
          "project_backup",
          "project_restore",
          "office_import"
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
            "$ref": "#/components/schemas/ContentRevisionInput"
          },
          {
            "$ref": "#/components/schemas/DocumentExportInput"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordInput"
          },
          {
            "$ref": "#/components/schemas/ReviewInput"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchInput"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitInput"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentInput"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupInput"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreInput"
          },
          {
            "$ref": "#/components/schemas/OfficeImportInput"
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
            "$ref": "#/components/schemas/ContentRevisionResult"
          },
          {
            "$ref": "#/components/schemas/DocumentExportResult"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordResult"
          },
          {
            "$ref": "#/components/schemas/ReviewResult"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchJobResult"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitResult"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentResult"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupResult"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreResult"
          },
          {
            "$ref": "#/components/schemas/OfficeImportResult"
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
            "$ref": "#/components/schemas/ExportConfiguration"
          },
          {
            "$ref": "#/components/schemas/BackupConfiguration"
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
            "$ref": "#/components/schemas/ContentRevisionInput"
          },
          {
            "$ref": "#/components/schemas/DocumentExportInput"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordInput"
          },
          {
            "$ref": "#/components/schemas/ReviewInput"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchInput"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitInput"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentInput"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupInput"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreInput"
          },
          {
            "$ref": "#/components/schemas/OfficeImportInput"
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
          "material_parse",
          "content_revision",
          "document_export",
          "change_record",
          "review",
          "literature_search",
          "feedback_decomposition",
          "plan_adjustment",
          "project_backup",
          "project_restore",
          "office_import"
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
            "$ref": "#/components/schemas/ContentRevisionInput"
          },
          {
            "$ref": "#/components/schemas/DocumentExportInput"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordInput"
          },
          {
            "$ref": "#/components/schemas/ReviewInput"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchInput"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitInput"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentInput"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupInput"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreInput"
          },
          {
            "$ref": "#/components/schemas/OfficeImportInput"
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
            "$ref": "#/components/schemas/ContentRevisionResult"
          },
          {
            "$ref": "#/components/schemas/DocumentExportResult"
          },
          {
            "$ref": "#/components/schemas/ChangeRecordResult"
          },
          {
            "$ref": "#/components/schemas/ReviewResult"
          },
          {
            "$ref": "#/components/schemas/LiteratureSearchJobResult"
          },
          {
            "$ref": "#/components/schemas/FeedbackSplitResult"
          },
          {
            "$ref": "#/components/schemas/PlanAdjustmentResult"
          },
          {
            "$ref": "#/components/schemas/ProjectBackupResult"
          },
          {
            "$ref": "#/components/schemas/ProjectRestoreResult"
          },
          {
            "$ref": "#/components/schemas/OfficeImportResult"
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
  "LiteratureEntryCommand": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_version"
    ],
    "title": "LiteratureEntryCommand",
    "type": "object"
  },
  "LiteratureEntryCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "result_index": {
        "maximum": 19,
        "minimum": 0,
        "title": "Result Index",
        "type": "integer"
      },
      "search_id": {
        "format": "uuid",
        "title": "Search Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "search_id",
      "result_index"
    ],
    "title": "LiteratureEntryCreate",
    "type": "object"
  },
  "LiteratureEntryPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/LiteratureEntryRead"
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
    "title": "LiteratureEntryPage",
    "type": "object"
  },
  "LiteratureEntryRead": {
    "additionalProperties": false,
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
      "record": {
        "$ref": "#/components/schemas/LiteratureRecord"
      },
      "removed": {
        "title": "Removed",
        "type": "boolean"
      },
      "result_index": {
        "title": "Result Index",
        "type": "integer"
      },
      "retrieved_at": {
        "format": "date-time",
        "title": "Retrieved At",
        "type": "string"
      },
      "search_id": {
        "format": "uuid",
        "title": "Search Id",
        "type": "string"
      },
      "snapshot_id": {
        "format": "uuid",
        "title": "Snapshot Id",
        "type": "string"
      },
      "updated_at": {
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      },
      "verification": {
        "enum": [
          "verified",
          "conflict",
          "not_found",
          "unverified"
        ],
        "title": "Verification",
        "type": "string"
      },
      "verification_detail": {
        "$ref": "#/components/schemas/LiteratureVerificationDetail"
      },
      "verified_at": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Verified At"
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
      "removed",
      "search_id",
      "snapshot_id",
      "result_index",
      "record",
      "verification",
      "verification_detail",
      "verified_at",
      "retrieved_at",
      "created_at",
      "updated_at"
    ],
    "title": "LiteratureEntryRead",
    "type": "object"
  },
  "LiteratureEntryVersionPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/LiteratureEntryVersionRead"
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
    "title": "LiteratureEntryVersionPage",
    "type": "object"
  },
  "LiteratureEntryVersionRead": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "saved",
          "verified",
          "removed",
          "restored"
        ],
        "title": "Action",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "removed": {
        "title": "Removed",
        "type": "boolean"
      },
      "verification": {
        "enum": [
          "verified",
          "conflict",
          "not_found",
          "unverified"
        ],
        "title": "Verification",
        "type": "string"
      },
      "verification_detail": {
        "$ref": "#/components/schemas/LiteratureVerificationDetail"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "version",
      "action",
      "removed",
      "verification",
      "verification_detail",
      "created_at"
    ],
    "title": "LiteratureEntryVersionRead",
    "type": "object"
  },
  "LiteratureRecord": {
    "additionalProperties": false,
    "description": "A normalized record. Absent source fields stay None; nothing is inferred.",
    "properties": {
      "abstract": {
        "anyOf": [
          {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Abstract"
      },
      "authors": {
        "items": {
          "maxLength": 300,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "title": "Authors",
        "type": "array"
      },
      "coverage": {
        "enum": [
          "biblio",
          "abstract"
        ],
        "title": "Coverage",
        "type": "string"
      },
      "doi": {
        "anyOf": [
          {
            "maxLength": 320,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Doi"
      },
      "issue": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Issue"
      },
      "pages": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Pages"
      },
      "publisher": {
        "anyOf": [
          {
            "maxLength": 500,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Publisher"
      },
      "source": {
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
        "type": "string"
      },
      "source_id": {
        "maxLength": 400,
        "minLength": 1,
        "title": "Source Id",
        "type": "string"
      },
      "source_url": {
        "anyOf": [
          {
            "maxLength": 1000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Url"
      },
      "title": {
        "maxLength": 1000,
        "minLength": 1,
        "title": "Title",
        "type": "string"
      },
      "venue": {
        "anyOf": [
          {
            "maxLength": 500,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Venue"
      },
      "volume": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Volume"
      },
      "work_type": {
        "anyOf": [
          {
            "maxLength": 100,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Work Type"
      },
      "year": {
        "anyOf": [
          {
            "maximum": 2100,
            "minimum": 1000,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year"
      }
    },
    "required": [
      "source",
      "source_id",
      "doi",
      "title",
      "authors",
      "year",
      "venue",
      "publisher",
      "work_type",
      "abstract",
      "source_url",
      "coverage"
    ],
    "title": "LiteratureRecord",
    "type": "object"
  },
  "LiteratureResultItem": {
    "additionalProperties": false,
    "description": "A source record plus the project's current saved entry for the same work.",
    "properties": {
      "abstract": {
        "anyOf": [
          {
            "maxLength": 20000,
            "minLength": 1,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Abstract"
      },
      "authors": {
        "items": {
          "maxLength": 300,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 50,
        "title": "Authors",
        "type": "array"
      },
      "coverage": {
        "enum": [
          "biblio",
          "abstract"
        ],
        "title": "Coverage",
        "type": "string"
      },
      "doi": {
        "anyOf": [
          {
            "maxLength": 320,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Doi"
      },
      "index": {
        "maximum": 19,
        "minimum": 0,
        "title": "Index",
        "type": "integer"
      },
      "issue": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Issue"
      },
      "pages": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Pages"
      },
      "publisher": {
        "anyOf": [
          {
            "maxLength": 500,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Publisher"
      },
      "saved_entry_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Saved Entry Id"
      },
      "source": {
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
        "type": "string"
      },
      "source_id": {
        "maxLength": 400,
        "minLength": 1,
        "title": "Source Id",
        "type": "string"
      },
      "source_url": {
        "anyOf": [
          {
            "maxLength": 1000,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Url"
      },
      "title": {
        "maxLength": 1000,
        "minLength": 1,
        "title": "Title",
        "type": "string"
      },
      "venue": {
        "anyOf": [
          {
            "maxLength": 500,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Venue"
      },
      "volume": {
        "anyOf": [
          {
            "maxLength": 50,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Volume"
      },
      "work_type": {
        "anyOf": [
          {
            "maxLength": 100,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Work Type"
      },
      "year": {
        "anyOf": [
          {
            "maximum": 2100,
            "minimum": 1000,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year"
      }
    },
    "required": [
      "source",
      "source_id",
      "doi",
      "title",
      "authors",
      "year",
      "venue",
      "publisher",
      "work_type",
      "abstract",
      "source_url",
      "coverage",
      "index",
      "saved_entry_id"
    ],
    "title": "LiteratureResultItem",
    "type": "object"
  },
  "LiteratureSearchCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "query": {
        "maxLength": 300,
        "minLength": 1,
        "title": "Query",
        "type": "string"
      },
      "rows": {
        "default": 10,
        "maximum": 20,
        "minimum": 1,
        "title": "Rows",
        "type": "integer"
      },
      "source": {
        "default": "crossref",
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
        "type": "string"
      },
      "year_from": {
        "anyOf": [
          {
            "maximum": 2100,
            "minimum": 1900,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year From"
      },
      "year_to": {
        "anyOf": [
          {
            "maximum": 2100,
            "minimum": 1900,
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year To"
      }
    },
    "required": [
      "command_id",
      "query"
    ],
    "title": "LiteratureSearchCreate",
    "type": "object"
  },
  "LiteratureSearchInput": {
    "additionalProperties": false,
    "description": "The frozen search run owns the query, source and conditions.",
    "properties": {
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "search_id": {
        "format": "uuid",
        "title": "Search Id",
        "type": "string"
      }
    },
    "required": [
      "search_id"
    ],
    "title": "LiteratureSearchInput",
    "type": "object"
  },
  "LiteratureSearchJobResult": {
    "additionalProperties": false,
    "description": "Only references; the immutable snapshot lives in the literature module.",
    "properties": {
      "adapter_version": {
        "const": "thesispilot-literature-1",
        "title": "Adapter Version",
        "type": "string"
      },
      "item_count": {
        "maximum": 20,
        "minimum": 0,
        "title": "Item Count",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "literature_search",
        "title": "Kind",
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
      "response_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Response Sha256",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "search_id": {
        "format": "uuid",
        "title": "Search Id",
        "type": "string"
      },
      "snapshot_id": {
        "format": "uuid",
        "title": "Snapshot Id",
        "type": "string"
      },
      "source": {
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
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
      "schema_version",
      "job_id",
      "project_id",
      "search_id",
      "snapshot_id",
      "source",
      "adapter_version",
      "item_count",
      "response_sha256",
      "model_used",
      "writes_performed"
    ],
    "title": "LiteratureSearchJobResult",
    "type": "object"
  },
  "LiteratureSearchPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/LiteratureSearchRead"
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
    "title": "LiteratureSearchPage",
    "type": "object"
  },
  "LiteratureSearchRead": {
    "additionalProperties": false,
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "query": {
        "title": "Query",
        "type": "string"
      },
      "rows": {
        "title": "Rows",
        "type": "integer"
      },
      "snapshot": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/LiteratureSnapshotRead"
          },
          {
            "type": "null"
          }
        ]
      },
      "source": {
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
        "type": "string"
      },
      "source_search_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Search Id"
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
      },
      "year_from": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year From"
      },
      "year_to": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Year To"
      }
    },
    "required": [
      "id",
      "project_id",
      "job_id",
      "status",
      "attempt",
      "error_code",
      "query",
      "source",
      "year_from",
      "year_to",
      "rows",
      "source_search_id",
      "snapshot",
      "created_at",
      "updated_at"
    ],
    "title": "LiteratureSearchRead",
    "type": "object"
  },
  "LiteratureSearchReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "search": {
        "$ref": "#/components/schemas/LiteratureSearchRead"
      }
    },
    "required": [
      "search",
      "job"
    ],
    "title": "LiteratureSearchReceipt",
    "type": "object"
  },
  "LiteratureSearchRetry": {
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
    "title": "LiteratureSearchRetry",
    "type": "object"
  },
  "LiteratureSnapshotRead": {
    "additionalProperties": false,
    "properties": {
      "adapter_version": {
        "title": "Adapter Version",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "items": {
        "items": {
          "$ref": "#/components/schemas/LiteratureResultItem"
        },
        "title": "Items",
        "type": "array"
      },
      "response_sha256": {
        "title": "Response Sha256",
        "type": "string"
      },
      "retrieved_at": {
        "format": "date-time",
        "title": "Retrieved At",
        "type": "string"
      },
      "skipped_count": {
        "title": "Skipped Count",
        "type": "integer"
      },
      "source": {
        "enum": [
          "crossref",
          "openalex"
        ],
        "title": "Source",
        "type": "string"
      },
      "total_results": {
        "title": "Total Results",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "source",
      "adapter_version",
      "response_sha256",
      "total_results",
      "skipped_count",
      "retrieved_at",
      "items"
    ],
    "title": "LiteratureSnapshotRead",
    "type": "object"
  },
  "LiteratureVerificationDetail": {
    "additionalProperties": false,
    "description": "Deterministic DOI back-check outcome; registry values are kept for comparison.",
    "properties": {
      "checked": {
        "title": "Checked",
        "type": "boolean"
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
      "reason": {
        "enum": [
          "match",
          "title_mismatch",
          "year_mismatch",
          "doi_not_found",
          "no_doi",
          "lookup_failed"
        ],
        "title": "Reason",
        "type": "string"
      },
      "registry_title": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Registry Title"
      },
      "registry_year": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Registry Year"
      }
    },
    "required": [
      "checked",
      "reason"
    ],
    "title": "LiteratureVerificationDetail",
    "type": "object"
  },
  "LossItem": {
    "properties": {
      "detail": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Detail"
      },
      "kind": {
        "title": "Kind",
        "type": "string"
      },
      "path": {
        "title": "Path",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "path"
    ],
    "title": "LossItem",
    "type": "object"
  },
  "MaterialEvidence": {
    "additionalProperties": false,
    "properties": {
      "anchor_ids": {
        "items": {
          "maxLength": 200,
          "minLength": 1,
          "type": "string"
        },
        "maxItems": 20,
        "minItems": 1,
        "title": "Anchor Ids",
        "type": "array"
      },
      "kind": {
        "const": "material",
        "title": "Kind",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_id": {
        "format": "uuid",
        "title": "Original Id",
        "type": "string"
      },
      "parse_version_id": {
        "format": "uuid",
        "title": "Parse Version Id",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "material_id",
      "original_id",
      "parse_version_id",
      "anchor_ids"
    ],
    "title": "MaterialEvidence",
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
  "NotificationEventPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/NotificationEventRead"
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
    "title": "NotificationEventPage",
    "type": "object"
  },
  "NotificationEventRead": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "created",
          "read",
          "snooze",
          "dismiss",
          "restore",
          "progress_note",
          "snooze_expired"
        ],
        "title": "Action",
        "type": "string"
      },
      "actor": {
        "enum": [
          "student",
          "system"
        ],
        "title": "Actor",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "from_status": {
        "anyOf": [
          {
            "enum": [
              "unread",
              "read",
              "snoozed",
              "dismissed"
            ],
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "From Status"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "note": {
        "title": "Note",
        "type": "string"
      },
      "notification_id": {
        "format": "uuid",
        "title": "Notification Id",
        "type": "string"
      },
      "notification_title": {
        "title": "Notification Title",
        "type": "string"
      },
      "object": {
        "$ref": "#/components/schemas/ObjectRef"
      },
      "snooze_until": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Snooze Until"
      },
      "to_status": {
        "enum": [
          "unread",
          "read",
          "snoozed",
          "dismissed"
        ],
        "title": "To Status",
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
      "notification_id",
      "notification_title",
      "object",
      "version",
      "action",
      "actor",
      "from_status",
      "to_status",
      "snooze_until",
      "note",
      "created_at"
    ],
    "title": "NotificationEventRead",
    "type": "object"
  },
  "NotificationPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/NotificationRead"
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
      },
      "unread_count": {
        "title": "Unread Count",
        "type": "integer"
      }
    },
    "required": [
      "items",
      "total",
      "limit",
      "offset",
      "unread_count"
    ],
    "title": "NotificationPage",
    "type": "object"
  },
  "NotificationRead": {
    "additionalProperties": false,
    "properties": {
      "basis": {
        "items": {
          "type": "string"
        },
        "title": "Basis",
        "type": "array"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "dedupe_key": {
        "title": "Dedupe Key",
        "type": "string"
      },
      "delivery": {
        "enum": [
          "alerted",
          "quiet",
          "muted"
        ],
        "title": "Delivery",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "task_due_soon",
          "task_overdue",
          "feedback_stale",
          "project_deadline",
          "job_failed"
        ],
        "title": "Kind",
        "type": "string"
      },
      "object": {
        "$ref": "#/components/schemas/ObjectRef"
      },
      "progress_notes": {
        "items": {
          "$ref": "#/components/schemas/ProgressNote"
        },
        "title": "Progress Notes",
        "type": "array"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "snooze_until": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Snooze Until"
      },
      "status": {
        "enum": [
          "unread",
          "read",
          "snoozed",
          "dismissed"
        ],
        "title": "Status",
        "type": "string"
      },
      "title": {
        "title": "Title",
        "type": "string"
      },
      "trigger": {
        "title": "Trigger",
        "type": "string"
      },
      "uncertainty": {
        "title": "Uncertainty",
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
      "kind",
      "object",
      "dedupe_key",
      "title",
      "trigger",
      "basis",
      "uncertainty",
      "status",
      "delivery",
      "snooze_until",
      "progress_notes",
      "version",
      "created_at",
      "updated_at"
    ],
    "title": "NotificationRead",
    "type": "object"
  },
  "NotificationTransition": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "read",
          "snooze",
          "dismiss",
          "restore"
        ],
        "title": "Action",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "snooze_until": {
        "anyOf": [
          {
            "format": "date-time",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Snooze Until"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "action"
    ],
    "title": "NotificationTransition",
    "type": "object"
  },
  "ObjectRef": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "parent_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Parent Id"
      },
      "source_version": {
        "title": "Source Version",
        "type": "integer"
      },
      "type": {
        "enum": [
          "task",
          "feedback_item",
          "project",
          "job"
        ],
        "title": "Type",
        "type": "string"
      }
    },
    "required": [
      "type",
      "id",
      "parent_id",
      "source_version"
    ],
    "title": "ObjectRef",
    "type": "object"
  },
  "OfficeExportChange": {
    "additionalProperties": false,
    "properties": {
      "detail": {
        "maxLength": 400,
        "title": "Detail",
        "type": "string"
      },
      "kind": {
        "maxLength": 40,
        "title": "Kind",
        "type": "string"
      },
      "node_id": {
        "anyOf": [
          {
            "maxLength": 200,
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Node Id"
      }
    },
    "required": [
      "kind",
      "detail"
    ],
    "title": "OfficeExportChange",
    "type": "object"
  },
  "OfficeExportLoss": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "maxLength": 80,
        "title": "Kind",
        "type": "string"
      },
      "label": {
        "maxLength": 400,
        "title": "Label",
        "type": "string"
      },
      "path": {
        "maxLength": 200,
        "title": "Path",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "path",
      "label"
    ],
    "title": "OfficeExportLoss",
    "type": "object"
  },
  "OfficeExportReport": {
    "additionalProperties": false,
    "description": "What a Word/PDF export kept, could not express and what the kernel warned about.",
    "properties": {
      "applied_changes": {
        "minimum": 0,
        "title": "Applied Changes",
        "type": "integer"
      },
      "baseline_version": {
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
        "title": "Baseline Version"
      },
      "losses": {
        "items": {
          "$ref": "#/components/schemas/OfficeExportLoss"
        },
        "maxItems": 500,
        "title": "Losses",
        "type": "array"
      },
      "mode": {
        "enum": [
          "preserve",
          "regenerate"
        ],
        "title": "Mode",
        "type": "string"
      },
      "track_changes": {
        "title": "Track Changes",
        "type": "boolean"
      },
      "unsupported_changes": {
        "items": {
          "$ref": "#/components/schemas/OfficeExportChange"
        },
        "maxItems": 500,
        "title": "Unsupported Changes",
        "type": "array"
      },
      "warning_total": {
        "minimum": 0,
        "title": "Warning Total",
        "type": "integer"
      },
      "warnings": {
        "items": {
          "$ref": "#/components/schemas/OfficeExportWarning"
        },
        "maxItems": 200,
        "title": "Warnings",
        "type": "array"
      }
    },
    "required": [
      "mode",
      "track_changes",
      "baseline_version",
      "applied_changes",
      "unsupported_changes",
      "losses",
      "warnings",
      "warning_total"
    ],
    "title": "OfficeExportReport",
    "type": "object"
  },
  "OfficeExportWarning": {
    "additionalProperties": false,
    "properties": {
      "code": {
        "maxLength": 80,
        "title": "Code",
        "type": "string"
      },
      "message": {
        "maxLength": 300,
        "title": "Message",
        "type": "string"
      },
      "path": {
        "maxLength": 200,
        "title": "Path",
        "type": "string"
      }
    },
    "required": [
      "code",
      "path",
      "message"
    ],
    "title": "OfficeExportWarning",
    "type": "object"
  },
  "OfficeImportChapter": {
    "properties": {
      "id": {
        "title": "Id",
        "type": "string"
      },
      "level": {
        "title": "Level",
        "type": "integer"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "id",
      "title",
      "level"
    ],
    "title": "OfficeImportChapter",
    "type": "object"
  },
  "OfficeImportConfirm": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
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
        "title": "Expected Version"
      },
      "mode": {
        "enum": [
          "create",
          "new_version"
        ],
        "title": "Mode",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "mode"
    ],
    "title": "OfficeImportConfirm",
    "type": "object"
  },
  "OfficeImportCreate": {
    "additionalProperties": false,
    "description": "Identifies an immutable material original; the server reads and pins its bytes.",
    "properties": {
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_id": {
        "format": "uuid",
        "title": "Original Id",
        "type": "string"
      }
    },
    "required": [
      "material_id",
      "original_id"
    ],
    "title": "OfficeImportCreate",
    "type": "object"
  },
  "OfficeImportInput": {
    "additionalProperties": false,
    "description": "Server-fixed: one immutable material original, identified by id and digest.",
    "properties": {
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_id": {
        "format": "uuid",
        "title": "Original Id",
        "type": "string"
      },
      "original_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Original Sha256",
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
      "original_id",
      "original_sha256"
    ],
    "title": "OfficeImportInput",
    "type": "object"
  },
  "OfficeImportLoss": {
    "properties": {
      "action": {
        "enum": [
          "protected",
          "noted"
        ],
        "title": "Action",
        "type": "string"
      },
      "detail": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Detail"
      },
      "kind": {
        "title": "Kind",
        "type": "string"
      },
      "label": {
        "title": "Label",
        "type": "string"
      },
      "node_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Node Id"
      },
      "path": {
        "title": "Path",
        "type": "string"
      }
    },
    "required": [
      "kind",
      "path",
      "label",
      "action"
    ],
    "title": "OfficeImportLoss",
    "type": "object"
  },
  "OfficeImportObject": {
    "properties": {
      "block_type": {
        "title": "Block Type",
        "type": "string"
      },
      "excerpt": {
        "title": "Excerpt",
        "type": "string"
      },
      "node_id": {
        "title": "Node Id",
        "type": "string"
      }
    },
    "required": [
      "node_id",
      "block_type",
      "excerpt"
    ],
    "title": "OfficeImportObject",
    "type": "object"
  },
  "OfficeImportPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/OfficeImportRead"
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
    "title": "OfficeImportPage",
    "type": "object"
  },
  "OfficeImportPreview": {
    "properties": {
      "append_blocked_reason": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Append Blocked Reason"
      },
      "block_count": {
        "title": "Block Count",
        "type": "integer"
      },
      "can_append": {
        "title": "Can Append",
        "type": "boolean"
      },
      "can_create": {
        "title": "Can Create",
        "type": "boolean"
      },
      "chapters": {
        "items": {
          "$ref": "#/components/schemas/OfficeImportChapter"
        },
        "title": "Chapters",
        "type": "array"
      },
      "chapters_truncated": {
        "title": "Chapters Truncated",
        "type": "boolean"
      },
      "converter": {
        "title": "Converter",
        "type": "string"
      },
      "existing_document_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Existing Document Id"
      },
      "existing_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Existing Version"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "image_count": {
        "title": "Image Count",
        "type": "integer"
      },
      "import_id": {
        "format": "uuid",
        "title": "Import Id",
        "type": "string"
      },
      "losses": {
        "items": {
          "$ref": "#/components/schemas/OfficeImportLoss"
        },
        "title": "Losses",
        "type": "array"
      },
      "objects": {
        "items": {
          "$ref": "#/components/schemas/OfficeImportObject"
        },
        "title": "Objects",
        "type": "array"
      },
      "original_sha256": {
        "title": "Original Sha256",
        "type": "string"
      },
      "paragraph_count": {
        "title": "Paragraph Count",
        "type": "integer"
      },
      "table_count": {
        "title": "Table Count",
        "type": "integer"
      },
      "text_characters": {
        "title": "Text Characters",
        "type": "integer"
      }
    },
    "required": [
      "import_id",
      "filename",
      "original_sha256",
      "converter",
      "block_count",
      "paragraph_count",
      "table_count",
      "image_count",
      "text_characters",
      "chapters",
      "chapters_truncated",
      "objects",
      "losses",
      "existing_document_id",
      "existing_version",
      "can_create",
      "can_append",
      "append_blocked_reason"
    ],
    "title": "OfficeImportPreview",
    "type": "object"
  },
  "OfficeImportRead": {
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "material_id": {
        "format": "uuid",
        "title": "Material Id",
        "type": "string"
      },
      "original_id": {
        "format": "uuid",
        "title": "Original Id",
        "type": "string"
      },
      "original_sha256": {
        "title": "Original Sha256",
        "type": "string"
      },
      "preview": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/OfficeImportPreview"
          },
          {
            "type": "null"
          }
        ]
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
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
      "job_id",
      "project_id",
      "status",
      "attempt",
      "material_id",
      "original_id",
      "original_sha256",
      "source_job_id",
      "error_code",
      "preview",
      "created_at",
      "updated_at"
    ],
    "title": "OfficeImportRead",
    "type": "object"
  },
  "OfficeImportReceipt": {
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "document_id": {
        "format": "uuid",
        "title": "Document Id",
        "type": "string"
      },
      "document_version": {
        "title": "Document Version",
        "type": "integer"
      },
      "import_id": {
        "format": "uuid",
        "title": "Import Id",
        "type": "string"
      },
      "mode": {
        "enum": [
          "create",
          "new_version"
        ],
        "title": "Mode",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "import_id",
      "document_id",
      "document_version",
      "mode"
    ],
    "title": "OfficeImportReceipt",
    "type": "object"
  },
  "OfficeImportResult": {
    "additionalProperties": false,
    "properties": {
      "block_count": {
        "maximum": 10000000,
        "minimum": 0,
        "title": "Block Count",
        "type": "integer"
      },
      "chapter_count": {
        "maximum": 10000000,
        "minimum": 0,
        "title": "Chapter Count",
        "type": "integer"
      },
      "import_id": {
        "format": "uuid",
        "title": "Import Id",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "office_import",
        "title": "Kind",
        "type": "string"
      },
      "loss_count": {
        "maximum": 10000000,
        "minimum": 0,
        "title": "Loss Count",
        "type": "integer"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "object_count": {
        "maximum": 10000000,
        "minimum": 0,
        "title": "Object Count",
        "type": "integer"
      },
      "original_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Original Sha256",
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
      "import_id",
      "original_sha256",
      "block_count",
      "chapter_count",
      "object_count",
      "loss_count",
      "model_used",
      "writes_performed"
    ],
    "title": "OfficeImportResult",
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
  "PlanAdjustmentCreate": {
    "additionalProperties": false,
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "agent_config_version_id"
    ],
    "title": "PlanAdjustmentCreate",
    "type": "object"
  },
  "PlanAdjustmentDecide": {
    "additionalProperties": false,
    "properties": {
      "accepted_item_ids": {
        "items": {
          "pattern": "^A[1-9][0-9]{0,2}$",
          "type": "string"
        },
        "maxItems": 100,
        "title": "Accepted Item Ids",
        "type": "array"
      },
      "action": {
        "enum": [
          "adopt",
          "keep"
        ],
        "title": "Action",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "action"
    ],
    "title": "PlanAdjustmentDecide",
    "type": "object"
  },
  "PlanAdjustmentInput": {
    "additionalProperties": false,
    "description": "SG-10 plan adjustment: the frozen adjustment record owns every input version.",
    "properties": {
      "adjustment_id": {
        "format": "uuid",
        "title": "Adjustment Id",
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
      "adjustment_id"
    ],
    "title": "PlanAdjustmentInput",
    "type": "object"
  },
  "PlanAdjustmentItem": {
    "additionalProperties": false,
    "properties": {
      "after": {
        "$ref": "#/components/schemas/DateRange"
      },
      "base_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Base Version"
      },
      "before": {
        "$ref": "#/components/schemas/DateRange"
      },
      "blocked": {
        "title": "Blocked",
        "type": "boolean"
      },
      "id": {
        "pattern": "^A[1-9][0-9]{0,2}$",
        "title": "Id",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "task_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Task Id"
      },
      "task_key": {
        "title": "Task Key",
        "type": "string"
      },
      "title": {
        "title": "Title",
        "type": "string"
      },
      "violations": {
        "items": {
          "$ref": "#/components/schemas/PlanViolation"
        },
        "title": "Violations",
        "type": "array"
      }
    },
    "required": [
      "id",
      "task_key",
      "task_id",
      "title",
      "base_version",
      "before",
      "after",
      "reason",
      "blocked",
      "violations"
    ],
    "title": "PlanAdjustmentItem",
    "type": "object"
  },
  "PlanAdjustmentPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/PlanAdjustmentRead"
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
    "title": "PlanAdjustmentPage",
    "type": "object"
  },
  "PlanAdjustmentRead": {
    "additionalProperties": false,
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "agent_name": {
        "title": "Agent Name",
        "type": "string"
      },
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "base_plan_version": {
        "title": "Base Plan Version",
        "type": "integer"
      },
      "config_version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Config Version Ids",
        "type": "object"
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
      "decision": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/PlanDecisionRead"
          },
          {
            "type": "null"
          }
        ]
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
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
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "proposal": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/PlanProposalContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "requested_model": {
        "anyOf": [
          {
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
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Response Model"
      },
      "revert": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/PlanDecisionRead"
          },
          {
            "type": "null"
          }
        ]
      },
      "state": {
        "enum": [
          "queued",
          "running",
          "failed",
          "cancelled",
          "pending",
          "expired",
          "adopted",
          "kept",
          "reverted"
        ],
        "title": "State",
        "type": "string"
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
      "task_count": {
        "title": "Task Count",
        "type": "integer"
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
      "job_id",
      "status",
      "state",
      "error_code",
      "attempt",
      "base_plan_version",
      "agent_config_version_id",
      "agent_name",
      "config_version_ids",
      "deadline",
      "planning_mode",
      "task_count",
      "requested_model",
      "response_model",
      "proposal",
      "decision",
      "revert",
      "created_at",
      "updated_at"
    ],
    "title": "PlanAdjustmentRead",
    "type": "object"
  },
  "PlanAdjustmentReceipt": {
    "properties": {
      "adjustment": {
        "$ref": "#/components/schemas/PlanAdjustmentRead"
      },
      "job": {
        "$ref": "#/components/schemas/JobRead"
      }
    },
    "required": [
      "adjustment",
      "job"
    ],
    "title": "PlanAdjustmentReceipt",
    "type": "object"
  },
  "PlanAdjustmentResult": {
    "additionalProperties": false,
    "description": "Only references; the immutable proposal lives in the project-scoped plans module.",
    "properties": {
      "adjustment_id": {
        "format": "uuid",
        "title": "Adjustment Id",
        "type": "string"
      },
      "blocked_count": {
        "maximum": 100,
        "minimum": 0,
        "title": "Blocked Count",
        "type": "integer"
      },
      "item_count": {
        "maximum": 100,
        "minimum": 0,
        "title": "Item Count",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "plan_adjustment",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": true,
        "title": "Model Used",
        "type": "boolean"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "proposal_id": {
        "format": "uuid",
        "title": "Proposal Id",
        "type": "string"
      },
      "requested_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Requested Model",
        "type": "string"
      },
      "response_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Response Model",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
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
      "adjustment_id",
      "proposal_id",
      "item_count",
      "blocked_count",
      "requested_model",
      "response_model",
      "model_used",
      "writes_performed"
    ],
    "title": "PlanAdjustmentResult",
    "type": "object"
  },
  "PlanAdjustmentRevert": {
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
    "title": "PlanAdjustmentRevert",
    "type": "object"
  },
  "PlanChange": {
    "additionalProperties": false,
    "properties": {
      "after": {
        "$ref": "#/components/schemas/DateRange"
      },
      "after_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "After Version",
        "type": "integer"
      },
      "before": {
        "$ref": "#/components/schemas/DateRange"
      },
      "before_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Before Version",
        "type": "integer"
      },
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
        "type": "string"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "task_id",
      "title",
      "before",
      "after",
      "before_version",
      "after_version"
    ],
    "title": "PlanChange",
    "type": "object"
  },
  "PlanDecisionRead": {
    "additionalProperties": false,
    "properties": {
      "accepted_item_ids": {
        "items": {
          "type": "string"
        },
        "title": "Accepted Item Ids",
        "type": "array"
      },
      "action": {
        "enum": [
          "adopt",
          "keep",
          "revert"
        ],
        "title": "Action",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "plan_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Plan Version"
      },
      "rejected_item_ids": {
        "items": {
          "type": "string"
        },
        "title": "Rejected Item Ids",
        "type": "array"
      }
    },
    "required": [
      "action",
      "accepted_item_ids",
      "rejected_item_ids",
      "plan_version",
      "created_at"
    ],
    "title": "PlanDecisionRead",
    "type": "object"
  },
  "PlanProposalContent": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/PlanAdjustmentItem"
        },
        "title": "Items",
        "type": "array"
      },
      "notes": {
        "items": {
          "type": "string"
        },
        "title": "Notes",
        "type": "array"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "summary": {
        "title": "Summary",
        "type": "string"
      }
    },
    "required": [
      "schema_version",
      "summary",
      "items",
      "notes"
    ],
    "title": "PlanProposalContent",
    "type": "object"
  },
  "PlanRead": {
    "additionalProperties": false,
    "properties": {
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
      "latest_adjustment_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Latest Adjustment Id"
      },
      "plan_version": {
        "title": "Plan Version",
        "type": "integer"
      },
      "planning_mode": {
        "enum": [
          "none",
          "personal"
        ],
        "title": "Planning Mode",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      }
    },
    "required": [
      "project_id",
      "plan_version",
      "deadline",
      "planning_mode",
      "latest_adjustment_id"
    ],
    "title": "PlanRead",
    "type": "object"
  },
  "PlanSchedule": {
    "additionalProperties": false,
    "properties": {
      "changes": {
        "items": {
          "$ref": "#/components/schemas/ScheduleChange"
        },
        "maxItems": 100,
        "minItems": 1,
        "title": "Changes",
        "type": "array"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "reason": {
        "default": "",
        "maxLength": 500,
        "title": "Reason",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "changes"
    ],
    "title": "PlanSchedule",
    "type": "object"
  },
  "PlanTaskState": {
    "additionalProperties": false,
    "properties": {
      "archived": {
        "title": "Archived",
        "type": "boolean"
      },
      "depends_on": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Depends On",
        "type": "array"
      },
      "due_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Due Date"
      },
      "hard_deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Hard Deadline"
      },
      "position": {
        "title": "Position",
        "type": "integer"
      },
      "start_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start Date"
      },
      "status": {
        "enum": [
          "todo",
          "doing",
          "verify",
          "confirmed",
          "rework"
        ],
        "title": "Status",
        "type": "string"
      },
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
        "type": "string"
      },
      "title": {
        "title": "Title",
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
      "task_id",
      "version",
      "position",
      "title",
      "status",
      "archived",
      "start_date",
      "due_date",
      "hard_deadline",
      "depends_on"
    ],
    "title": "PlanTaskState",
    "type": "object"
  },
  "PlanVersionPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/PlanVersionRead"
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
    "title": "PlanVersionPage",
    "type": "object"
  },
  "PlanVersionRead": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "adopt",
          "revert",
          "manual"
        ],
        "title": "Action",
        "type": "string"
      },
      "adjustment_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Adjustment Id"
      },
      "changes": {
        "items": {
          "$ref": "#/components/schemas/PlanChange"
        },
        "title": "Changes",
        "type": "array"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "tasks": {
        "items": {
          "$ref": "#/components/schemas/PlanTaskState"
        },
        "title": "Tasks",
        "type": "array"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "project_id",
      "version",
      "action",
      "reason",
      "adjustment_id",
      "changes",
      "tasks",
      "created_at"
    ],
    "title": "PlanVersionRead",
    "type": "object"
  },
  "PlanViolation": {
    "additionalProperties": false,
    "properties": {
      "code": {
        "enum": [
          "UNKNOWN_TASK",
          "ARCHIVED_TASK",
          "CONFIRMED_TASK",
          "DUPLICATE",
          "INVALID_DATE",
          "NO_CHANGE",
          "DATE_ORDER",
          "PAST_DATE",
          "HARD_DEADLINE",
          "PROJECT_DEADLINE",
          "DEPENDENCY_ORDER"
        ],
        "title": "Code",
        "type": "string"
      },
      "message": {
        "title": "Message",
        "type": "string"
      }
    },
    "required": [
      "code",
      "message"
    ],
    "title": "PlanViolation",
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
  "ProgressNote": {
    "additionalProperties": false,
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "text": {
        "title": "Text",
        "type": "string"
      }
    },
    "required": [
      "text",
      "created_at"
    ],
    "title": "ProgressNote",
    "type": "object"
  },
  "ProgressNoteCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "text": {
        "maxLength": 2000,
        "minLength": 1,
        "title": "Text",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "text"
    ],
    "title": "ProgressNoteCreate",
    "type": "object"
  },
  "ProjectBackupInput": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "project_backup",
        "default": "project_backup",
        "title": "Kind",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
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
      "project_id"
    ],
    "title": "ProjectBackupInput",
    "type": "object"
  },
  "ProjectBackupResult": {
    "additionalProperties": false,
    "properties": {
      "archive_id": {
        "format": "uuid",
        "title": "Archive Id",
        "type": "string"
      },
      "byte_size": {
        "maximum": 268435456,
        "minimum": 1,
        "title": "Byte Size",
        "type": "integer"
      },
      "filename": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Filename",
        "type": "string"
      },
      "format": {
        "const": "thesispilot-backup/1",
        "title": "Format",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "project_backup",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "object_counts": {
        "maxProperties": 200,
        "patternProperties": {
          "^[a-z][a-z0-9_]{0,62}$": {
            "minimum": 0,
            "type": "integer"
          }
        },
        "title": "Object Counts",
        "type": "object"
      },
      "package_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Package Sha256",
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
      "sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Sha256",
        "type": "string"
      },
      "writes_performed": {
        "const": false,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "schema_version",
      "job_id",
      "project_id",
      "package_sha256",
      "format",
      "object_counts",
      "model_used",
      "kind",
      "archive_id",
      "filename",
      "sha256",
      "byte_size",
      "writes_performed"
    ],
    "title": "ProjectBackupResult",
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
  "ProjectRestoreInput": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "project_restore",
        "default": "project_restore",
        "title": "Kind",
        "type": "string"
      },
      "restore_id": {
        "format": "uuid",
        "title": "Restore Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "upload_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Upload Sha256",
        "type": "string"
      }
    },
    "required": [
      "restore_id",
      "upload_sha256"
    ],
    "title": "ProjectRestoreInput",
    "type": "object"
  },
  "ProjectRestoreResult": {
    "additionalProperties": false,
    "description": "``project_id`` is the new copy; the source project is never written.",
    "properties": {
      "format": {
        "const": "thesispilot-backup/1",
        "title": "Format",
        "type": "string"
      },
      "interrupted_jobs": {
        "minimum": 0,
        "title": "Interrupted Jobs",
        "type": "integer"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "project_restore",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": false,
        "title": "Model Used",
        "type": "boolean"
      },
      "object_counts": {
        "maxProperties": 200,
        "patternProperties": {
          "^[a-z][a-z0-9_]{0,62}$": {
            "minimum": 0,
            "type": "integer"
          }
        },
        "title": "Object Counts",
        "type": "object"
      },
      "package_sha256": {
        "pattern": "^[0-9a-f]{64}$",
        "title": "Package Sha256",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "restore_id": {
        "format": "uuid",
        "title": "Restore Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "source_project_id": {
        "format": "uuid",
        "title": "Source Project Id",
        "type": "string"
      },
      "writes_performed": {
        "const": true,
        "title": "Writes Performed",
        "type": "boolean"
      }
    },
    "required": [
      "schema_version",
      "job_id",
      "project_id",
      "package_sha256",
      "format",
      "object_counts",
      "model_used",
      "kind",
      "restore_id",
      "source_project_id",
      "interrupted_jobs",
      "writes_performed"
    ],
    "title": "ProjectRestoreResult",
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
  "RefreshResult": {
    "additionalProperties": false,
    "properties": {
      "created": {
        "title": "Created",
        "type": "integer"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "unread_count": {
        "title": "Unread Count",
        "type": "integer"
      },
      "woken": {
        "title": "Woken",
        "type": "integer"
      }
    },
    "required": [
      "project_id",
      "created",
      "woken",
      "unread_count"
    ],
    "title": "RefreshResult",
    "type": "object"
  },
  "ReminderSettingsRead": {
    "additionalProperties": false,
    "properties": {
      "cooldown_hours": {
        "title": "Cooldown Hours",
        "type": "integer"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "overdue_days": {
        "title": "Overdue Days",
        "type": "integer"
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
      "version",
      "enabled",
      "cooldown_hours",
      "overdue_days",
      "updated_at"
    ],
    "title": "ReminderSettingsRead",
    "type": "object"
  },
  "ReminderSettingsUpdate": {
    "additionalProperties": false,
    "properties": {
      "cooldown_hours": {
        "maximum": 168,
        "minimum": 1,
        "title": "Cooldown Hours",
        "type": "integer"
      },
      "enabled": {
        "title": "Enabled",
        "type": "boolean"
      },
      "expected_version": {
        "maximum": 2147483646,
        "minimum": 0,
        "title": "Expected Version",
        "type": "integer"
      },
      "overdue_days": {
        "maximum": 30,
        "minimum": 1,
        "title": "Overdue Days",
        "type": "integer"
      }
    },
    "required": [
      "expected_version",
      "enabled",
      "cooldown_hours",
      "overdue_days"
    ],
    "title": "ReminderSettingsUpdate",
    "type": "object"
  },
  "RestorePage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/RestoreRead"
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
    "title": "RestorePage",
    "type": "object"
  },
  "RestoreRead": {
    "description": "``result_project_id`` is set only when the new copy has been committed.",
    "properties": {
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "byte_size": {
        "title": "Byte Size",
        "type": "integer"
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
      "exported_at": {
        "format": "date-time",
        "title": "Exported At",
        "type": "string"
      },
      "filename": {
        "title": "Filename",
        "type": "string"
      },
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "object_counts": {
        "additionalProperties": {
          "type": "integer"
        },
        "title": "Object Counts",
        "type": "object"
      },
      "package_sha256": {
        "title": "Package Sha256",
        "type": "string"
      },
      "restore_id": {
        "format": "uuid",
        "title": "Restore Id",
        "type": "string"
      },
      "result_project_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Result Project Id"
      },
      "schema_head": {
        "title": "Schema Head",
        "type": "string"
      },
      "sha256": {
        "title": "Sha256",
        "type": "string"
      },
      "source_project_id": {
        "format": "uuid",
        "title": "Source Project Id",
        "type": "string"
      },
      "source_project_name": {
        "title": "Source Project Name",
        "type": "string"
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
      "job_id",
      "restore_id",
      "status",
      "attempt",
      "error_code",
      "filename",
      "sha256",
      "byte_size",
      "package_sha256",
      "source_project_id",
      "source_project_name",
      "schema_head",
      "exported_at",
      "object_counts",
      "result_project_id",
      "created_at",
      "updated_at"
    ],
    "title": "RestoreRead",
    "type": "object"
  },
  "ReviewBasis": {
    "additionalProperties": false,
    "properties": {
      "item_id": {
        "title": "Item Id",
        "type": "string"
      },
      "key": {
        "title": "Key",
        "type": "string"
      },
      "kind": {
        "enum": [
          "requirement",
          "template",
          "rubric"
        ],
        "title": "Kind",
        "type": "string"
      },
      "label": {
        "title": "Label",
        "type": "string"
      },
      "source_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Id"
      }
    },
    "required": [
      "key",
      "kind",
      "label",
      "source_id",
      "item_id"
    ],
    "title": "ReviewBasis",
    "type": "object"
  },
  "ReviewCreate": {
    "additionalProperties": false,
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "chapter_id": {
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
        "title": "Chapter Id"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
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
      "rubric_version": {
        "maxLength": 64,
        "minLength": 1,
        "title": "Rubric Version",
        "type": "string"
      },
      "source_binding_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Binding Version Id"
      }
    },
    "required": [
      "command_id",
      "document_id",
      "document_version",
      "rubric_version",
      "agent_config_version_id"
    ],
    "title": "ReviewCreate",
    "type": "object"
  },
  "ReviewInput": {
    "additionalProperties": false,
    "description": "Independent review: the frozen review run owns every input version.",
    "properties": {
      "review_id": {
        "format": "uuid",
        "title": "Review Id",
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
      "review_id"
    ],
    "title": "ReviewInput",
    "type": "object"
  },
  "ReviewIssue": {
    "additionalProperties": false,
    "properties": {
      "basis": {
        "items": {
          "$ref": "#/components/schemas/ReviewBasis"
        },
        "title": "Basis",
        "type": "array"
      },
      "basis_status": {
        "enum": [
          "cited",
          "missing"
        ],
        "title": "Basis Status",
        "type": "string"
      },
      "direction": {
        "title": "Direction",
        "type": "string"
      },
      "explanation": {
        "title": "Explanation",
        "type": "string"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "location": {
        "$ref": "#/components/schemas/ReviewLocation"
      },
      "severity": {
        "enum": [
          "major",
          "minor",
          "advice"
        ],
        "title": "Severity",
        "type": "string"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "id",
      "severity",
      "title",
      "explanation",
      "direction",
      "location",
      "basis",
      "basis_status"
    ],
    "title": "ReviewIssue",
    "type": "object"
  },
  "ReviewLocation": {
    "additionalProperties": false,
    "description": "Without ``node_id`` (v1 reports): UTF-16 offsets in the reviewed block's plain text.\n\nWith ``node_id`` (v2 versions): the confirmed node — the heading for a chapter, the top\nblock for a block, or the paragraph/heading holding the quote — and Unicode scalar\noffsets in that node's text, the writing page's anchor unit.",
    "properties": {
      "block_index": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Block Index"
      },
      "chapter_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Chapter Id"
      },
      "chapter_title": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Chapter Title"
      },
      "end": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "End"
      },
      "node_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Node Id"
      },
      "quote": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Quote"
      },
      "start": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      },
      "status": {
        "enum": [
          "range",
          "block",
          "chapter",
          "unlocated"
        ],
        "title": "Status",
        "type": "string"
      }
    },
    "required": [
      "status",
      "chapter_id",
      "chapter_title",
      "block_index",
      "start",
      "end",
      "quote"
    ],
    "title": "ReviewLocation",
    "type": "object"
  },
  "ReviewPage": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/ReviewRead"
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
    "title": "ReviewPage",
    "type": "object"
  },
  "ReviewRead": {
    "properties": {
      "agent_config_version_id": {
        "format": "uuid",
        "title": "Agent Config Version Id",
        "type": "string"
      },
      "agent_name": {
        "title": "Agent Name",
        "type": "string"
      },
      "attempt": {
        "title": "Attempt",
        "type": "integer"
      },
      "chapter_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Chapter Id"
      },
      "config_version_ids": {
        "additionalProperties": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Config Version Ids",
        "type": "object"
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
        "title": "Document Version",
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
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "report_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Report Id"
      },
      "requirement_parse_version_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Requirement Parse Version Ids",
        "type": "array"
      },
      "rubric_version": {
        "title": "Rubric Version",
        "type": "string"
      },
      "scope_title": {
        "title": "Scope Title",
        "type": "string"
      },
      "source_binding_version_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Binding Version Id"
      },
      "source_review_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Source Review Id"
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
        "format": "date-time",
        "title": "Updated At",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "job_id",
      "status",
      "error_code",
      "attempt",
      "document_id",
      "document_version",
      "chapter_id",
      "scope_title",
      "rubric_version",
      "agent_config_version_id",
      "agent_name",
      "config_version_ids",
      "source_binding_version_id",
      "template_parse_version_id",
      "requirement_parse_version_ids",
      "source_review_id",
      "report_id",
      "created_at",
      "updated_at"
    ],
    "title": "ReviewRead",
    "type": "object"
  },
  "ReviewReceipt": {
    "properties": {
      "job": {
        "$ref": "#/components/schemas/JobRead"
      },
      "review": {
        "$ref": "#/components/schemas/ReviewRead"
      }
    },
    "required": [
      "review",
      "job"
    ],
    "title": "ReviewReceipt",
    "type": "object"
  },
  "ReviewReportContent": {
    "additionalProperties": false,
    "properties": {
      "issues": {
        "items": {
          "$ref": "#/components/schemas/ReviewIssue"
        },
        "title": "Issues",
        "type": "array"
      },
      "limitations": {
        "items": {
          "type": "string"
        },
        "title": "Limitations",
        "type": "array"
      },
      "rubric": {
        "$ref": "#/components/schemas/ReviewRubricRead"
      },
      "schema_version": {
        "const": 1,
        "default": 1,
        "title": "Schema Version",
        "type": "integer"
      },
      "scope": {
        "$ref": "#/components/schemas/ReviewScopeRead"
      },
      "scores": {
        "items": {
          "$ref": "#/components/schemas/ReviewScore"
        },
        "title": "Scores",
        "type": "array"
      },
      "summary": {
        "title": "Summary",
        "type": "string"
      },
      "unchecked": {
        "items": {
          "$ref": "#/components/schemas/ReviewUnchecked"
        },
        "title": "Unchecked",
        "type": "array"
      }
    },
    "required": [
      "summary",
      "rubric",
      "scope",
      "scores",
      "issues",
      "unchecked",
      "limitations"
    ],
    "title": "ReviewReportContent",
    "type": "object"
  },
  "ReviewReportRead": {
    "properties": {
      "content": {
        "$ref": "#/components/schemas/ReviewReportContent"
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
        "title": "Document Version",
        "type": "integer"
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
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "requested_model": {
        "title": "Requested Model",
        "type": "string"
      },
      "response_model": {
        "title": "Response Model",
        "type": "string"
      },
      "review_id": {
        "format": "uuid",
        "title": "Review Id",
        "type": "string"
      }
    },
    "required": [
      "id",
      "review_id",
      "project_id",
      "job_id",
      "document_id",
      "document_version",
      "requested_model",
      "response_model",
      "content",
      "created_at"
    ],
    "title": "ReviewReportRead",
    "type": "object"
  },
  "ReviewResult": {
    "additionalProperties": false,
    "description": "Only references; the immutable report lives in the project-scoped review module.",
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
      "job_id": {
        "format": "uuid",
        "title": "Job Id",
        "type": "string"
      },
      "kind": {
        "const": "review",
        "title": "Kind",
        "type": "string"
      },
      "model_used": {
        "const": true,
        "title": "Model Used",
        "type": "boolean"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "report_id": {
        "format": "uuid",
        "title": "Report Id",
        "type": "string"
      },
      "requested_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Requested Model",
        "type": "string"
      },
      "response_model": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Response Model",
        "type": "string"
      },
      "review_id": {
        "format": "uuid",
        "title": "Review Id",
        "type": "string"
      },
      "schema_version": {
        "const": 1,
        "title": "Schema Version",
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
      "review_id",
      "report_id",
      "document_id",
      "document_version",
      "requested_model",
      "response_model",
      "model_used",
      "writes_performed"
    ],
    "title": "ReviewResult",
    "type": "object"
  },
  "ReviewRetry": {
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
    "title": "ReviewRetry",
    "type": "object"
  },
  "ReviewRubricDimension": {
    "additionalProperties": false,
    "properties": {
      "description": {
        "title": "Description",
        "type": "string"
      },
      "full": {
        "title": "Full",
        "type": "integer"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      }
    },
    "required": [
      "id",
      "name",
      "full",
      "description"
    ],
    "title": "ReviewRubricDimension",
    "type": "object"
  },
  "ReviewRubricList": {
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/ReviewRubricRead"
        },
        "title": "Items",
        "type": "array"
      }
    },
    "required": [
      "items"
    ],
    "title": "ReviewRubricList",
    "type": "object"
  },
  "ReviewRubricRead": {
    "additionalProperties": false,
    "properties": {
      "description": {
        "title": "Description",
        "type": "string"
      },
      "dimensions": {
        "items": {
          "$ref": "#/components/schemas/ReviewRubricDimension"
        },
        "title": "Dimensions",
        "type": "array"
      },
      "limitations": {
        "items": {
          "type": "string"
        },
        "title": "Limitations",
        "type": "array"
      },
      "title": {
        "title": "Title",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "string"
      }
    },
    "required": [
      "version",
      "title",
      "description",
      "dimensions",
      "limitations"
    ],
    "title": "ReviewRubricRead",
    "type": "object"
  },
  "ReviewScopeRead": {
    "additionalProperties": false,
    "properties": {
      "chapter_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Chapter Id"
      },
      "title": {
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "chapter_id",
      "title"
    ],
    "title": "ReviewScopeRead",
    "type": "object"
  },
  "ReviewScore": {
    "additionalProperties": false,
    "properties": {
      "dimension_id": {
        "title": "Dimension Id",
        "type": "string"
      },
      "full": {
        "title": "Full",
        "type": "integer"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "score": {
        "anyOf": [
          {
            "type": "number"
          },
          {
            "type": "null"
          }
        ],
        "title": "Score"
      }
    },
    "required": [
      "dimension_id",
      "name",
      "full",
      "score",
      "reason"
    ],
    "title": "ReviewScore",
    "type": "object"
  },
  "ReviewUnchecked": {
    "additionalProperties": false,
    "properties": {
      "item": {
        "title": "Item",
        "type": "string"
      },
      "origin": {
        "enum": [
          "model",
          "system"
        ],
        "title": "Origin",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      }
    },
    "required": [
      "item",
      "reason",
      "origin"
    ],
    "title": "ReviewUnchecked",
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
      "end": {
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
        "title": "End"
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
      "start": {
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
        "title": "Start"
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
        "oneOf": [
          {
            "$ref": "#/components/schemas/RevisionSelection"
          },
          {
            "$ref": "#/components/schemas/RevisionNodeSelection"
          }
        ],
        "title": "Selection"
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
  "RevisionNodePatch": {
    "additionalProperties": false,
    "description": "v2 patch: scalar offsets into the selected node's atom text.",
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
      "end": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "End",
        "type": "integer"
      },
      "id": {
        "maxLength": 100,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_-]+$",
        "title": "Id",
        "type": "string"
      },
      "start": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Start",
        "type": "integer"
      }
    },
    "required": [
      "id",
      "start",
      "end",
      "before",
      "after"
    ],
    "title": "RevisionNodePatch",
    "type": "object"
  },
  "RevisionNodeSelection": {
    "additionalProperties": false,
    "description": "v2 anchor: one body paragraph/heading, scalar offsets, exact expected text.",
    "properties": {
      "end": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "End",
        "type": "integer"
      },
      "expected_text": {
        "maxLength": 32768,
        "minLength": 1,
        "title": "Expected Text",
        "type": "string"
      },
      "node_id": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Node Id",
        "type": "string"
      },
      "start": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Start",
        "type": "integer"
      }
    },
    "required": [
      "node_id",
      "start",
      "end",
      "expected_text"
    ],
    "title": "RevisionNodeSelection",
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
          "oneOf": [
            {
              "$ref": "#/components/schemas/RevisionPatch"
            },
            {
              "$ref": "#/components/schemas/RevisionNodePatch"
            }
          ]
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
      "content_schema_version": {
        "default": 1,
        "enum": [
          1,
          2
        ],
        "title": "Content Schema Version",
        "type": "integer"
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
      "generation_error_code": {
        "anyOf": [
          {
            "maxLength": 64,
            "pattern": "^[A-Z][A-Z0-9_]+$",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Generation Error Code"
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
          "oneOf": [
            {
              "$ref": "#/components/schemas/RevisionPatch"
            },
            {
              "$ref": "#/components/schemas/RevisionNodePatch"
            }
          ]
        },
        "title": "Patches",
        "type": "array"
      },
      "policy_version": {
        "title": "Policy Version",
        "type": "string"
      },
      "producer": {
        "enum": [
          "deterministic_preview",
          "model_run"
        ],
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
      "run_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Run Id"
      },
      "selection": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/RevisionSelection"
          },
          {
            "$ref": "#/components/schemas/RevisionNodeSelection"
          }
        ],
        "title": "Selection"
      },
      "status": {
        "enum": [
          "generating",
          "ready",
          "invalid",
          "cancelled",
          "applied",
          "undone",
          "failed"
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
          "undone",
          "failed"
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
  "ScheduleChange": {
    "additionalProperties": false,
    "properties": {
      "due_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Due Date"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "start_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start Date"
      },
      "task_id": {
        "format": "uuid",
        "title": "Task Id",
        "type": "string"
      }
    },
    "required": [
      "task_id",
      "expected_version",
      "start_date",
      "due_date"
    ],
    "title": "ScheduleChange",
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
  "SourceRange": {
    "additionalProperties": false,
    "properties": {
      "from": {
        "maximum": 20000,
        "minimum": 0,
        "title": "From",
        "type": "integer"
      },
      "text": {
        "maxLength": 10000,
        "minLength": 1,
        "title": "Text",
        "type": "string"
      },
      "to": {
        "maximum": 20000,
        "minimum": 1,
        "title": "To",
        "type": "integer"
      }
    },
    "required": [
      "from",
      "to",
      "text"
    ],
    "title": "SourceRange",
    "type": "object"
  },
  "StageCommandRead": {
    "additionalProperties": false,
    "properties": {
      "confirmation": {
        "$ref": "#/components/schemas/StageConfirmationRead"
      },
      "project": {
        "$ref": "#/components/schemas/ProjectRead"
      }
    },
    "required": [
      "confirmation",
      "project"
    ],
    "title": "StageCommandRead",
    "type": "object"
  },
  "StageConfirm": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "document_version": {
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
        "title": "Document Version"
      },
      "evidence": {
        "items": {
          "$ref": "#/components/schemas/EvidenceTaskRef"
        },
        "maxItems": 50,
        "title": "Evidence",
        "type": "array"
      },
      "expected_project_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Project Version",
        "type": "integer"
      },
      "flow_version_id": {
        "format": "uuid",
        "title": "Flow Version Id",
        "type": "string"
      },
      "next_stage_id": {
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
        "title": "Next Stage Id"
      },
      "note": {
        "maxLength": 2000,
        "minLength": 1,
        "title": "Note",
        "type": "string"
      },
      "stage_id": {
        "maxLength": 80,
        "minLength": 1,
        "pattern": "^[A-Za-z0-9_-]+$",
        "title": "Stage Id",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_project_version",
      "flow_version_id",
      "stage_id",
      "note"
    ],
    "title": "StageConfirm",
    "type": "object"
  },
  "StageConfirmationPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/StageConfirmationRead"
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
    "title": "StageConfirmationPage",
    "type": "object"
  },
  "StageConfirmationRead": {
    "additionalProperties": false,
    "properties": {
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "document_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Document Id"
      },
      "document_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Document Version"
      },
      "evidence": {
        "items": {
          "$ref": "#/components/schemas/EvidenceTaskSnapshot"
        },
        "title": "Evidence",
        "type": "array"
      },
      "flow_version_id": {
        "format": "uuid",
        "title": "Flow Version Id",
        "type": "string"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "kind": {
        "enum": [
          "confirm",
          "revoke"
        ],
        "title": "Kind",
        "type": "string"
      },
      "next_stage_id": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Next Stage Id"
      },
      "note": {
        "title": "Note",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "project_version_after": {
        "title": "Project Version After",
        "type": "integer"
      },
      "resulting_stage_id": {
        "title": "Resulting Stage Id",
        "type": "string"
      },
      "resulting_stage_name": {
        "title": "Resulting Stage Name",
        "type": "string"
      },
      "revoked_by_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Revoked By Id"
      },
      "revokes_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Revokes Id"
      },
      "sequence": {
        "title": "Sequence",
        "type": "integer"
      },
      "stage_id": {
        "title": "Stage Id",
        "type": "string"
      },
      "stage_name": {
        "title": "Stage Name",
        "type": "string"
      }
    },
    "required": [
      "id",
      "project_id",
      "sequence",
      "kind",
      "flow_version_id",
      "stage_id",
      "stage_name",
      "next_stage_id",
      "resulting_stage_id",
      "resulting_stage_name",
      "revokes_id",
      "revoked_by_id",
      "document_id",
      "document_version",
      "evidence",
      "note",
      "project_version_after",
      "created_at"
    ],
    "title": "StageConfirmationRead",
    "type": "object"
  },
  "StageOption": {
    "additionalProperties": false,
    "properties": {
      "id": {
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      }
    },
    "required": [
      "id",
      "name"
    ],
    "title": "StageOption",
    "type": "object"
  },
  "StagePrerequisite": {
    "additionalProperties": false,
    "properties": {
      "confirmed": {
        "title": "Confirmed",
        "type": "boolean"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "stage_id": {
        "title": "Stage Id",
        "type": "string"
      }
    },
    "required": [
      "stage_id",
      "name",
      "confirmed"
    ],
    "title": "StagePrerequisite",
    "type": "object"
  },
  "StageProgressRead": {
    "additionalProperties": false,
    "properties": {
      "binding": {
        "enum": [
          "unbound",
          "ready",
          "invalid"
        ],
        "title": "Binding",
        "type": "string"
      },
      "current": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/CurrentStageRead"
          },
          {
            "type": "null"
          }
        ]
      },
      "document": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DocumentPointer"
          },
          {
            "type": "null"
          }
        ]
      },
      "evidence_candidates": {
        "items": {
          "$ref": "#/components/schemas/EvidenceCandidate"
        },
        "title": "Evidence Candidates",
        "type": "array"
      },
      "flow_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Id"
      },
      "flow_name": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Name"
      },
      "flow_version": {
        "anyOf": [
          {
            "type": "integer"
          },
          {
            "type": "null"
          }
        ],
        "title": "Flow Version"
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
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "project_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Project Version",
        "type": "integer"
      },
      "revocable_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Revocable Id"
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
      "stages": {
        "items": {
          "$ref": "#/components/schemas/StageRouteItem"
        },
        "title": "Stages",
        "type": "array"
      }
    },
    "required": [
      "project_id",
      "project_version",
      "binding",
      "flow_id",
      "flow_version_id",
      "flow_version",
      "flow_name",
      "stage_id",
      "stages",
      "current",
      "document",
      "evidence_candidates",
      "revocable_id"
    ],
    "title": "StageProgressRead",
    "type": "object"
  },
  "StageRevoke": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_project_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Project Version",
        "type": "integer"
      },
      "note": {
        "default": "",
        "maxLength": 2000,
        "title": "Note",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_project_version"
    ],
    "title": "StageRevoke",
    "type": "object"
  },
  "StageRouteItem": {
    "additionalProperties": false,
    "properties": {
      "confirmation_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Confirmation Id"
      },
      "deadline": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Deadline"
      },
      "id": {
        "title": "Id",
        "type": "string"
      },
      "name": {
        "title": "Name",
        "type": "string"
      },
      "start": {
        "anyOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start"
      },
      "state": {
        "enum": [
          "confirmed",
          "current",
          "upcoming"
        ],
        "title": "State",
        "type": "string"
      }
    },
    "required": [
      "id",
      "name",
      "state",
      "start",
      "deadline",
      "confirmation_id"
    ],
    "title": "StageRouteItem",
    "type": "object"
  },
  "SuggestionDecision": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "adopt",
          "reject",
          "undo"
        ],
        "title": "Action",
        "type": "string"
      },
      "content": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/FeedbackContent"
          },
          {
            "type": "null"
          }
        ]
      },
      "expected_version": {
        "maximum": 10000,
        "minimum": 0,
        "title": "Expected Version",
        "type": "integer"
      },
      "reason": {
        "default": "",
        "maxLength": 2000,
        "title": "Reason",
        "type": "string"
      },
      "suggestion_id": {
        "format": "uuid",
        "title": "Suggestion Id",
        "type": "string"
      }
    },
    "required": [
      "suggestion_id",
      "expected_version",
      "action"
    ],
    "title": "SuggestionDecision",
    "type": "object"
  },
  "SuggestionHistoryRead": {
    "properties": {
      "action": {
        "enum": [
          "adopt",
          "adopt_modified",
          "reject",
          "undo"
        ],
        "title": "Action",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "feedback_item_id": {
        "anyOf": [
          {
            "format": "uuid",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Feedback Item Id"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "version": {
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "version",
      "action",
      "feedback_item_id",
      "reason",
      "created_at"
    ],
    "title": "SuggestionHistoryRead",
    "type": "object"
  },
  "TaskContent": {
    "additionalProperties": false,
    "properties": {
      "acceptance": {
        "maxLength": 4000,
        "minLength": 1,
        "title": "Acceptance",
        "type": "string"
      },
      "archived": {
        "default": false,
        "title": "Archived",
        "type": "boolean"
      },
      "chapter": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/ChapterRef"
          },
          {
            "type": "null"
          }
        ]
      },
      "depends_on": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "maxItems": 100,
        "title": "Depends On",
        "type": "array"
      },
      "description": {
        "default": "",
        "maxLength": 4000,
        "title": "Description",
        "type": "string"
      },
      "due_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Due Date"
      },
      "evidence": {
        "items": {
          "discriminator": {
            "mapping": {
              "document": "#/components/schemas/DocumentEvidence",
              "material": "#/components/schemas/MaterialEvidence"
            },
            "propertyName": "kind"
          },
          "oneOf": [
            {
              "$ref": "#/components/schemas/DocumentEvidence"
            },
            {
              "$ref": "#/components/schemas/MaterialEvidence"
            }
          ]
        },
        "maxItems": 20,
        "title": "Evidence",
        "type": "array"
      },
      "hard_deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Hard Deadline"
      },
      "start_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start Date"
      },
      "status": {
        "default": "todo",
        "enum": [
          "todo",
          "doing",
          "verify"
        ],
        "title": "Status",
        "type": "string"
      },
      "title": {
        "maxLength": 200,
        "minLength": 1,
        "title": "Title",
        "type": "string"
      }
    },
    "required": [
      "title",
      "acceptance"
    ],
    "title": "TaskContent",
    "type": "object"
  },
  "TaskCreate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "content": {
        "$ref": "#/components/schemas/TaskContent"
      },
      "expected_board_version": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Expected Board Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_board_version",
      "content"
    ],
    "title": "TaskCreate",
    "type": "object"
  },
  "TaskDecision": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "enum": [
          "confirm",
          "rework",
          "reopen"
        ],
        "title": "Action",
        "type": "string"
      },
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      },
      "reason": {
        "default": "",
        "maxLength": 2000,
        "title": "Reason",
        "type": "string"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "action"
    ],
    "title": "TaskDecision",
    "type": "object"
  },
  "TaskPage": {
    "additionalProperties": false,
    "properties": {
      "board_version": {
        "title": "Board Version",
        "type": "integer"
      },
      "items": {
        "items": {
          "$ref": "#/components/schemas/TaskSummary"
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
      "offset",
      "board_version"
    ],
    "title": "TaskPage",
    "type": "object"
  },
  "TaskRead": {
    "additionalProperties": false,
    "properties": {
      "content": {
        "$ref": "#/components/schemas/TaskContent"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "evidence_snapshots": {
        "items": {
          "$ref": "#/components/schemas/EvidenceSnapshot"
        },
        "title": "Evidence Snapshots",
        "type": "array"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "needs_review": {
        "title": "Needs Review",
        "type": "boolean"
      },
      "origin": {
        "const": "manual",
        "default": "manual",
        "title": "Origin",
        "type": "string"
      },
      "position": {
        "title": "Position",
        "type": "integer"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "review_reasons": {
        "items": {
          "type": "string"
        },
        "title": "Review Reasons",
        "type": "array"
      },
      "status": {
        "enum": [
          "todo",
          "doing",
          "verify",
          "confirmed",
          "rework"
        ],
        "title": "Status",
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
      "position",
      "status",
      "content",
      "evidence_snapshots",
      "needs_review",
      "review_reasons",
      "created_at",
      "updated_at"
    ],
    "title": "TaskRead",
    "type": "object"
  },
  "TaskReorder": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "expected_board_version": {
        "maximum": 9007199254740991,
        "minimum": 0,
        "title": "Expected Board Version",
        "type": "integer"
      },
      "task_ids": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "maxItems": 500,
        "title": "Task Ids",
        "type": "array"
      }
    },
    "required": [
      "command_id",
      "expected_board_version",
      "task_ids"
    ],
    "title": "TaskReorder",
    "type": "object"
  },
  "TaskSummary": {
    "additionalProperties": false,
    "properties": {
      "archived": {
        "title": "Archived",
        "type": "boolean"
      },
      "depends_on": {
        "items": {
          "format": "uuid",
          "type": "string"
        },
        "title": "Depends On",
        "type": "array"
      },
      "due_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Due Date"
      },
      "hard_deadline": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Hard Deadline"
      },
      "id": {
        "format": "uuid",
        "title": "Id",
        "type": "string"
      },
      "needs_review": {
        "title": "Needs Review",
        "type": "boolean"
      },
      "position": {
        "title": "Position",
        "type": "integer"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "review_reasons": {
        "items": {
          "type": "string"
        },
        "title": "Review Reasons",
        "type": "array"
      },
      "start_date": {
        "anyOf": [
          {
            "format": "date",
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "title": "Start Date"
      },
      "status": {
        "enum": [
          "todo",
          "doing",
          "verify",
          "confirmed",
          "rework"
        ],
        "title": "Status",
        "type": "string"
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
      "position",
      "title",
      "status",
      "archived",
      "due_date",
      "needs_review",
      "review_reasons",
      "updated_at"
    ],
    "title": "TaskSummary",
    "type": "object"
  },
  "TaskUpdate": {
    "additionalProperties": false,
    "properties": {
      "command_id": {
        "format": "uuid",
        "title": "Command Id",
        "type": "string"
      },
      "content": {
        "$ref": "#/components/schemas/TaskContent"
      },
      "expected_version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
      }
    },
    "required": [
      "command_id",
      "expected_version",
      "content"
    ],
    "title": "TaskUpdate",
    "type": "object"
  },
  "TaskVersionPage": {
    "additionalProperties": false,
    "properties": {
      "items": {
        "items": {
          "$ref": "#/components/schemas/TaskVersionRead"
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
    "title": "TaskVersionPage",
    "type": "object"
  },
  "TaskVersionRead": {
    "additionalProperties": false,
    "properties": {
      "action": {
        "title": "Action",
        "type": "string"
      },
      "created_at": {
        "format": "date-time",
        "title": "Created At",
        "type": "string"
      },
      "reason": {
        "title": "Reason",
        "type": "string"
      },
      "snapshot": {
        "$ref": "#/components/schemas/TaskRead"
      },
      "version": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "title": "Version",
        "type": "integer"
      }
    },
    "required": [
      "version",
      "action",
      "reason",
      "snapshot",
      "created_at"
    ],
    "title": "TaskVersionRead",
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
  },
  "UnreadCount": {
    "additionalProperties": false,
    "properties": {
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "unread_count": {
        "title": "Unread Count",
        "type": "integer"
      }
    },
    "required": [
      "project_id",
      "unread_count"
    ],
    "title": "UnreadCount",
    "type": "object"
  }
} as const;

export type SchemaName = keyof ApiTypes;
