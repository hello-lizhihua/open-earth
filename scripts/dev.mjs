#!/usr/bin/env node
// 多开发服务并存：从 1420 起找第一个空闲端口，交给 beforeDevCommand 的 vite，
// 并以 --config 覆盖 tauri devUrl 指向同一端口。
// 用法：node scripts/dev.mjs（即 pnpm tauri:dev）

import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const BASE_PORT = 1420;

function isFree(port) {
  // vite 绑 localhost 可能落 IPv4 或 IPv6，两个栈都空闲才算空闲
  const probe = (host) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, host);
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then(([a, b]) => a && b);
}

async function pickPort() {
  for (let port = BASE_PORT; port < BASE_PORT + 20; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error(`1420-${BASE_PORT + 19} 均被占用`);
}

const port = await pickPort();
console.log(`[dev] 端口 ${port}（空闲顺延）`);

const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });
const child = spawn("pnpm", ["tauri", "dev", "--config", config], {
  stdio: "inherit",
  env: { ...process.env, OPEN_EARTH_PORT: String(port) },
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 0));
