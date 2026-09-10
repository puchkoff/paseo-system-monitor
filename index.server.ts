import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleGetSystemStats } from "./server/stats";
import { getSystemStats } from "./shared/stats";

export default function contribute(server: PluginServerContext) {
  server.handle(getSystemStats, handleGetSystemStats);
  return () => {};
}
