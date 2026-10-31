import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeMessage, decodePacket } from "../dist/osc.js";

describe("encodeMessage / decodePacket", () => {
  it("round-trips int, float and string arguments", () => {
    const packet = encodeMessage("/selectedLayer/opacity", [3, 0.75, "Intro"]);
    assert.equal(packet.length % 4, 0, "OSC packets are 4-byte aligned");
    const [msg] = decodePacket(packet);
    assert.equal(msg.address, "/selectedLayer/opacity");
    assert.equal(msg.args[0], 3);
    assert.equal(msg.args[1], Math.fround(0.75));
    assert.equal(msg.args[2], "Intro");
  });

  it("encodes an address with no arguments", () => {
    assert.deepEqual(decodePacket(encodeMessage("/ping")), [{ address: "/ping", args: [] }]);
  });

  // Boundary table: integers that fit int32 stay ints, larger ones become float32.
  const intBoundaries = [
    [-2147483648, "i"],
    [2147483647, "i"],
    [2147483648, "f"],
    [-2147483649, "f"],
    [0.5, "f"],
  ];
  for (const [value, tag] of intBoundaries) {
    it(`sends ${value} with type tag ${tag}`, () => {
      const packet = encodeMessage("/value", [value]);
      const tags = packet.toString("latin1", 8, 12);
      assert.equal(tags[1], tag);
    });
  }

  const badInputs = [
    ["address without leading slash", "ping", []],
    ["null argument", "/x", [null]],
    ["object argument", "/x", [{}]],
  ];
  for (const [label, address, args] of badInputs) {
    it(`rejects ${label}`, () => {
      assert.throws(() => encodeMessage(address, args));
    });
  }

  it("decodes a bundle into its messages", () => {
    const a = encodeMessage("/a", [1]);
    const b = encodeMessage("/b", ["x"]);
    const head = Buffer.alloc(16);
    head.write("#bundle\0", 0);
    const sizeA = Buffer.alloc(4);
    sizeA.writeInt32BE(a.length);
    const sizeB = Buffer.alloc(4);
    sizeB.writeInt32BE(b.length);
    const msgs = decodePacket(Buffer.concat([head, sizeA, a, sizeB, b]));
    assert.deepEqual(msgs.map((m) => m.address), ["/a", "/b"]);
  });
});
