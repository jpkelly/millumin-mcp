#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MilluminClient } from "./client.js";

// Millumin's OSC API listens on 5678 by default (OSC_API_MANAGER_LISTENING_PORT in
// com.anomes.millumin.v2 prefs). Override with env vars if you changed it.
const host = process.env.MILLUMIN_HOST ?? "127.0.0.1";
const port = Number(process.env.MILLUMIN_PORT ?? 5678);
const feedbackPort = process.env.MILLUMIN_FEEDBACK_PORT
  ? Number(process.env.MILLUMIN_FEEDBACK_PORT)
  : undefined;

const millumin = new MilluminClient({ host, port, feedbackPort });

// Addresses that can end the show or overwrite a file. They are refused unless
// MILLUMIN_ALLOW_DESTRUCTIVE=1 is set in the server's environment.
const destructive = /^\/action\/(quit|saveProject)\b/i;
const allowDestructive = process.env.MILLUMIN_ALLOW_DESTRUCTIVE === "1";

const argSchema = z.union([z.number(), z.string(), z.boolean()]);

const server = new McpServer({ name: "millumin", version: "0.1.0" });

server.registerTool(
  "millumin_action",
  {
    description:
      "Run a Millumin action, e.g. launchColumn [index or name], stopColumn, launchNextColumn, " +
      "playOrPause, goToTime [seconds], selectLayer [index or name], displayTestCard, hideTestCard.",
    inputSchema: {
      name: z.string().describe("Action name without the /action/ prefix, e.g. launchColumn"),
      args: z.array(argSchema).optional().describe("Action arguments"),
    },
  },
  async ({ name, args }) => {
    const address = `/action/${name}`;
    if (destructive.test(address) && !allowDestructive) {
      return refused(address);
    }
    await millumin.send(address, args ?? []);
    return ok(`sent ${address} ${JSON.stringify(args ?? [])}`);
  },
);

server.registerTool(
  "millumin_set",
  {
    description:
      "Set a property on a target. Target defaults to selectedLayer; other forms are " +
      "layer:<name>, light:<name>, index:<n>, or an element name. Property examples: " +
      "opacity, position/x, position/xy, rotation, scale, intensity, media/speed, media/normalizedTime.",
    inputSchema: {
      target: z.string().default("selectedLayer").describe("Target element, e.g. selectedLayer or layer:Intro"),
      property: z.string().describe("Property path, e.g. opacity or position/xy"),
      value: z.union([z.number(), z.string(), z.array(z.number())]).describe("Value; arrays are sent as multiple args"),
    },
  },
  async ({ target, property, value }) => {
    const address = `/${target}/${property}`;
    const args = Array.isArray(value) ? value : [value];
    await millumin.send(address, args);
    return ok(`sent ${address} ${JSON.stringify(args)}`);
  },
);

server.registerTool(
  "millumin_master",
  {
    description: "Set a master level: video, audio, or dmx. Value is normalized 0..1.",
    inputSchema: {
      channel: z.enum(["video", "audio", "dmx"]),
      value: z.number().min(0).max(1),
    },
  },
  async ({ channel, value }) => {
    const address = channel === "video" ? "/masterVideo" : channel === "audio" ? "/masterAudio" : "/masterDMX";
    await millumin.send(address, [value]);
    return ok(`sent ${address} [${value}]`);
  },
);

server.registerTool(
  "millumin_send_raw",
  {
    description:
      "Send an arbitrary OSC message to Millumin. Use only when no typed tool fits. " +
      "Destructive addresses (/action/quit, /action/saveProject) are refused unless the server was started with MILLUMIN_ALLOW_DESTRUCTIVE=1.",
    inputSchema: {
      address: z.string().startsWith("/").describe("OSC address, e.g. /selectedLayer/opacity"),
      args: z.array(argSchema).default([]),
    },
  },
  async ({ address, args }) => {
    if (destructive.test(address) && !allowDestructive) {
      return refused(address);
    }
    await millumin.send(address, args);
    return ok(`sent ${address} ${JSON.stringify(args)}`);
  },
);

server.registerTool(
  "millumin_ping",
  {
    description:
      "Send /ping and return the layer and board state Millumin reports back. " +
      "Requires MILLUMIN_FEEDBACK_PORT and Millumin's OSC \"API feedback\" enabled and pointed at that port.",
    inputSchema: {
      waitMs: z.number().int().min(100).max(10000).default(1000),
    },
  },
  async ({ waitMs }) => {
    if (feedbackPort === undefined) return noFeedback();
    const messages = await millumin.ping(waitMs);
    return ok(JSON.stringify({ count: messages.length, messages }, null, 2));
  },
);

server.registerTool(
  "millumin_feedback",
  {
    description:
      "Return recent feedback messages from Millumin (addresses start with /millumin), optionally " +
      "filtered by a case-insensitive substring such as \"launchedColumn\" or \"layer:Intro\".",
    inputSchema: {
      pattern: z.string().optional(),
      sinceSeconds: z.number().min(0).default(60).describe("Only messages from the last N seconds"),
    },
  },
  async ({ pattern, sinceSeconds }) => {
    if (feedbackPort === undefined) return noFeedback();
    const since = Date.now() - sinceSeconds * 1000;
    const messages = millumin.recentFeedback(pattern, since);
    return ok(JSON.stringify({ count: messages.length, messages }, null, 2));
  },
);

server.registerTool(
  "millumin_query",
  {
    description:
      "Ask Millumin for the current value of one property by sending address + \"/?\", " +
      "then return any feedback that came back. Example address: /layer:Intro/opacity.",
    inputSchema: {
      address: z.string().startsWith("/"),
      waitMs: z.number().int().min(100).max(5000).default(500),
    },
  },
  async ({ address, waitMs }) => {
    if (feedbackPort === undefined) return noFeedback();
    const since = Date.now();
    await millumin.send(`${address}/?`);
    await new Promise((r) => setTimeout(r, waitMs));
    const messages = millumin.recentFeedback(undefined, since);
    return ok(JSON.stringify({ count: messages.length, messages }, null, 2));
  },
);

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function refused(address: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Refused ${address}: destructive. Start the server with MILLUMIN_ALLOW_DESTRUCTIVE=1 to allow it.`,
      },
    ],
  };
}

function noFeedback() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "Feedback is not enabled. Set MILLUMIN_FEEDBACK_PORT and turn on OSC \"API feedback\" in Millumin's Device manager.",
      },
    ],
  };
}

async function main() {
  await millumin.start();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries MCP JSON-RPC, so diagnostics go to stderr.
  console.error(`millumin-mcp ready: OSC ${host}:${port}, feedback ${feedbackPort ?? "off"}`);
}

main().catch((err) => {
  console.error("millumin-mcp failed to start:", err);
  process.exit(1);
});
