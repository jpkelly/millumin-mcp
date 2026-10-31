import dgram from "node:dgram";
import { encodeMessage, decodePacket, type OscArg, type OscMessage } from "./osc.js";

export interface MilluminClientOptions {
  host: string;
  port: number;
  // Optional local UDP port to receive Millumin feedback on. Feedback must be
  // enabled in Millumin (Device manager, CMD+K, OSC tab, "API feedback") and
  // pointed at this port. Leave unset to disable the listener.
  feedbackPort?: number;
  feedbackBufferSize?: number;
}

// Thin UDP client around Millumin's OSC API. Sends are fire-and-forget;
// feedback messages (prefixed "/millumin") are kept in a bounded ring buffer.
export class MilluminClient {
  private sock = dgram.createSocket("udp4");
  private listener: dgram.Socket | null = null;
  private feedback: Array<{ at: string } & OscMessage> = [];
  private readonly bufferSize: number;

  constructor(private readonly opts: MilluminClientOptions) {
    this.bufferSize = opts.feedbackBufferSize ?? 500;
  }

  async start(): Promise<void> {
    if (this.opts.feedbackPort === undefined) return;
    const listener = dgram.createSocket("udp4");
    listener.on("message", (packet) => {
      try {
        for (const msg of decodePacket(packet)) {
          this.feedback.push({ at: new Date().toISOString(), ...msg });
        }
        if (this.feedback.length > this.bufferSize) {
          this.feedback.splice(0, this.feedback.length - this.bufferSize);
        }
      } catch {
        // Ignore packets we cannot decode; Millumin may send types we do not parse.
      }
    });
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.bind(this.opts.feedbackPort, () => {
        listener.removeListener("error", reject);
        resolve();
      });
    });
    this.listener = listener;
  }

  stop(): void {
    this.sock.close();
    this.listener?.close();
  }

  send(address: string, args: OscArg[] = []): Promise<void> {
    const packet = encodeMessage(address, args);
    return new Promise((resolve, reject) => {
      this.sock.send(packet, this.opts.port, this.opts.host, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  // Returns feedback received since `sinceMs` (epoch ms) that matches `pattern`.
  // Patterns are matched case-insensitively against the address, so "/millumin/layer:Intro" works.
  recentFeedback(pattern?: string, sinceMs = 0): Array<{ at: string } & OscMessage> {
    const needle = pattern?.toLowerCase();
    return this.feedback.filter(
      (m) =>
        Date.parse(m.at) >= sinceMs &&
        (needle === undefined || m.address.toLowerCase().includes(needle)),
    );
  }

  // Sends /ping and collects the state messages Millumin returns during `waitMs`.
  // Requires the feedback listener to be enabled.
  async ping(waitMs = 1000): Promise<Array<{ at: string } & OscMessage>> {
    const since = Date.now();
    await this.send("/ping");
    await new Promise((r) => setTimeout(r, waitMs));
    return this.recentFeedback(undefined, since);
  }
}
