import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Socket } from "node:net";

import {
  assertLoopbackSocket,
  assertWindowsLoopbackSocket,
  listeningAddresses,
  parseLoopbackPortArguments,
  verifyLoopback,
  windowsListeningAddresses
} from "../../scripts/verify-loopback";

const HEADER = "  sl  local_address rem_address   st";

function table(...addresses: string[]): string {
  return [
    HEADER,
    ...addresses.map((address, index) => ` ${index}: ${address}:0BB8 00000000:0000 0A 00000000:00000000`)
  ].join("\n");
}

test("loopback verifier accepts exactly one IPv4 loopback listener and no IPv6 listener", () => {
  const tcp = table("0100007F");
  assert.deepEqual(listeningAddresses(tcp, 3000), ["0100007F"]);
  assert.doesNotThrow(() => assertLoopbackSocket(tcp, HEADER, 3000));
});

test("loopback verifier rejects wildcard, IPv6, absent, and multiple listeners", () => {
  for (const [tcp, tcp6] of [
    [table("00000000"), HEADER],
    [HEADER, table("00000000000000000000000001000000")],
    [HEADER, HEADER],
    [table("0100007F", "0100007F"), HEADER]
  ]) {
    assert.throws(() => assertLoopbackSocket(tcp, tcp6, 3000), /LOOPBACK_SOCKET_REQUIRED/);
  }
});

test("Windows verifier accepts only one literal IPv4 loopback listener", () => {
  const rows = [
    "Proto  Local Address          Foreign Address        State           PID",
    "TCP    127.0.0.1:3000        0.0.0.0:0              LISTENING       10",
    "TCP    127.0.0.1:3000        127.0.0.1:4444         ESTABLISHED     10"
  ].join("\n");
  assert.deepEqual(windowsListeningAddresses(rows, 3000), ["127.0.0.1"]);
  assert.doesNotThrow(() => assertWindowsLoopbackSocket(rows, 3000));

  for (const address of ["0.0.0.0", "[::]", "[::1]", "127.0.0.2"]) {
    const invalid = `TCP    ${address}:3000        0.0.0.0:0        LISTENING       10`;
    assert.throws(() => assertWindowsLoopbackSocket(invalid, 3000), /LOOPBACK_SOCKET_REQUIRED/);
  }
});

test("loopback verifier requires an explicit strict --port argument", () => {
  assert.equal(parseLoopbackPortArguments(["--port", "3000"]), 3000);
  for (const args of [[], ["3000"], ["--port"], ["--port", "0"], ["--port", "65536"], ["--port", "3000", "extra"]]) {
    assert.throws(() => parseLoopbackPortArguments(args), /LOOPBACK_PORT_REQUIRED/);
  }
});
test("loopback verifier aborts a nonresponsive listener", { timeout: 10_000 }, async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(verifyLoopback(address.port));
    for (const socket of sockets) socket.destroy();
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  }
});
