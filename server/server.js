import "dotenv/config";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const server = new McpServer({
  name: "azure-flux-mcp",
  version: "1.0.0",
});

server.registerTool(
  "generate_image",
  {
    title: "Generate Image",
    description: "Generate an image using Azure FLUX",
    inputSchema: z.object({
      prompt: z.string()
    })
  },
  async ({ prompt }) => {
    try {
      const endpoint = process.env.AZURE_FLUX_ENDPOINT;
      const apiKey = process.env.AZURE_FLUX_KEY;

      if (!endpoint) {
        throw new Error("AZURE_FLUX_ENDPOINT is not set");
      }
      if (!apiKey) {
        throw new Error("AZURE_FLUX_KEY is not set");
      }

      console.error("generate_image called:", prompt);
      // console.error("endpoint exists:", !!process.env.AZURE_FLUX_ENDPOINT);
      // console.error("apiKey exists:", !!process.env.AZURE_FLUX_KEY);

      const response = await axios.post(
        endpoint,
        {
          prompt,
          size: "1024x1024"
        },
        {
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
          }
        }
      );

      console.error("status:", response.status);
      // console.error("response data:", JSON.stringify(response.data, null, 2));

      let imageBase64 =
        response.data?.data?.[0]?.b64_json ||
        response.data?.images?.[0] ||
        response.data?.output?.[0] ||
        response.data?.result?.image;

      if (!imageBase64) {
        console.error("FULL RESPONSE:", JSON.stringify(response.data, null, 2));
        throw new Error("No image returned from Azure FLUX");
        // throw new Error("No image found in response");
      }
      return {
        content: [
          { type: "text", text: "Image generated successfully" },
          {
            type: "image",
            data: imageBase64,
            mimeType: "image/png"
          }
        ]
      };

    } catch (error) {
      console.error("generate_image error:", error?.response?.data || error.message || error);
      throw error;
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
