import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { getSystemStats } from "./stats.shared";

const HISTORY_LENGTH = 24;

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

function formatRate(bytesPerSec: number): string {
  const mb = bytesPerSec / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bytesPerSec / 1024;
  return `${kb.toFixed(0)} KB/s`;
}

function statusColor(theme: PluginTheme, percent: number): string | null {
  if (percent >= 90) return theme.colors.statusDanger;
  if (percent >= 70) return theme.colors.statusWarning;
  return null;
}

// One fixed hue per metric so the tiles read apart at a glance. Skips the
// green/red slots — those stay reserved for the good/critical status colors,
// so a resting tile is never mistaken for a severity signal.
const TILE_COLORS = {
  blue: "#2a78d6",
  orange: "#eb6834",
  aqua: "#1baf7a",
  yellow: "#eda100",
  magenta: "#e87ba4",
  violet: "#4a3aa7",
  green: "#008300",
} as const;

// Auto-scaled to the window's own max (not a fixed 0-100), so a quiet CPU
// or a slow network link still shows visible motion instead of flat slivers.
function Sparkline({ values, color, height = 28 }: { values: number[]; color: string; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height }}>
      {values.map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: `${Math.max(4, Math.min(100, (value / max) * 100))}%`,
            borderRadius: 1,
            backgroundColor: color,
            opacity: 0.35 + 0.65 * ((index + 1) / values.length),
          }}
        />
      ))}
    </View>
  );
}

function StatTile({
  theme,
  compact,
  label,
  value,
  percent,
  sub,
  color,
  history,
  footer,
}: {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  value: string;
  percent?: number;
  sub?: string;
  color: string;
  history?: number[];
  footer?: React.ReactNode;
}) {
  const accent = (percent !== undefined && statusColor(theme, percent)) || color;
  return (
    <View
      style={{
        width: compact ? "100%" : 220,
        gap: 8,
        padding: 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
      <Text style={{ color: accent, fontSize: 26, fontWeight: "700" }}>{value}</Text>
      {history && history.length > 1 ? (
        <Sparkline values={history} color={accent} />
      ) : percent !== undefined ? (
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.surface2,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.min(100, Math.max(0, percent))}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: accent,
            }}
          />
        </View>
      ) : null}
      {sub ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{sub}</Text> : null}
      {footer}
    </View>
  );
}

function LoadAvgFooter({
  fiveMin,
  fifteenMin,
  cpuCount,
  theme,
}: {
  fiveMin: number;
  fifteenMin: number;
  cpuCount: number;
  theme: PluginTheme;
}) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>5m</Text>
          <Text style={{ color: TILE_COLORS.magenta, fontSize: 18, fontWeight: "800" }}>
            {fiveMin.toFixed(2)}
          </Text>
        </View>
        <View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>15m</Text>
          <Text style={{ color: TILE_COLORS.violet, fontSize: 18, fontWeight: "800" }}>
            {fifteenMin.toFixed(2)}
          </Text>
        </View>
      </View>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{cpuCount} cores</Text>
    </View>
  );
}

function SwapFooter({
  theme,
  usedBytes,
  totalBytes,
}: {
  theme: PluginTheme;
  usedBytes: number;
  totalBytes: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Swap</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        {totalBytes === 0 ? "none" : `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`}
      </Text>
    </View>
  );
}

function NetworkTile({
  theme,
  compact,
  rx,
  tx,
  rxHistory,
  txHistory,
}: {
  theme: PluginTheme;
  compact: boolean;
  rx: number;
  tx: number;
  rxHistory: number[];
  txHistory: number[];
}) {
  return (
    <View
      style={{
        width: compact ? "100%" : 220,
        gap: 8,
        padding: 14,
        borderRadius: 10,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>Network</Text>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>↓ down</Text>
          <Text style={{ color: TILE_COLORS.magenta, fontSize: 16, fontWeight: "800" }}>
            {formatRate(rx)}
          </Text>
          {rxHistory.length > 1 ? <Sparkline values={rxHistory} color={TILE_COLORS.magenta} height={20} /> : null}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10 }}>↑ up</Text>
          <Text style={{ color: TILE_COLORS.violet, fontSize: 16, fontWeight: "800" }}>
            {formatRate(tx)}
          </Text>
          {txHistory.length > 1 ? <Sparkline values={txHistory} color={TILE_COLORS.violet} height={20} /> : null}
        </View>
      </View>
    </View>
  );
}

