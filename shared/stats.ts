import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const getSystemStats = defineRpc({
  name: "system-monitor.get-stats",
  input: z.object({}),
  output: z.object({
    cpuPercent: z.number(),
    memUsedBytes: z.number(),
    memTotalBytes: z.number(),
    diskUsedBytes: z.number(),
    diskTotalBytes: z.number(),
    diskPath: z.string(),
    loadAvg1: z.number(),
    loadAvg5: z.number(),
    loadAvg15: z.number(),
    cpuCount: z.number(),
    topProcesses: z.array(
      z.object({
        pid: z.number(),
        name: z.string(),
        cpuPercent: z.number(),
        memPercent: z.number(),
      }),
    ),
    rxBytesPerSec: z.number(),
    txBytesPerSec: z.number(),
    networkInterfaces: z.array(z.object({ name: z.string(), address: z.string() })),
    swapUsedBytes: z.number(),
    swapTotalBytes: z.number(),
    dockerDiskUsage: z.array(
      z.object({
        type: z.string(),
        size: z.string(),
        reclaimable: z.string(),
      }),
    ),
  }),
});
