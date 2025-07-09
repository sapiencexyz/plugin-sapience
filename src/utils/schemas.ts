export const toolSelectionNameSchema = {
  type: "object",
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
      errorMessage: "serverName must not be empty",
    },
    toolName: {
      type: "string",
      minLength: 1,
      errorMessage: "toolName must not be empty",
    },
    reasoning: {
      type: "string",
    },
    noToolAvailable: {
      type: "boolean",
    },
  },
  anyOf: [
    {
      // Case 1: Tool is available - require serverName and toolName
      required: ["serverName", "toolName"],
      properties: {
        noToolAvailable: { const: false }
      }
    },
    {
      // Case 2: Tool is available but noToolAvailable is not specified - require serverName and toolName
      required: ["serverName", "toolName"],
      not: {
        properties: {
          noToolAvailable: { const: true }
        }
      }
    },
    {
      // Case 3: No tool available - only require noToolAvailable
      required: ["noToolAvailable"],
      properties: {
        noToolAvailable: { const: true }
      }
    }
  ]
};

export interface ToolSelectionName {
  serverName?: string;
  toolName?: string;
  reasoning?: string;
  noToolAvailable?: boolean;
}

export const toolSelectionArgumentSchema = {
  type: "object",
  required: ["toolArguments"],
  properties: {
    toolArguments: {
      type: "object",
    },
  },
};

export interface ToolSelectionArgument {
  toolArguments: Record<string, unknown>;
}

export const ResourceSelectionSchema = {
  type: "object",
  required: ["serverName", "uri"],
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
      errorMessage: "serverName must not be empty",
    },
    uri: {
      type: "string",
      minLength: 1,
      errorMessage: "uri must not be empty",
    },
    reasoning: {
      type: "string",
    },
    noResourceAvailable: {
      type: "boolean",
    },
  },
};

export interface ResourceSelection {
  serverName: string;
  uri: string;
  reasoning?: string;
  noResourceAvailable?: boolean;
}
