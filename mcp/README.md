# Tiger Slack MCP Server

A wrapper around our Slack database, to provide some focused tools to LLMs via the [Model Context Protocol](https://modelcontextprotocol.io/introduction).

See [slack-db](https://github.com/timescale/slack-db/) for details on how the database is populated.

## Development

Cloning and running the server locally.

```bash
git clone --recurse-submodules git@github.com:timescale/tiger-slack-mcp-server.git
```

### Submodules

This project uses git submodules to include the mcp boilerplate code. If you cloned the repo without the `--recurse-submodules` flag, run the following command to initialize and update the submodules:

```bash
git submodule update --init --recursive
```

You may also need to run this command if you pull changes that update a submodule. You can simplify this process by changing you git configuration to automatically update submodules when you pull:

```bash
git config --global submodule.recurse true
```

### Building

Run `npm i` to install dependencies and build the project. Use `npm run watch` to rebuild on changes.

Create a `.env` file based on the `.env.sample` file.

```bash
cp .env.sample .env
```

### Testing

The MCP Inspector is very handy.

```bash
npm run inspector
```

| Field          | Value           |
| -------------- | --------------- |
| Transport Type | `STDIO`         |
| Command        | `node`          |
| Arguments      | `dist/index.js` |

#### Testing in Claude Desktop

Create/edit the file `~/Library/Application Support/Claude/claude_desktop_config.json` to add an entry like the following, making sure to use the absolute path to your local `tiger-slack-mcp-server` project, and real database credentials.

```json
{
  "mcpServers": {
    "tiger-slack": {
      "command": "node",
      "args": [
        "/absolute/path/to/tiger-slack-mcp-server/dist/index.js",
        "stdio"
      ],
      "env": {
        "PGHOST": "x.y.tsdb.cloud.timescale.com",
        "PGDATABASE": "tsdb",
        "PGPORT": "32467",
        "PGUSER": "readonly_mcp_user",
        "PGPASSWORD": "abc123"
      }
    }
  }
}
```
