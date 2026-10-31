// Loopback fake of Millumin's OSC endpoint. Tests never touch a real show: the fake
// binds an ephemeral port on 127.0.0.1 and records every packet the server sends.
import dgram from "node:dgram";
import { decodePacket } from "../../dist/osc.js";

export class FakeMillumin {
  #sock = dgram.createSocket("udp4");
  #packets = [];
  #waiters = [];

  get port() {
    return this.#sock.address().port;
  }

  async start() {
    this.#sock.on("message", (buf) => {
      let messages;
      try {
        messages = decodePacket(buf);
      } catch {
        messages = [];
      }
      this.#packets.push(...messages);
      for (const waiter of this.#waiters.splice(0)) waiter();
    });
    await new Promise((resolve, reject) => {
      this.#sock.once("error", reject);
      this.#sock.bind(0, "127.0.0.1", resolve);
    });
    return this;
  }

  // Resolves with the first received message whose address matches, or rejects after timeoutMs.
  waitFor(address, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${address} within ${timeoutMs}ms`)), timeoutMs);
      const check = () => {
        const hit = this.#packets.find((m) => m.address === address);
        if (hit) {
          clearTimeout(timer);
          resolve(hit);
        } else {
          this.#waiters.push(check);
        }
      };
      check();
    });
  }

  // Waits a fixed window and returns every message seen; used to prove nothing was sent.
  async settle(ms = 300) {
    await new Promise((r) => setTimeout(r, ms));
    return [...this.#packets];
  }

  close() {
    return new Promise((resolve) => this.#sock.close(resolve));
  }
}
