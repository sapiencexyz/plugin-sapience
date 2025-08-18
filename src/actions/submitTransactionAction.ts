import {
  type Action,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from "@elizaos/core";
import { createWalletClient, http, type Hash } from "viem";
import { base, arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const submitTransactionAction: Action = {
  name: "SUBMIT_TRANSACTION",
  similes: ["SEND_TRANSACTION", "EXECUTE_TRANSACTION", "BROADCAST_TRANSACTION"],
  description: "Submits a transaction to the blockchain using the provided calldata and contract address. Supports JSON transaction objects with 'to' and 'data' fields, or raw call data with a target address. Uses fuzzy search to intelligently identify call data and target addresses from natural language messages.",

  validate: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<boolean> => {
    // Check if private key is available in environment
    let privateKey = runtime.getSetting("PRIVATE_KEY") || 
                    runtime.getSetting("WALLET_PRIVATE_KEY") || 
                    runtime.getSetting("EVM_PRIVATE_KEY") ||
                    process.env.PRIVATE_KEY ||
                    process.env.WALLET_PRIVATE_KEY ||
                    process.env.EVM_PRIVATE_KEY;
    
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
      "send this tx",
      "execute this transaction",
      "broadcast this tx"
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
                                      content.toLowerCase().includes('submit') ||
                                      content.toLowerCase().includes('send');
        
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
      // Get private key from environment or settings
      let privateKey = runtime.getSetting("PRIVATE_KEY") || 
                      runtime.getSetting("WALLET_PRIVATE_KEY") || 
                      runtime.getSetting("EVM_PRIVATE_KEY") ||
                      process.env.PRIVATE_KEY ||
                      process.env.WALLET_PRIVATE_KEY ||
                      process.env.EVM_PRIVATE_KEY;
      
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

      // Ensure private key has 0x prefix and validate format
      const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      
      // Validate private key format (should be 66 characters: 0x + 64 hex chars)
      if (formattedPrivateKey.length !== 66) {
        throw new Error(`Invalid private key format. Expected 66 characters (0x + 64 hex), got ${formattedPrivateKey.length} characters. Current value appears to be: ${formattedPrivateKey.length === 42 ? 'an address' : 'invalid format'}`);
      }
      
      // Validate that it's a valid hex string
      if (!/^0x[a-fA-F0-9]{64}$/.test(formattedPrivateKey)) {
        throw new Error("Invalid private key format. Must be a valid hex string with 64 characters after 0x prefix");
      }

      // Create account from private key
      const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

      // Determine which chain to use (default to base)
      const chainName = runtime.getSetting("CHAIN") || process.env.CHAIN || "base";
      const chain = chainName.toLowerCase() === "arbitrum" ? arbitrum : base;
      
      // Get RPC URL based on chain
      let rpcUrl = runtime.getSetting("RPC_URL") || process.env.RPC_URL;
      if (!rpcUrl) {
        rpcUrl = chain === arbitrum 
          ? "https://arb1.arbitrum.io/rpc" 
          : "https://mainnet.base.org";
      }

      // Create wallet client
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      });

      logger.info(`Submitting transaction on ${chain.name} to ${transactionData.to} from ${account.address}`);

      // Submit transaction (viem handles gas estimation automatically)
      const hash = await walletClient.sendTransaction({
        to: transactionData.to as `0x${string}`,
        data: transactionData.data as `0x${string}`,
        value: transactionData.value ? BigInt(transactionData.value) : 0n,
      });

      logger.info(`Transaction submitted on ${chain.name} with hash: ${hash}`);

      // Send response via callback
      if (callback) {
        const explorerUrl = chain === arbitrum 
          ? `https://arbiscan.io/tx/${hash}`
          : `https://basescan.org/tx/${hash}`;
        
        callback({
          text: `Transaction submitted successfully! ✅\n\n**Chain:** ${chain.name}\n**Transaction Hash:** ${hash}\n**To:** ${transactionData.to}\n**From:** ${account.address}\n**Value:** ${transactionData.value || "0"} wei\n\nYou can view the transaction on the block explorer: ${explorerUrl}`,
        });
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to submit transaction:", errorMessage);

      if (callback) {
        callback({
          text: `Transaction submission failed ❌\n\n**Error:** ${errorMessage}\n\nPlease check the transaction data and try again.`,
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
          text: 'Submit this transaction: {"to": "0x1234567890123456789012345678901234567890", "data": "0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000"}',
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
          text: "Transaction submitted successfully! ✅\n\n**Transaction Hash:** 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890\n**To:** 0x1234567890123456789012345678901234567890\n**From:** 0x9876543210987654321098765432109876543210\n**Value:** 0 wei\n\nYou can view the transaction on the block explorer: https://basescan.org/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: 'Submit this transaction call data to 0x1234567890123456789012345678901234567890: 0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll submit this raw call data transaction to the blockchain for you.",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "Transaction submitted successfully! ✅\n\n**Transaction Hash:** 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890\n**To:** 0x1234567890123456789012345678901234567890\n**From:** 0x9876543210987654321098765432109876543210\n**Value:** 0 wei\n\nYou can view the transaction on the block explorer: https://basescan.org/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: 'Please execute this transaction call data 0xa9059cbb000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcdef0000000000000000000000000000000000000000000000000de0b6b3a7640000 to 0x1234567890123456789012345678901234567890',
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "I'll use fuzzy search to identify the call data and target address, then submit the transaction.",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
      {
        name: "{{assistant}}",
        content: {
          text: "Transaction submitted successfully! ✅\n\n**Transaction Hash:** 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890\n**To:** 0x1234567890123456789012345678901234567890\n**From:** 0x9876543210987654321098765432109876543210\n**Value:** 0 wei\n\nYou can view the transaction on the block explorer: https://basescan.org/tx/0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          actions: ["SUBMIT_TRANSACTION"],
        },
      },
    ],
  ],
}; 