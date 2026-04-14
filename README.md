# Azure FLUX MCP Server

A simple MCP server for generating images through Azure FLUX from VS Code or other MCP-compatible clients.

## Features

- MCP stdio server based on `@modelcontextprotocol/sdk`
- Image generation through Azure FLUX
- VS Code MCP integration with `.vscode/mcp.json`
- Returns generated image data directly to the MCP client

## Requirements

- Node.js 18 or later
- An Azure FLUX endpoint
- An Azure FLUX API key
- VS Code with MCP support enabled

## Project Structure

```text
.
├─ .vscode/
│  └─ mcp.json
├─ server/
│  └─ server.js
├─ .env
├─ package.json
└─ README.md
````

## Installation

Install dependencies:

```bash
npm install
```

## Environment Variables

Create a `.env` file in the project root:

```env
AZURE_FLUX_ENDPOINT=https://your-endpoint-here
AZURE_FLUX_KEY=your-api-key-here
```

## Run the Server Manually

You can run the MCP server directly:

```bash
node server/server.js
```

When running as an MCP stdio server, it may appear idle in the terminal. This is normal. The server waits for an MCP client to connect.

## VS Code MCP Configuration

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "azureFluxMcp": {
      "type": "stdio",
      "command": "node",
      "args": ["server/server.js"],
      "envFile": "${workspaceFolder}/.env"
    }
  }
}
```

## Using in VS Code

1. Open the project in VS Code or Codespaces.
2. Make sure `.env` is configured.
3. Open Command Palette.
4. Run `MCP: List Servers`.
5. Start `azureFluxMcp` if it is not already running.
6. Open Chat and type `#`.
7. Select `#generate_image`.
8. Enter a prompt such as:

```text
#generate_image 서울의 밤을 사이버펑크 스타일로 만들어줘
```

## Debugging

If the tool is discovered but image generation fails:

1. Open Command Palette
2. Run `MCP: List Servers`
3. Select `azureFluxMcp`
4. Choose `Show Output`

Useful log messages include:

* server startup logs
* tool invocation logs
* Azure response status
* Azure error response body

If you changed the code, restart the MCP server:

```text
MCP: List Servers → azureFluxMcp → Restart
```

## Notes

* The current Azure FLUX response is expected to use:

```js
response.data?.data?.[0]?.b64_json
```

* The server also includes fallback parsing for a few alternative response shapes.

## License

MIT