function NetworkInterfaceList({
  theme,
  interfaces,
}: {
  theme: PluginTheme;
  interfaces: { name: string; address: string }[];
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>
        Network interfaces
      </Text>
      <View
        style={{
          borderRadius: 10,
          backgroundColor: theme.colors.surface1,
          padding: 12,
          gap: 4,
        }}
      >
        {interfaces.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No interfaces found.</Text>
        ) : (
          interfaces.map((iface) => (
            <View key={`${iface.name}-${iface.address}`} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, width: 90 }} numberOfLines={1}>
                {iface.name}
              </Text>
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{iface.address}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function ProcessTable({
  theme,
  processes,
}: {
  theme: PluginTheme;
  processes: { pid: number; name: string; cpuPercent: number; memPercent: number }[];
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 13 }}>
        Top processes
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
        CPU% is per core — 100% means one core fully busy, not the whole system.
      </Text>
      <View
        style={{
          borderRadius: 10,
          backgroundColor: theme.colors.surface1,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11 }}>PID</Text>
          <Text style={{ flex: 3, color: theme.colors.foregroundMuted, fontSize: 11 }}>NAME</Text>
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, textAlign: "right" }}>
            CPU%
          </Text>
          <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11, textAlign: "right" }}>
            MEM%
          </Text>
        </View>
        {processes.map((proc, index) => (
          <View
            key={proc.pid}
            style={{
              flexDirection: "row",
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 }}>{proc.pid}</Text>
            <Text style={{ flex: 3, color: theme.colors.foreground, fontSize: 12 }} numberOfLines={1}>
              {proc.name}
            </Text>
            <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 12, textAlign: "right" }}>
              {proc.cpuPercent.toFixed(1)}
            </Text>
            <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 12, textAlign: "right" }}>
              {proc.memPercent.toFixed(1)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const fetchStats = useRpc(getSystemStats);
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: layout.compact ? 16 : 20,
        backgroundColor: theme.colors.surface0,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20, fontWeight: "700" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  const { data, isError, dataUpdatedAt } = useQuery({
    queryKey: ["system-monitor", "stats"],
    queryFn: () => fetchStats({}),
    refetchInterval: 2000,
  });

  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [rxHistory, setRxHistory] = useState<number[]>([]);
  const [txHistory, setTxHistory] = useState<number[]>([]);
  useEffect(() => {
    if (!data) return;
    setCpuHistory((prev) => [...prev, data.cpuPercent].slice(-HISTORY_LENGTH));
    setRxHistory((prev) => [...prev, data.rxBytesPerSec].slice(-HISTORY_LENGTH));
    setTxHistory((prev) => [...prev, data.txBytesPerSec].slice(-HISTORY_LENGTH));
  }, [dataUpdatedAt]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>System monitor</Text>

      {isError ? (
        <Text style={{ color: theme.colors.statusDanger }}>Couldn't read host stats.</Text>
      ) : !data ? (
        <Text style={styles.hint}>Loading…</Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            <StatTile
              theme={theme}
              compact={layout.compact}
              label="CPU"
              value={`${data.cpuPercent.toFixed(0)}%`}
              percent={data.cpuPercent}
              color={TILE_COLORS.blue}
              history={cpuHistory}
            />
            <StatTile
              theme={theme}
              compact={layout.compact}
              label="Memory"
              value={formatBytes(data.memUsedBytes)}
              percent={(data.memUsedBytes / data.memTotalBytes) * 100}
              sub={`of ${formatBytes(data.memTotalBytes)}`}
              color={TILE_COLORS.orange}
              footer={
                <SwapFooter
                  theme={theme}
                  usedBytes={data.swapUsedBytes}
                  totalBytes={data.swapTotalBytes}
                />
              }
            />
            <StatTile
              theme={theme}
              compact={layout.compact}
              label={`Disk (${data.diskPath})`}
              value={formatBytes(data.diskUsedBytes)}
              percent={(data.diskUsedBytes / data.diskTotalBytes) * 100}
              sub={`of ${formatBytes(data.diskTotalBytes)}`}
              color={TILE_COLORS.aqua}
            />
            <StatTile
              theme={theme}
              compact={layout.compact}
              label="Load average"
              value={data.loadAvg1.toFixed(2)}
              percent={(data.loadAvg1 / data.cpuCount) * 100}
              color={TILE_COLORS.yellow}
              footer={
                <LoadAvgFooter
                  theme={theme}
                  fiveMin={data.loadAvg5}
                  fifteenMin={data.loadAvg15}
                  cpuCount={data.cpuCount}
                />
              }
            />
            <NetworkTile
              theme={theme}
              compact={layout.compact}
              rx={data.rxBytesPerSec}
              tx={data.txBytesPerSec}
              rxHistory={rxHistory}
              txHistory={txHistory}
            />
          </View>
          <ProcessTable theme={theme} processes={data.topProcesses} />
          <NetworkInterfaceList theme={theme} interfaces={data.networkInterfaces} />
          <Text style={styles.hint}>Refreshes every 2s.</Text>
        </>
      )}
    </View>
  );
}
