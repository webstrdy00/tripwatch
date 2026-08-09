import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

const IPV4_LOOPBACK = "0100007F";
const LOOPBACK_HTTP_TIMEOUT_MS = 2_000;

function portHex(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LOOPBACK_PORT_REQUIRED");
  }
  return port.toString(16).toUpperCase().padStart(4, "0");
}

export function listeningAddresses(table: string, port: number): string[] {
  const targetPort = portHex(port);
  return table
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4 || fields[3] !== "0A") return [];
      const [address, listedPort] = fields[1]?.split(":") ?? [];
      return listedPort === targetPort && address ? [address] : [];
    });
}

export function assertLoopbackSocket(tcp: string, tcp6: string, port: number): void {
  const ipv4 = listeningAddresses(tcp, port);
  if (ipv4.length !== 1 || ipv4[0] !== IPV4_LOOPBACK || listeningAddresses(tcp6, port).length !== 0) {
    throw new Error("LOOPBACK_SOCKET_REQUIRED");
  }
}
export function windowsListeningAddresses(table: string, port: number): string[] {
  portHex(port);
  return table
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[0] === "TCP" && fields[3] === "LISTENING")
    .flatMap((fields) => {
      const local = fields[1] ?? "";
      const separator = local.lastIndexOf(":");
      if (separator < 0 || local.slice(separator + 1) !== String(port)) {
        return [];
      }
      return [local.slice(0, separator).replace(/^\[|\]$/g, "")];
    });
}

export function assertWindowsLoopbackSocket(table: string, port: number): void {
  const addresses = windowsListeningAddresses(table, port);
  if (addresses.length !== 1 || addresses[0] !== "127.0.0.1") {
    throw new Error("LOOPBACK_SOCKET_REQUIRED");
  }
}

async function readWindowsTcpTable(): Promise<string> {
  return new Promise<string>((resolveTable, rejectTable) => {
    execFile(
      "netstat",
      ["-ano", "-p", "tcp"],
      { encoding: "utf8", maxBuffer: 256 * 1024, timeout: 5_000, windowsHide: true },
      (error, stdout) => error ? rejectTable(error) : resolveTable(stdout)
    );
  });
}


export async function verifyLoopback(port: number): Promise<void> {
  if (process.platform === "win32") {
    assertWindowsLoopbackSocket(await readWindowsTcpTable(), port);
  } else {
    const [tcp, tcp6] = await Promise.all([
      readFile("/proc/net/tcp", "utf8"),
      readFile("/proc/net/tcp6", "utf8")
    ]);
    assertLoopbackSocket(tcp, tcp6, port);
  }
  const response = await fetch(`http://127.0.0.1:${port}/watchlist`, {
    redirect: "error",
    signal: AbortSignal.timeout(LOOPBACK_HTTP_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error("LOOPBACK_HTTP_REQUIRED");
}

export function parseLoopbackPortArguments(args: string[]): number {
  if (args.length !== 2 || args[0] !== "--port" || !/^\d+$/.test(args[1] ?? "")) {
    throw new Error("LOOPBACK_PORT_REQUIRED");
  }
  const port = Number(args[1]);
  portHex(port);
  return port;
}

if (process.argv[1]?.endsWith("verify-loopback.ts")) {
  void Promise.resolve()
    .then(() => verifyLoopback(parseLoopbackPortArguments(process.argv.slice(2))))
    .catch(() => {
      process.exitCode = 1;
      console.error("LOOPBACK_VERIFICATION_FAILED");
    });
}
