import type { IAgentRuntime, Memory, Provider, State } from "@elizaos/core";
import type { SapienceService } from "./service";
import { SAPIENCE_SERVICE_NAME } from "./types";

export const provider: Provider = {
  name: "Sapience",
  description: "Information about the connected Sapience server, tools, and resources",

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    const sapienceService = runtime.getService<SapienceService>(SAPIENCE_SERVICE_NAME);
    if (!sapienceService) {
      return {
        values: { sapience: {} },
        data: { sapience: {} },
        text: "The Sapience server is not available.",
      };
    }

    return sapienceService.getProviderData();
  },
};
