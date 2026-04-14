import "dotenv/config";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "azure-flux-mcp",
  version: "1.0.0",
});

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function extractImageFromResponse(responseData) {
  const imageBase64 =
    responseData?.data?.[0]?.b64_json ||
    responseData?.images?.[0] ||
    responseData?.result?.image;

  if (!imageBase64) {
    throw new Error("No image returned from Azure FLUX");
  }

  return imageBase64;
}

function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "api-key": apiKey,
  };
}

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description: "Generate an image using Azure FLUX",
    inputSchema: {
      prompt: z.string().min(1, "prompt is required"),
    },
  },
  async ({ prompt }) => {
    console.error("[generate_image] Tool invoked");

    try {
      const endpoint = getRequiredEnv("AZURE_FLUX_ENDPOINT");
      const apiKey = getRequiredEnv("AZURE_FLUX_KEY");

      console.error("[generate_image] Endpoint configured:", !!endpoint);
      console.error("[generate_image] API key configured:", !!apiKey);
      console.error("[generate_image] Prompt:", prompt);

      const response = await axios.post(
        endpoint,
        {
          prompt,
          size: "1024x1024",
        },
        {
          headers: buildHeaders(apiKey),
          timeout: 30000,
        }
      );

      console.error("[generate_image] Response status:", response.status);

      const imageBase64 = extractImageFromResponse(response.data);

      console.error("[generate_image] Image extracted successfully");

      return {
        content: [
          {
            type: "text",
            text: "Image generated successfully.",
          },
          {
            type: "image",
            data: imageBase64,
            mimeType: "image/png",
          },
        ],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("[generate_image] Axios error message:", error.message);
        console.error(
          "[generate_image] Axios status:",
          error.response?.status ?? "N/A"
        );
        console.error(
          "[generate_image] Axios response data:",
          JSON.stringify(error.response?.data ?? null, null, 2)
        );
      } else {
        console.error("[generate_image] Unexpected error:", error);
      }

      throw new Error("Failed to generate image from Azure FLUX");
    }
  }
);

console.error("[server] Starting Azure FLUX MCP server...");

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[server] Azure FLUX MCP server is running.");
