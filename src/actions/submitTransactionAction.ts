import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { createWalletClient, http, type Hash } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const submitTransactionAction: Action = {
  name: "SUBMIT_TRANSACTION",
  similes: ["SEND_TRANSACTION", "EXECUTE_TRANSACTION", "BROADCAST_TRANSACTION"],
  description: "Submits a transaction to the blockchain using the provided calldata and contract address",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    // Check if private key is available in environment
    const privateKey = process.env.PRIVATE_KEY || runtime.getSetting("PRIVATE_KEY");
    if (!privateKey) {
      logger.error("No private key found in environment variables or settings");
      return false;
    }

    // Validate the message contains transaction data or request to submit
    const content = message.content?.text;
    if (!content) return false;

    // Check for explicit transaction submission keywords
    const submitKeywords = [
      "submit transaction",
      "send transaction", 
      "execute transaction",
      "broadcast transaction",
      "submit this transaction",
      "send this tx"
    ];
    
    const hasSubmitKeyword = submitKeywords.some(keyword => 
      content.toLowerCase().includes(keyword)
    );

    if (hasSubmitKeyword) return true;

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
      // Get private key from environment or settings
      const privateKey = process.env.PRIVATE_KEY || runtime.getSetting("PRIVATE_KEY");
      if (!privateKey) {
        throw new Error("No private key found in environment variables or settings");
      }

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

      // Create account from private key
      const account = privateKeyToAccount(privateKey as `0x${string}`);

      // Create wallet client
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http(process.env.RPC_URL || "https://mainnet.base.org"),
      });

      logger.info(`Submitting transaction to ${transactionData.to}`);

      // Submit transaction (viem handles gas estimation automatically)
      const hash = await walletClient.sendTransaction({
        to: transactionData.to as `0x${string}`,
        data: transactionData.data as `0x${string}`,
        value: transactionData.value ? BigInt(transactionData.value) : 0n,
      });

      logger.info(`Transaction submitted with hash: ${hash}`);

      // Send response via callback
      if (callback) {
        callback({
          text: `Transaction submitted successfully!\n\nTransaction Hash: ${hash}\n\nYou can view the transaction on the block explorer: https://basescan.org/tx/${hash}`,
        });
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to submit transaction:", errorMessage);

      if (callback) {
        callback({
          text: `Failed to submit transaction: ${errorMessage}`,
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
          text: '{"to": "0x1234567890123456789012345678901234567890", "data": "0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000"}',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll submit this transaction to the blockchain for you.",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "Transaction submitted successfully!\n\nTransaction Hash: 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890\n\nYou can view the transaction on the block explorer: https://basescan.org/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
    ],
  ],
}; 