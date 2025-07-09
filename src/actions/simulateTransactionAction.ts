import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const simulateTransactionAction: Action = {
  name: "SIMULATE_TRANSACTION",
  similes: ["TEST_TRANSACTION", "DRY_RUN_TRANSACTION", "PREVIEW_TRANSACTION"],
  description: "Simulates a transaction without submitting it to get gas estimates and check for errors",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    // Validate the message contains transaction data or request to simulate
    const content = message.content?.text;
    if (!content) return false;

    // Check for explicit transaction simulation keywords
    const simulateKeywords = [
      "simulate transaction",
      "test transaction", 
      "dry run transaction",
      "preview transaction",
      "simulate this transaction",
      "test this tx",
      "check transaction",
      "estimate gas"
    ];
    
    const hasSimulateKeyword = simulateKeywords.some(keyword => 
      content.toLowerCase().includes(keyword)
    );

    if (hasSimulateKeyword) return true;

    // Try to parse as JSON transaction data
    try {
      const data = JSON.parse(content);
      return !!(data.to && data.data);
    } catch {
      // Check if it contains transaction-like data patterns
      return content.includes('"to":') && content.includes('"data":');
    }
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      // Parse transaction data from message
      const content = message.content?.text;
      if (!content) {
        throw new Error("No transaction data found in message");
      }

      let transactionData;
      
      // Try to extract JSON from the content (handles cases where transaction data is embedded in text)
      const jsonMatch = content.match(/\{[^{}]*"to"[^{}]*"data"[^{}]*\}/);
      if (jsonMatch) {
        try {
          transactionData = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error("Found transaction-like data but couldn't parse as JSON");
        }
      } else {
        // Try parsing the entire content as JSON
        try {
          transactionData = JSON.parse(content);
        } catch {
          throw new Error("No valid transaction data found in message");
        }
      }

      if (!transactionData.to || !transactionData.data) {
        throw new Error("Transaction data must include 'to' address and 'data' field");
      }

      // Create public client for simulation
      const publicClient = createPublicClient({
        chain: base,
        transport: http(process.env.RPC_URL || "https://mainnet.base.org"),
      });

      logger.info(`Simulating transaction to ${transactionData.to}`);

      // Get the caller address for simulation
      let accountAddress: string;
      
      // Try to get address from private key for more accurate simulation
      const privateKey = process.env.PRIVATE_KEY || runtime.getSetting("PRIVATE_KEY");
      if (privateKey) {
        try {
          const account = privateKeyToAccount(privateKey as `0x${string}`);
          accountAddress = account.address;
          logger.info(`Using actual caller address for simulation: ${accountAddress}`);
        } catch (error) {
          logger.warn("Failed to derive address from private key, using fallback");
          accountAddress = transactionData.from || "0x0000000000000000000000000000000000000001";
        }
      } else {
        // Fall back to provided from address or default
        accountAddress = transactionData.from || "0x0000000000000000000000000000000000000001";
        logger.info(`Using fallback address for simulation: ${accountAddress}`);
      }

      // Simulate the transaction
      const simulationResult = await publicClient.call({
        to: transactionData.to as `0x${string}`,
        data: transactionData.data as `0x${string}`,
        value: transactionData.value ? BigInt(transactionData.value) : 0n,
        account: accountAddress as `0x${string}`,
      });

      // Estimate gas
      const gasEstimate = await publicClient.estimateGas({
        to: transactionData.to as `0x${string}`,
        data: transactionData.data as `0x${string}`,
        value: transactionData.value ? BigInt(transactionData.value) : 0n,
        account: accountAddress as `0x${string}`,
      });

      logger.info(`Simulation successful. Gas estimate: ${gasEstimate.toString()}`);

      // Format the response
      const response = {
        success: true,
        gasEstimate: gasEstimate.toString(),
        returnData: simulationResult.data || "0x",
        to: transactionData.to,
        value: transactionData.value || "0",
      };

      // Send response via callback
      if (callback) {
        callback({
          text: `Transaction simulation successful! ✅\n\n**Gas Estimate:** ${gasEstimate.toString()} gas\n**Return Data:** ${simulationResult.data || "0x"}\n**To:** ${transactionData.to}\n**From:** ${accountAddress}\n**Value:** ${transactionData.value || "0"} wei\n\nThe transaction should execute successfully when submitted.`,
        });
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Transaction simulation failed:", errorMessage);

      if (callback) {
        callback({
          text: `Transaction simulation failed ❌\n\n**Error:** ${errorMessage}\n\nThis transaction would likely fail if submitted. Please check the transaction data and try again.`,
        });
      }

      return false;
    }
  },

  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: 'Simulate this transaction: {"to": "0x1234567890123456789012345678901234567890", "data": "0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000"}',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll simulate this transaction to check if it would succeed and estimate gas costs.",
          actions: ["SIMULATE_TRANSACTION"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "Transaction simulation successful! ✅\n\n**Gas Estimate:** 65000 gas\n**Return Data:** 0x\n**To:** 0x1234567890123456789012345678901234567890\n**Value:** 0 wei\n\nThe transaction should execute successfully when submitted.",
          actions: ["SIMULATE_TRANSACTION"],
        },
      },
    ],
  ],
}; 