import { type IAgentRuntime, type Plugin, logger } from '@elizaos/core';
import { callToolAction } from './actions/callToolAction';
import { readResourceAction } from './actions/readResourceAction';
import { simulateTransactionAction } from './actions/simulateTransactionAction';
import { submitTransactionAction } from './actions/submitTransactionAction';
import { provider } from './provider';
import { SapienceService } from './service';

const sapiencePlugin: Plugin = {
  name: 'sapience',
  description: 'Plugin for connecting to the Sapience API',

  init: async (_config: Record<string, string>, _runtime: IAgentRuntime) => {
    logger.info('Initializing Sapience plugin...');
  },

  services: [SapienceService],
  actions: [
    callToolAction,
    readResourceAction,
    simulateTransactionAction,
    submitTransactionAction,
  ],
  providers: [provider],
  dependencies: ['@elizaos/plugin-bootstrap'],
  priority: 100,
};

export type { SapienceService };

export default sapiencePlugin;
