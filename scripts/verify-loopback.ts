import { readFile } from "node:fs/promises";

const PORT_HEX = "0BB8";
const IPV4_LOOPBACK = "0100007F";

function listeningAddresses(table: string): string[] {
  const lines = table.split("\n").slice(1);
  const addresses: string[] = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || fields[3] !== "0A") {
      continue;
    }
    const [address, port] = fields[1].split(":");
    if (port === PORT_HEX) {
      addresses.push(address);
    }
  }
  return addresses;
}

export function assertLoopbackSocket(tcp: string, tcp6: string): void {
  const ipv4 = listeningAddresses(tcp);
  if (ipv4.length !== 1 || ipv4[0] !== IPV4_LOOPBACK) {
    throw new Error("LOOPBACK_SOCKET_REQUIRED");
  }
  if (listeningAddresses(tcp6).length !== 0) {
    throw new Error("LOOPBACK_SOCKET_REQUIRED");
  }
}

export async function verifyLoopback(): Promise<void> {
  const [tcp, tcp6] = await Promise.all([
    readFile("/proc/net/tcp", "utf8"),
    readFile("/proc/net/tcp6", "utf8")
  ]);
  assertLoopbackSocket(tcp, tcp6);
  const response = await fetch("http://127.0.0.1:3000/watchlist", { redirect: "error" });
  if (!response.ok) {
    throw new Error("LOOPBACK_HTTP_REQUIRED");
  }
}

void verifyLoopback().catch(() => {
  process.exitCode = 1;
  console.error("LOOPBACK_VERIFICATION_FAILED");
});
