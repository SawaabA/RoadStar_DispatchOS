import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { spawnSync } from "node:child_process";

const image = "ghcr.io/project-osrm/osrm-backend:v26.9.0";
const sourceUrl = "https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf";
const checksumUrl = `${sourceUrl}.md5`;
const dataDirectory = resolve("deploy/osrm/data");
const sourceFile = resolve(dataDirectory, "ontario-latest.osm.pbf");
const markerFile = resolve(dataDirectory, ".prepared-version");
const refresh = process.argv.includes("--refresh");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let lastReported = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received - lastReported >= 100 * 1024 * 1024) {
        lastReported = received;
        const suffix = total ? ` / ${(total / 1024 / 1024).toFixed(0)} MB` : "";
        console.log(`Downloaded ${(received / 1024 / 1024).toFixed(0)} MB${suffix}`);
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(destination));
}

async function md5(file) {
  const hash = createHash("md5");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

await mkdir(dataDirectory, { recursive: true });
run("docker", ["version"]);

let expectedChecksum;
const checksumResponse = await fetch(checksumUrl, { signal: AbortSignal.timeout(30_000) });
if (!checksumResponse.ok) throw new Error(`Checksum download failed: HTTP ${checksumResponse.status}`);
expectedChecksum = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase();
if (!/^[a-f0-9]{32}$/.test(expectedChecksum)) throw new Error("Geofabrik returned an invalid MD5 checksum");

if (refresh || !existsSync(sourceFile)) {
  const temporaryFile = `${sourceFile}.download`;
  await rm(temporaryFile, { force: true });
  console.log(`Downloading Ontario OpenStreetMap data to ${sourceFile}`);
  try {
    await download(sourceUrl, temporaryFile);
    await rm(sourceFile, { force: true });
    await rename(temporaryFile, sourceFile);
  } catch (error) {
    await rm(temporaryFile, { force: true });
    throw error;
  }
}

const actualChecksum = await md5(sourceFile);
if (actualChecksum !== expectedChecksum) {
  throw new Error(`Ontario extract checksum mismatch: expected ${expectedChecksum}, received ${actualChecksum}`);
}
console.log(`Checksum verified: ${actualChecksum}`);

const marker = existsSync(markerFile) ? (await readFile(markerFile, "utf8")).trim() : "";
const expectedMarker = `${image}\n${actualChecksum}`;
if (!refresh && marker === expectedMarker) {
  console.log("The Ontario MLD graph is already prepared for this image and extract.");
  process.exit(0);
}

const dockerDataPath = dataDirectory.replaceAll("\\", "/");
const volume = `${dockerDataPath}:/data`;
const osrm = (args) => run("docker", ["run", "--rm", "-t", "-v", volume, image, ...args]);

console.log("Extracting Ontario road network with the OSRM car profile...");
osrm(["osrm-extract", "-p", "/opt/car.lua", "/data/ontario-latest.osm.pbf"]);
console.log("Partitioning the MLD graph...");
osrm(["osrm-partition", "/data/ontario-latest.osrm"]);
console.log("Customizing the MLD graph...");
osrm(["osrm-customize", "/data/ontario-latest.osrm"]);

await writeFile(markerFile, `${expectedMarker}\n`, "utf8");
console.log("Ontario OSRM data is ready. Start RoadStar with: npm run docker:osrm");
