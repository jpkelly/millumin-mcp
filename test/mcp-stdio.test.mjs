import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FakeMillumin } from "./helpers/fake-millumin.mjs";

const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));

// Starts the built server against a fake Millumin on an ephemeral port and drives it
// over stdio with JSON-RPC. Every child is killed in t.after, so a failed test cannot hang the run.
class StdioServer {
  constructor(env = {}) {
    this.env = env;
    this.replies = new Map();
    this.buffer = "";
  }

  start(port) {
    this.child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, MILLUMIN_PORT: String(port), ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        this.replies.get(msg.id)?.(msg);
      }
    });
    return this;
  }

  request(id, method, params) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${method}`)), 5000);
      this.replies.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async handshake() {
    await this.request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  call(id, name, args) {
    return this.request(id, "tools/call", { name, arguments: args });
  }

  stop() {
    this.child?.kill("SIGKILL");
  }
}

// The README tool table is the documented contract; the server must expose exactly those tools.
function documentedTools() {
  const section = readFileSync(readmePath, "utf8").split("## Tools")[1].split("## Setup")[0];
  return [...section.matchAll(/^\| `(millumin_\w+)` \|/gm)].map((m) => m[1]).sort();
}

describe("millumin-mcp over stdio", () => {
  let fake;

  before(async () => {
    fake = await new FakeMillumin().start();
  });

  after(async () => {
    await fake.close();
  });

  it("exposes exactly the tools documented in the README", async (t) => {
    const server = new StdioServer().start(fake.port);
    t.after(() => server.stop());
    await server.handshake();
    const reply = await server.request(2, "tools/list", {});
    const names = reply.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, documentedTools());
  });

  it("forwards millumin_action as an OSC message with typed args", async (t) => {
    const server = new StdioServer().start(fake.port);
    t.after(() => server.stop());
    await server.handshake();
    const sent = fake.waitFor("/action/launchColumn");
    const reply = await server.call(3, "millumin_action", { name: "launchColumn", args: [11] });
    const msg = await sent;
    assert.deepEqual(msg.args, [11]);
    assert.notEqual(reply.result.isError, true);
  });

  it("refuses quit without sending anything to Millumin", async (t) => {
    const server = new StdioServer().start(fake.port);
    t.after(() => server.stop());
    await server.handshake();
    const reply = await server.call(4, "millumin_action", { name: "quit" });
    assert.equal(reply.result.isError, true);
    const seen = await fake.settle();
    assert.equal(seen.some((m) => m.address === "/action/quit"), false);
  });

  it("reports feedback as disabled when no feedback port is configured", async (t) => {
    const server = new StdioServer().start(fake.port);
    t.after(() => server.stop());
    await server.handshake();
    const reply = await server.call(5, "millumin_feedback", {});
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Feedback is not enabled/);
  });
});
