import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import type { SapienceService } from "../service";
import { SAPIENCE_SERVICE_NAME } from "../types";
import { handleMcpError } from "../utils/error";
import { handleToolResponse, processToolResult } from "../utils/processing";
import { createToolSelectionArgument, createToolSelectionName } from "../utils/selection";
import { handleNoToolAvailable } from "../utils/handler";

export const callToolAction: Action = {
  name: "CALL_SAPIENCE_TOOL",
  similes: ["USE_SAPIENCE_TOOL", "EXECUTE_SAPIENCE_TOOL", "RUN_SAPIENCE_TOOL", "INVOKE_SAPIENCE_TOOL"],
  description: "Calls a tool from the Sapience server to perform a specific task",

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const sapienceService = runtime.getService<SapienceService>(SAPIENCE_SERVICE_NAME);
    if (!sapienceService) return false;

    const servers = sapienceService.getServers();
    return (
      servers.length > 0 &&
      servers.some(
        (server) => server.status === "connected" && server.tools && server.tools.length > 0
      )
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<boolean> => {
    const composedState = await runtime.composeState(message, ["RECENT_MESSAGES", "SAPIENCE"]);
    const sapienceService = runtime.getService<SapienceService>(SAPIENCE_SERVICE_NAME);
    if (!sapienceService) {
      throw new Error("Sapience service not available");
    }
    const sapienceProvider = sapienceService.getProviderData();

    try {
      // Select the tool with this servername and toolname
      const toolSelectionName = await createToolSelectionName({
        runtime,
        state: composedState,
        message,
        callback,
        mcpProvider: sapienceProvider,
      });
      if (!toolSelectionName || toolSelectionName.noToolAvailable) {
        logger.warn("[NO_TOOL_AVAILABLE] No appropriate tool available for the request");
        return handleNoToolAvailable(callback, toolSelectionName);
      }
      
      const { serverName, toolName, reasoning } = toolSelectionName;
      
      // Safety check: serverName and toolName should be defined when noToolAvailable is not true
      if (!serverName || !toolName) {
        logger.error("[ACTION] serverName or toolName is missing from toolSelectionName");
        return handleNoToolAvailable(callback, toolSelectionName);
      }
      logger.info(
        `[CALLING] Calling tool "${serverName}/${toolName}" on server with reasoning: "${reasoning}"`
      );

      // Create the tool selection "argument" based on the selected tool name
      const toolSelectionArgument = await createToolSelectionArgument({
        runtime,
        state: composedState,
        message,
        callback,
        mcpProvider: sapienceProvider,
        toolSelectionName,
      });
      if (!toolSelectionArgument) {
        logger.warn(
          "[NO_TOOL_SELECTION_ARGUMENT] No appropriate tool selection argument available"
        );
        return handleNoToolAvailable(callback, toolSelectionName);
      }
      logger.info(
        `[SELECTED] Tool Selection result:\n${JSON.stringify(toolSelectionArgument, null, 2)}`
      );

      const result = await sapienceService.callTool(
        serverName,
        toolName,
        toolSelectionArgument.toolArguments
      );

      // Ensure every content item has a required type property before processing
      const safeResult = {
        ...result,
        content: (result.content || []).map((item: any) => ({
          type: item.type ?? "text",
          ...item,
        })),
      };

      const { toolOutput, hasAttachments, attachments } = processToolResult(
        safeResult,
        serverName,
        toolName,
        runtime,
        message.entityId
      );

      await handleToolResponse(
        runtime,
        message,
        serverName,
        toolName,
        toolSelectionArgument.toolArguments,
        toolOutput,
        hasAttachments,
        attachments,
        composedState,
        sapienceProvider,
        callback
      );

      return true;
    } catch (error) {
      return handleMcpError(
        composedState,
        sapienceProvider,
        error,
        runtime,
        message,
        "tool",
        callback
      );
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Can you search for information about climate change?",
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll help you with that request. Let me access the right tool...",
          actions: ["CALL_SAPIENCE_TOOL"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I found the following information about climate change:\n\nClimate change refers to long-term shifts in temperatures and weather patterns. These shifts may be natural, but since the 1800s, human activities have been the main driver of climate change, primarily due to the burning of fossil fuels like coal, oil, and gas, which produces heat-trapping gases.",
          actions: ["CALL_SAPIENCE_TOOL"],
        },
      },
    ],
  ],
};
