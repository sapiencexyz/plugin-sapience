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
  description: "Simulates a transaction without submitting it to get gas estimates and check for errors. Supports JSON transaction objects with 'to' and 'data' fields, or raw call data with a target address. Uses fuzzy search to intelligently identify call data and target addresses from natural language messages.",

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
      if (content.includes('"to":') && content.includes('"data":')) {
        return true;
      }
      
      // Fuzzy search for potential transaction data
      const hexPattern = /0x[a-fA-F0-9]+/g;
      const hexMatches = content.match(hexPattern) || [];
      
      if (hexMatches.length > 0) {
        // Look for patterns that suggest this is transaction data
        const hasLongHex = hexMatches.some(hex => hex.length > 10);
        const hasAddress = hexMatches.some(hex => hex.length === 42);
        const hasTransactionKeywords = content.toLowerCase().includes('transaction') || 
                                      content.toLowerCase().includes('call data') ||
                                      content.toLowerCase().includes('to ') ||
                                      content.toLowerCase().includes('simulate');
        
        // If we have hex data and transaction context, likely valid
        if (hasLongHex && (hasAddress || hasTransactionKeywords)) {
          return true;
        }
      }
      
      return false;
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
          // Fuzzy search for transaction data in the message
          const hexPattern = /0x[a-fA-F0-9]+/g;
          const hexMatches = content.match(hexPattern) || [];
          
          if (hexMatches.length > 0) {
            let callData: string | null = null;
            let targetAddress: string | null = null;
            
            // Sort hex strings by length (longest first)
            const sortedHexes = hexMatches.sort((a, b) => b.length - a.length);
            
            // Look for call data (should be the longest hex string, typically > 10 chars)
            for (const hex of sortedHexes) {
              if (hex.length > 10 && !callData) {
                callData = hex;
                break;
              }
            }
            
            // Look for target address (exactly 42 characters: 0x + 40 hex chars)
            for (const hex of hexMatches) {
              if (hex.length === 42 && hex !== callData) {
                targetAddress = hex;
                break;
              }
            }
            
            // If we found both, create transaction data
            if (callData && targetAddress) {
              transactionData = {
                to: targetAddress,
                data: callData
              };
            } else if (callData && !targetAddress) {
              // Look for address patterns in a more flexible way
              const addressHints = [
                "to ",
                "address ",
                "contract ",
                "target "
              ];
              
              // Try to find an address near these keywords
              for (const hint of addressHints) {
                const hintIndex = content.toLowerCase().indexOf(hint);
                if (hintIndex !== -1) {
                  const afterHint = content.substring(hintIndex + hint.length);
                  const addressMatch = afterHint.match(/0x[a-fA-F0-9]{40}/);
                  if (addressMatch) {
                    targetAddress = addressMatch[0];
                    break;
                  }
                }
              }
              
              if (targetAddress) {
                transactionData = {
                  to: targetAddress,
                  data: callData
                };
              } else {
                throw new Error(`Found call data (${callData.substring(0, 10)}...) but no target address. Please include the target address in your message.`);
              }
            } else {
              throw new Error("Could not identify valid call data in the message");
            }
          } else {
            throw new Error("No valid transaction data found in message");
          }
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
      // According to ElizaOS docs, runtime.getSetting() is the preferred method
      let privateKey = runtime.getSetting("PRIVATE_KEY") || 
                      runtime.getSetting("WALLET_PRIVATE_KEY") || 
                      runtime.getSetting("EVM_PRIVATE_KEY") ||
                      process.env.PRIVATE_KEY ||
                      process.env.WALLET_PRIVATE_KEY ||
                      process.env.EVM_PRIVATE_KEY;
      
      logger.info(`Private key availability: ${privateKey ? 'Found' : 'Not found'}`);
      
      if (privateKey) {
        try {
          // Ensure private key has 0x prefix
          const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
          
          // Validate private key format (should be 66 characters: 0x + 64 hex chars)
          if (formattedPrivateKey.length !== 66) {
            throw new Error(`Invalid private key format. Expected 66 characters (0x + 64 hex), got ${formattedPrivateKey.length} characters. Current value appears to be: ${formattedPrivateKey.length === 42 ? 'an address' : 'invalid format'}`);
          }
          
          // Validate that it's a valid hex string
          if (!/^0x[a-fA-F0-9]{64}$/.test(formattedPrivateKey)) {
            throw new Error("Invalid private key format. Must be a valid hex string with 64 characters after 0x prefix");
          }
          
          logger.info(`Attempting to derive address from private key (length: ${formattedPrivateKey.length})`);
          
          const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);
          accountAddress = account.address;
          logger.info(`✅ Using actual caller address for simulation: ${accountAddress}`);
        } catch (error) {
          logger.error("❌ Failed to derive address from private key:", error);
          logger.warn("💡 Hint: Make sure PRIVATE_KEY is set to a valid 64-character hex private key, not an address");
          accountAddress = transactionData.from || "0x0000000000000000000000000000000000000001";
          logger.warn(`Using fallback address for simulation: ${accountAddress}`);
        }
      } else {
        // Fall back to provided from address or default
        accountAddress = transactionData.from || "0x0000000000000000000000000000000000000001";
        logger.warn(`⚠️  No private key found, using fallback address for simulation: ${accountAddress}`);
        logger.info("To use your actual address, set PRIVATE_KEY in your environment or runtime settings");
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
    [
      {
        name: "{{user}}",
        content: {
          text: 'Simulate this transaction call data to 0x1234567890123456789012345678901234567890: 0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll simulate this raw call data transaction to check if it would succeed and estimate gas costs.",
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
    [
      {
        name: "{{user}}",
        content: {
          text: 'Please simulate this transaction call data 0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000 to 0x1234567890123456789012345678901234567890',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll use fuzzy search to identify the call data and target address, then simulate the transaction.",
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