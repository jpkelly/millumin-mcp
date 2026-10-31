# millumin-mcp

An MCP server that lets Claude Code, or any MCP client, control [Millumin](https://www.millumin.com) on macOS through its [OSC API](https://github.com/anome/millumin-dev-kit/wiki/OSC-documentation).

It runs locally over stdio, started by the client. It sends OSC to Millumin and can listen for Millumin's feedback. Tested with Millumin 5.14.

## Tools

| Tool | Purpose |
|---|---|
| `millumin_action` | Run `/action/<name>` with optional args, e.g. `launchColumn [2]` |
| `millumin_set` | Set a property on a target (default `selectedLayer`), e.g. `position/xy [0, 80]` |
| `millumin_master` | Set the `video`, `audio` or `dmx` master, 0 to 1 |
| `millumin_send_raw` | Send any OSC address |
| `millumin_query` | Send `<address>/?` and return the replies (needs feedback) |
| `millumin_ping` | Send `/ping` and return the state of every layer (needs feedback) |
| `millumin_feedback` | Read recent feedback, optionally filtered |

## Setup

In Millumin's Device manager (⌘K), OSC tab:

- **OSC listener** on input port 5678.
- For feedback: an **OSC sender** to `127.0.0.1` port 5679, with feedback on.

Build the server (Node 20 or later):

```bash
git clone https://github.com/jpkelly/millumin-mcp.git
cd millumin-mcp
npm install
npm run build
```

Add it to your MCP client:

```json
{
  "mcpServers": {
    "millumin": {
      "command": "node",
      "args": ["/path/to/millumin-mcp/dist/server.js"],
      "env": { "MILLUMIN_FEEDBACK_PORT": "5679" }
    }
  }
}
```

| Variable | Default | |
|---|---|---|
| `MILLUMIN_HOST` | `127.0.0.1` | Where Millumin runs |
| `MILLUMIN_PORT` | `5678` | Millumin's OSC listener port |
| `MILLUMIN_FEEDBACK_PORT` | unset | Port to receive feedback on; unset turns feedback off |
| `MILLUMIN_ALLOW_DESTRUCTIVE` | unset | `1` allows `/action/quit` and `/action/saveProject`, which are refused otherwise |

## Notes

- Millumin's OSC API can't create layers, canvases, outputs or routings. Make those in Millumin.
- `selectedLayer` follows the selection in Millumin's interface. Target `index:N` when the selection may change.
- Launching a column that is already playing doesn't restart it. `goToTime [0]` restarts all media together.
- Feedback gives layer names in lowercase.

## Tests

```bash
npm test
```

Runs against a fake Millumin on a loopback port, never a real one.

## License

[MIT](LICENSE)
