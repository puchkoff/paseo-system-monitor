import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function cpuSnapshot() {
  return os.cpus().map((cpu) => {
    const { user, nice, sys, idle, irq } = cpu.times;
    return { idle, total: user + nice + sys + idle + irq };
  });
}

async function netSnapshot() {
  if (os.platform() !== "linux") return { rxBytes: 0, txBytes: 0 };
  const contents = await readFile("/proc/net/dev", "utf8");
  let rxBytes = 0;
  let txBytes = 0;
  for (const line of contents.trim().split("\n").slice(2)) {
    const [ifaceRaw, rest] = line.split(":");
    if (!rest || ifaceRaw.trim() === "lo") continue;
    const fields = rest.trim().split(/\s+/).map(Number);
    rxBytes += fields[0] ?? 0;
    txBytes += fields[8] ?? 0;
  }
  return { rxBytes, txBytes };
}

async function readCpuAndNetwork(intervalMs: number) {
  const cpuBefore = cpuSnapshot();
  const netBefore = await netSnapshot();
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  const cpuAfter = cpuSnapshot();
  const netAfter = await netSnapshot();

  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < cpuAfter.length; i++) {
    idleDelta += cpuAfter[i].idle - cpuBefore[i].idle;
    totalDelta += cpuAfter[i].total - cpuBefore[i].total;
  }
  const cpuPercent =
    totalDelta <= 0 ? 0 : Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));

  const seconds = intervalMs / 1000;
  return {
    cpuPercent,
    rxBytesPerSec: Math.max(0, (netAfter.rxBytes - netBefore.rxBytes) / seconds),
    txBytesPerSec: Math.max(0, (netAfter.txBytes - netBefore.txBytes) / seconds),
  };
}

function readNetworkInterfaces() {
  const interfaces = os.networkInterfaces();
  const result: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === "IPv4") {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

async function readSwapUsage() {
  if (os.platform() !== "linux") return { swapUsedBytes: 0, swapTotalBytes: 0 };
  const contents = await readFile("/proc/meminfo", "utf8");
  const totalKb = Number(contents.match(/^SwapTotal:\s+(\d+) kB/m)?.[1] ?? 0);
  const freeKb = Number(contents.match(/^SwapFree:\s+(\d+) kB/m)?.[1] ?? 0);
  return { swapTotalBytes: totalKb * 1024, swapUsedBytes: (totalKb - freeKb) * 1024 };
}

async function readDiskUsage(diskPath: string) {
  const { stdout } = await execFileAsync("df", ["-kP", diskPath]);
  const line = stdout.trim().split("\n").at(-1) ?? "";
  const columns = line.split(/\s+/);
  const totalKb = Number(columns[1]);
  const usedKb = Number(columns[2]);
  return {
    diskUsedBytes: usedKb * 1024,
    diskTotalBytes: totalKb * 1024,
  };
}

const TOP_PROCESS_LINE = /^\s*(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s*$/;

async function readTopProcesses(limit: number) {
  if (os.platform() === "win32") return [];
  const { stdout } = await execFileAsync("ps", [
    "-eo",
    "pid,comm,pcpu,pmem",
    "--no-headers",
    "--sort=-pcpu",
  ]);
  return stdout
    .split("\n")
    .slice(0, limit)
    .map((line) => line.match(TOP_PROCESS_LINE))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      name: match[2],
      cpuPercent: Number(match[3]),
      memPercent: Number(match[4]),
    }));
}

export async function handleGetSystemStats() {
  const diskPath = os.platform() === "win32" ? "C:\\" : "/";
  const [{ cpuPercent, rxBytesPerSec, txBytesPerSec }, disk, topProcesses, swap] = await Promise.all([
    readCpuAndNetwork(200),
    readDiskUsage(diskPath),
    readTopProcesses(8),
    readSwapUsage(),
  ]);
  const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();
  return {
    cpuPercent,
    memUsedBytes: os.totalmem() - os.freemem(),
    memTotalBytes: os.totalmem(),
    diskUsedBytes: disk.diskUsedBytes,
    diskTotalBytes: disk.diskTotalBytes,
    diskPath,
    loadAvg1,
    loadAvg5,
    loadAvg15,
    cpuCount: os.cpus().length,
    topProcesses,
    rxBytesPerSec,
    txBytesPerSec,
    networkInterfaces: readNetworkInterfaces(),
    swapUsedBytes: swap.swapUsedBytes,
    swapTotalBytes: swap.swapTotalBytes,
  };
}
