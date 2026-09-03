import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import { getSystemStats } from "./stats.shared";
import { handleGetSystemStats } from "./stats.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getSystemStats, handleGetSystemStats);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "System monitor",
    icon: "Gauge",
    surface: "main",
  });
  return () => {};
}
