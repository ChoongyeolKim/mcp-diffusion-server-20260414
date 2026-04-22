import "dotenv/config";
import axios from "axios";
import { BlobServiceClient } from "@azure/storage-blob";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "node:http";
import { randomUUID } from "node:crypto";

// ─── Helper functions ────────────────────────────────────────────────────────

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

// ─── Azure Blob Storage upload ───────────────────────────────────────────────
// Returns the public URL if AZURE_BLOB_CONNECTION is configured, otherwise null.

async function uploadToBlob(imageBase64) {
  const connectionString = process.env.AZURE_BLOB_CONNECTION?.trim();
  if (!connectionString) return null;

  const container =
    process.env.AZURE_BLOB_CONTAINER?.trim();
  const directory = process.env.AZURE_BLOB_DIRECTORY?.trim();

  // Strip data URL prefix if present (e.g. "data:image/png;base64,...")
  const base64Data = imageBase64.includes(",")
    ? imageBase64.split(",")[1]
    : imageBase64;

  const buffer = Buffer.from(base64Data, "base64");
  const blobName = `${directory}/${Date.now()}-${randomUUID()}.png`;

  console.error("[blob] Uploading to container:", container, "blob:", blobName);

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(container);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: "image/png" },
  });

  console.error("[blob] Upload complete. URL:", blockBlobClient.url);
  return blockBlobClient.url;
}

// ─── MCP Server factory ──────────────────────────────────────────────────────
// Creates a new McpServer instance with all tools registered.
// Called once for stdio, or once per session for streamable HTTP.

function createMcpServer() {
  const server = new McpServer({
    name: "azure-flux-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description: "Generate an image using Azure FLUX",
      inputSchema: {
        prompt: z
          .string()
          .min(1, "prompt is required")
          .describe(
            "Image generation prompt. MUST be written in English. " +
              "If the user's input is in another language, translate it to English first."
          ),
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

        const blobUrl = await uploadToBlob(imageBase64);
        if (blobUrl) {
          return {
            content: [
              {
                type: "text",
                text: `Image generated successfully.\n\n![generated image](${blobUrl})\n\nURL: ${blobUrl}`,
              },
            ],
          };
        }

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

  server.registerTool(
    "restore_image",
    {
      title: "Restore Image",
      description:
        "Restore or edit an existing image using Azure FLUX.1-Kontext-pro. " +
        "Provide the original image as a base64-encoded string and a prompt " +
        "describing the desired changes (e.g. 'remove scratches', 'fix color', " +
        "'replace background with a sunny beach').",
      inputSchema: {
        prompt: z
          .string()
          .min(1, "prompt is required")
          .describe(
            "Image editing/restoration prompt. MUST be written in English. " +
              "If the user's input is in another language, translate it to English first."
          ),
        image: z
          .string()
          .min(1, "image (base64) is required")
          .describe(
            "Base64-encoded source image. Accepts raw base64 or a data URL " +
              "(data:image/png;base64,...). JPEG and PNG are supported."
          ),
        size: z
          .string()
          .default("1024x1024")
          .describe(
            "Output image size. Supported values: '1024x1024', '1792x1024', '1024x1792'."
          ),
      },
    },
    async ({ prompt, image, size }) => {
      console.error("[restore_image] Tool invoked");

      try {
        const endpoint = getRequiredEnv("AZURE_FLUX_ENDPOINT");
        const apiKey = getRequiredEnv("AZURE_FLUX_KEY");

        console.error("[restore_image] Endpoint configured:", !!endpoint);
        console.error("[restore_image] API key configured:", !!apiKey);
        console.error("[restore_image] Prompt:", prompt);
        console.error("[restore_image] Size:", size);
        console.error(
          "[restore_image] Image length (chars):",
          image.length
        );

        // Normalize to data URL so the model receives a well-formed value
        // regardless of whether the caller passed raw base64 or a data URL.
        const imageDataUrl = image.startsWith("data:")
          ? image
          : `data:image/png;base64,${image}`;

        const response = await axios.post(
          endpoint,
          {
            prompt,
            image: imageDataUrl,
            size,
          },
          {
            headers: buildHeaders(apiKey),
            timeout: 60000, // editing is slower than generation
          }
        );

        console.error("[restore_image] Response status:", response.status);

        const imageBase64 = extractImageFromResponse(response.data);

        console.error("[restore_image] Image extracted successfully");

        const blobUrl = await uploadToBlob(imageBase64);
        if (blobUrl) {
          return {
            content: [
              {
                type: "text",
                text: `Image restored successfully.\n\n![restored image](${blobUrl})\n\nURL: ${blobUrl}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "Image restored successfully.",
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
          console.error("[restore_image] Axios error message:", error.message);
          console.error(
            "[restore_image] Axios status:",
            error.response?.status ?? "N/A"
          );
          console.error(
            "[restore_image] Axios response data:",
            JSON.stringify(error.response?.data ?? null, null, 2)
          );
        } else {
          console.error("[restore_image] Unexpected error:", error);
        }

        throw new Error("Failed to restore image using Azure FLUX");
      }
    }
  );

  return server;
}

// ─── Transport selection ─────────────────────────────────────────────────────

const transportType = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
console.error(`[server] Transport mode: ${transportType}`);

if (transportType === "streamable") {
  // ── Streamable HTTP transport ──────────────────────────────────────────────
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const mcpApiKey = process.env.MCP_API_KEY?.trim();

  if (mcpApiKey) {
    console.error("[server] API key authentication: enabled");
  } else {
    console.error("[server] API key authentication: disabled (MCP_API_KEY not set)");
  }

  // Session map: sessionId → StreamableHTTPServerTransport
  const sessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    // Only handle /mcp endpoint
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    // ── API Key check ────────────────────────────────────────────────────────
    if (mcpApiKey) {
      const authHeader = req.headers["authorization"] ?? "";
      const providedKey = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      if (providedKey !== mcpApiKey) {
        console.error("[server] Unauthorized request — invalid or missing API key");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    try {
      if (req.method === "POST") {
        // Read and parse the JSON body
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        const sessionId = req.headers["mcp-session-id"];
        let transport;

        if (sessionId && sessions.has(sessionId)) {
          // Existing session — reuse its transport
          transport = sessions.get(sessionId);
        } else {
          // New session — create a fresh server + transport pair
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, transport);
              console.error(`[server] Session created: ${id}`);
            },
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              sessions.delete(transport.sessionId);
              console.error(`[server] Session closed: ${transport.sessionId}`);
            }
          };

          const mcpServer = createMcpServer();
          await mcpServer.connect(transport);
        }

        await transport.handleRequest(req, res, body);
      } else if (req.method === "GET" || req.method === "DELETE") {
        // SSE stream (GET) or session termination (DELETE)
        const sessionId = req.headers["mcp-session-id"];
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
          return;
        }
        await sessions.get(sessionId).handleRequest(req, res);
      } else {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
      }
    } catch (err) {
      console.error("[server] HTTP handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(
      `[server] Azure FLUX MCP server (streamable HTTP) listening on port ${port}`
    );
    console.error(`[server] MCP endpoint: http://localhost:${port}/mcp`);
  });
} else {
  // ── stdio transport (default) ──────────────────────────────────────────────
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[server] Azure FLUX MCP server is running via stdio.");
}
