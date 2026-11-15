// Generated from apps/api/openapi.json. Do not edit manually.
// Contract SHA-256: a8a08919ac9d008b29016524cbc243480b70955dfe09487c50436f5c156f899c
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
  "source": "local_import" | "manual_edit";
  "version": number;
};

export type DocumentVersionSummary = {
  "created_at": string;
  "document_id": string;
  "project_id": string;
  "source": "local_import" | "manual_edit";
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
          "manual_edit"
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
          "manual_edit"
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
  }
} as const;

export type SchemaName = keyof ApiTypes;
