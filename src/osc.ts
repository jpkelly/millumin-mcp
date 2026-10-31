// Minimal OSC 1.0 encoder/decoder for the types Millumin uses (i, f, s, plus T/F/N).
// Hand-rolled to keep the server dependency-free beyond the MCP SDK.

export type OscArg = number | string | boolean;

const pad4 = (n: number): number => (4 - (n % 4)) % 4;

function encodeString(s: string): Buffer {
  const raw = Buffer.from(s + "\0", "utf8");
  return Buffer.concat([raw, Buffer.alloc(pad4(raw.length))]);
}

// Encode an OSC message. Integers are sent as int32 when they fit, otherwise float32.
export function encodeMessage(address: string, args: OscArg[] = []): Buffer {
  if (!address.startsWith("/")) {
    throw new Error(`OSC address must start with "/": ${address}`);
  }
  let tags = ",";
  const payload: Buffer[] = [];
  for (const arg of args) {
    if (typeof arg === "number") {
      if (Number.isInteger(arg) && arg >= -2147483648 && arg <= 2147483647) {
        tags += "i";
        const b = Buffer.alloc(4);
        b.writeInt32BE(arg);
        payload.push(b);
      } else {
        tags += "f";
        const b = Buffer.alloc(4);
        b.writeFloatBE(arg);
        payload.push(b);
      }
    } else if (typeof arg === "string") {
      tags += "s";
      payload.push(encodeString(arg));
    } else if (typeof arg === "boolean") {
      tags += arg ? "T" : "F";
    } else {
      throw new Error(`Unsupported OSC argument type: ${typeof arg}`);
    }
  }
  return Buffer.concat([encodeString(address), encodeString(tags), ...payload]);
}

export interface OscMessage {
  address: string;
  args: Array<number | string | boolean | null>;
}

function readString(buf: Buffer, offset: number): { value: string; next: number } {
  const end = buf.indexOf(0, offset);
  if (end < 0) throw new Error("Unterminated OSC string");
  const value = buf.toString("utf8", offset, end);
  const next = end + 1 + pad4(end + 1 - offset);
  return { value, next };
}

// Decode a single OSC message packet. Bundles are not supported here; use decodePacket for those.
export function decodeMessage(buf: Buffer): OscMessage {
  const addr = readString(buf, 0);
  if (!addr.value.startsWith("/")) throw new Error("Not an OSC message");
  const tagsRead = readString(buf, addr.next);
  const tags = tagsRead.value;
  const args: OscMessage["args"] = [];
  let offset = tagsRead.next;
  for (const tag of tags.slice(1)) {
    switch (tag) {
      case "i":
        args.push(buf.readInt32BE(offset));
        offset += 4;
        break;
      case "f":
        args.push(buf.readFloatBE(offset));
        offset += 4;
        break;
      case "s": {
        const s = readString(buf, offset);
        args.push(s.value);
        offset = s.next;
        break;
      }
      case "T":
        args.push(true);
        break;
      case "F":
        args.push(false);
        break;
      case "N":
        args.push(null);
        break;
      default:
        // Unknown type tag: stop decoding args rather than misreading the packet.
        return { address: addr.value, args };
    }
  }
  return { address: addr.value, args };
}

// Decode a packet that may be a bundle ("#bundle") or a single message.
export function decodePacket(buf: Buffer): OscMessage[] {
  if (buf.toString("utf8", 0, 8) === "#bundle\0") {
    const out: OscMessage[] = [];
    let offset = 16;
    while (offset + 4 <= buf.length) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      out.push(...decodePacket(buf.subarray(offset, offset + size)));
      offset += size;
    }
    return out;
  }
  return [decodeMessage(buf)];
}
