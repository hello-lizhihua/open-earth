#!/usr/bin/env node
// tauri dev 的 beforeDevCommand：在指定端口启动 vite（tauri:dev 场景由 dev.mjs
// 顺延端口并经 OPEN_EARTH_PORT 传入；单独 pnpm tauri dev 默认 1420）。

import { spawn } from "node:child_process";
import process from "node:process";

const port = Number(process.env.OPEN_EARTH_PORT) || 1420;
const vite = spawn(
  process.platform === "win32" ? "node_modules/.bin/vite.cmd" : "node_modules/.bin/vite",
  ["--port", String(port), "--strictPort"],
  { stdio: "inherit", shell: process.platform === "win32" },
);
vite.on("exit", (code) => process.exit(code ?? 0));
