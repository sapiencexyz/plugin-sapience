import type { HandlerCallback } from "@elizaos/core";

export function handleNoToolAvailable(
  callback?: HandlerCallback,
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  toolSelection?: Record<string, any> | null
): boolean {
  if (callback && toolSelection?.noToolAvailable) {
    callback({
      text: "I don't have a specific tool that can help with that request. Let me try to assist you directly instead.",
      thought:
        "No appropriate MCP tool available for this request. Falling back to direct assistance.",
      actions: ["REPLY"],
    });
  }

  return true;
}
