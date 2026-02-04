import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    iterations: 20,
    startSeed: 1,
    outDir: path.resolve(root, "screenshots"),
    size: "128x128",
    threshold: 200,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--iterations") out.iterations = Number(args[++i] ?? out.iterations);
    else if (a === "--start-seed") out.startSeed = Number(args[++i] ?? out.startSeed);
    else if (a === "--out") out.outDir = path.resolve(root, args[++i] ?? "screenshots");
    else if (a === "--size") out.size = String(args[++i] ?? out.size);
    else if (a === "--threshold") out.threshold = Number(args[++i] ?? out.threshold);
  }
  return out;
}

function serveStatic(rootDir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let filePath = path.join(rootDir, url.pathname);
    if (url.pathname === "/") filePath = path.join(rootDir, "index.html");
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".html"
        ? "text/html"
        : ext === ".js"
          ? "text/javascript"
          : ext === ".css"
            ? "text/css"
            : ext === ".png"
              ? "image/png"
              : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function main() {
  const opts = parseArgs();
  fs.mkdirSync(opts.outDir, { recursive: true });

  const { server, port } = await serveStatic(root);
  const baseUrl = `http://127.0.0.1:${port}/index.html`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForTimeout(500);
  try {
    await page.waitForFunction(() => !!window.app, { timeout: 20000 });
  } catch (err) {
    const details = errors.length ? `\n${errors.join("\n")}` : "";
    throw new Error(`window.app not found${details}`);
  }

  const results = [];

  for (let i = 0; i < opts.iterations; i++) {
    const seed = String(opts.startSeed + i);
    const data = await page.evaluate(
      ({ seed, size, threshold }) => {
        const app = window.app;
        if (!app) throw new Error("window.app not found");

        const seedEl = document.getElementById("seed");
        const sizeEl = document.getElementById("size");
        if (seedEl) seedEl.value = seed;
        if (sizeEl) sizeEl.value = size;

        app.generate();
        let guard = 0;
        while (app.sim && !app.sim.done && guard++ < 5000) app.sim.step(1);
        app.redraw();

        const grid = app.sim.grid;
        const dist = app.sim._distToObs;
        const w = grid.w;
        const h = grid.h;
        const avoid = app.cfg.growth.localWaterAvoidDist ?? 0;
        let nearWater = 0;
        let roadCells = 0;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!grid.isRoad(x, y)) continue;
            roadCells++;
            const d = dist[y * w + x];
            if (avoid > 0 && d !== -1 && d <= avoid) nearWater++;
          }
        }
        const bad = nearWater > threshold;
        return { seed, nearWater, roadCells, bad };
      },
      { seed, size: opts.size, threshold: opts.threshold }
    );

    const canvas = page.locator("#view");
    const filePath = path.join(opts.outDir, `seed-${seed}.png`);
    await canvas.screenshot({ path: filePath });
    results.push(data);
  }

  await browser.close();
  server.close();

  const summaryPath = path.join(opts.outDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved ${results.length} screenshots to ${opts.outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
