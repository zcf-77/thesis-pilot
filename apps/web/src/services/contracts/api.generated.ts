// Generated from apps/api/openapi.json. Do not edit manually.
// Contract SHA-256: 89567de2cda77e04c03e414427d9a99abe2cf1aebee15fb641639989aa2dd9c0
/* oxlint-disable */
// oxfmt-ignore-file

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
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert";
  "version": number;
};

export type DocumentVersionSummary = {
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit" | "ai_adoption" | "adoption_undo" | "version_revert";
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

export type HealthResponse = {
  "status": string;
};

export type JobCreate = {
  "kind"?: "diagnostic";
  "project_id": string;
};

export type JobPage = {
  "items": Array<JobRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type JobRead = {
  "attempt": number;
  "created_at": string;
  "error_code": (string) | (null);
  "id": string;
  "kind": "diagnostic";
  "project_id": string;
  "result": (DiagnosticResult) | (null);
  "status": "queued" | "running" | "succeeded" | "failed" | "cancelled";
  "updated_at": string;
};

export type ProjectCreate = {
  "name": string;
};

export type ProjectPage = {
  "items": Array<ProjectRead>;
  "limit": number;
  "offset": number;
  "total": number;
};

export type ProjectRead = {
  "created_at": string;
  "id": string;
  "name": string;
  "updated_at": string;
  "version": number;
};

export type ProjectUpdate = {
  "expected_version": number;
  "name": string;
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

export interface ApiTypes {
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
  "HealthResponse": HealthResponse;
  "JobCreate": JobCreate;
  "JobPage": JobPage;
  "JobRead": JobRead;
  "ProjectCreate": ProjectCreate;
  "ProjectPage": ProjectPage;
  "ProjectRead": ProjectRead;
  "ProjectUpdate": ProjectUpdate;
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
}

export const apiSchemas = {
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
          "version_revert"
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
          "version_revert"
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
  "JobCreate": {
    "additionalProperties": false,
    "properties": {
      "kind": {
        "const": "diagnostic",
        "default": "diagnostic",
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
      "kind": {
        "const": "diagnostic",
        "title": "Kind",
        "type": "string"
      },
      "project_id": {
        "format": "uuid",
        "title": "Project Id",
        "type": "string"
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/components/schemas/DiagnosticResult"
          },
          {
            "type": "null"
          }
        ]
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
  "ProjectCreate": {
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
      "created_at",
      "updated_at"
    ],
    "title": "ProjectRead",
    "type": "object"
  },
  "ProjectUpdate": {
    "additionalProperties": false,
    "properties": {
      "expected_version": {
        "minimum": 1,
        "title": "Expected Version",
        "type": "integer"
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
      "expected_version"
    ],
    "title": "ProjectUpdate",
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
  }
} as const;

export type SchemaName = keyof ApiTypes;
