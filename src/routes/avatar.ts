import { Request, Response, Router } from "express";
import crypto from "crypto";

const router = Router();

// Bitcoin/Polkadot Base58 alphabet (no 0, O, I, l)
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

// --- Tiny deterministic PRNG (xorshift32) seeded by sha256(pubKey) ---
function seedFromSha256(input: string): number {
  const hash = crypto.createHash("sha256").update(input).digest();
  // Take first 4 bytes as unsigned 32-bit seed; avoid zero
  let seed =
    (hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | (hash[3] << 0);
  seed >>>= 0;
  if (seed === 0) seed = 0x9e3779b9; // golden ratio constant as fallback
  return seed >>> 0;
}

function createRng(seed: number) {
  let s = seed >>> 0;
  const rng = () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    // Convert to [0,1)
    return ((s >>> 0) / 0xffffffff) % 1;
  };
  const int = (min: number, max: number) =>
    Math.floor(rng() * (max - min + 1)) + min;
  const pick = <T,>(arr: T[]) => arr[int(0, arr.length - 1)];
  return { rng, int, pick };
}

// --- Color helpers ---
function hslToHex(h: number, s: number, l: number): string {
  // h in [0,360), s & l in [0,100]
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Build a harmonious palette from seed: analogous/triadic-ish
function buildPalette(seed: number) {
  const { rng, int } = createRng(seed);
  const baseHue = int(0, 359);
  const scheme = int(0, 2); // 0 analogous, 1 triadic, 2 split-complementary
  const s = clamp(40 + int(0, 40), 40, 80);
  const l = clamp(40 + int(0, 20), 35, 65);

  const hueOffsets =
    scheme === 0
      ? [0, int(10, 25), -int(10, 25)]
      : scheme === 1
      ? [0, 120, 240]
      : [0, 150 + int(0, 20), -150 - int(0, 20)];

  const stopsCount = 3 + int(0, 2); // 3–5 stops
  const hues = Array.from({ length: stopsCount }, (_, i) => {
    const off = hueOffsets[i % hueOffsets.length];
    return (baseHue + off + 360) % 360;
  });

  // Lightness tweaks per stop for contrast
  const colors = hues.map((h, i) => {
    const li = clamp(l + (i - 1) * int(4, 10), 35, 70);
    const si = clamp(s + int(-10, 10), 30, 85);
    return hslToHex(h, si, li);
  });

  return { baseHue, colors };
}

// --- SVG generation ---
function svgForKey(pubkey: string, size = 256): string {
  const seed = seedFromSha256(pubkey);
  const { rng, int } = createRng(seed);

  const idPrefix = crypto
    .createHash("sha1")
    .update(pubkey)
    .digest("hex")
    .slice(0, 8);

  const { colors } = buildPalette(seed);

  // Gradient angle, blob count, corner radius
  const angle = int(0, 359);
  const blobCount = 2 + int(0, 3); // 2–5 blobs
  const radius = 32 + int(0, 32);

  // Build gradient stops at random offsets but sorted
  const offsets = Array.from({ length: colors.length }, () => rng())
    .sort((a, b) => a - b)
    .map((o, i, arr) =>
      // Ensure 0% and 100% are covered
      i === 0 ? 0 : i === arr.length - 1 ? 1 : clamp(o, 0.05, 0.95)
    );

  const linearStops = colors
    .map((c, i) => {
      const op = (0.9 + rng() * 0.1).toFixed(2); // 0.90–1.00
      const off = Math.round(offsets[i] * 100);
      return `<stop offset="${off}%" stop-color="${c}" stop-opacity="${op}"/>`;
    })
    .join("");

  // Radial gradients for blobs derive from shuffled colors
  const blobGradients = Array.from({ length: blobCount }, (_, i) => {
    const ci = colors[(i + int(0, colors.length - 1)) % colors.length];
    const cj = colors[(i + 1 + int(0, colors.length - 1)) % colors.length];
    const gid = `rg-${idPrefix}-${i}`;
    const rStop = 40 + int(0, 40); // 40–80%
    const innerOp = (0.35 + rng() * 0.2).toFixed(2);
    const outerOp = (0.0 + rng() * 0.05).toFixed(2);
    return {
      gid,
      def: `<radialGradient id="${gid}" cx="${(30 + int(0, 40)) / 100}" cy="${
        (30 + int(0, 40)) / 100
      }" r="${(60 + int(0, 30)) / 100}">
        <stop offset="0%" stop-color="${ci}" stop-opacity="${innerOp}"/>
        <stop offset="${rStop}%" stop-color="${cj}" stop-opacity="${outerOp}"/>
      </radialGradient>`,
    };
  });

  // Blob positions & sizes
  const blobs = blobGradients.map((g) => {
    const cx = int(20, 80);
    const cy = int(20, 80);
    const r = int(25, 48);
    return `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="url(#${g.gid})" />`;
  });

  // Subtle grain texture
  const noiseScale = (0.6 + rng() * 0.8).toFixed(2);
  const noiseOctaves = int(2, 4);

  // Mask/clipPath for rounded avatar
  const clipId = `clip-${idPrefix}`;
  const lgId = `lg-${idPrefix}`;
  const filterId = `grain-${idPrefix}`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar for ${escapeXml(
    pubkey
  )}">
  <defs>
    <linearGradient id="${lgId}" gradientTransform="rotate(${angle})">
      ${linearStops}
    </linearGradient>

    ${blobGradients.map((g) => g.def).join("\n")}

    <filter id="${filterId}">
      <feTurbulence type="fractalNoise" baseFrequency="${noiseScale}" numOctaves="${noiseOctaves}" stitchTiles="stitch" />
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0 0.04 0.08"/>
      </feComponentTransfer>
      <feBlend mode="multiply"/>
    </filter>

    <clipPath id="${clipId}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" />
    </clipPath>
  </defs>

  <g clip-path="url(#${clipId})">
    <rect width="100%" height="100%" fill="url(#${lgId})"/>
    ${blobs.join("\n")}
    <rect width="100%" height="100%" filter="url(#${filterId})" opacity="0.25"/>
  </g>
</svg>`;

  return svg;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Express route ---
// GET /avatars/:pubkey.svg
router.get("/avatars/:pubkey.svg", (req: Request, res: Response) => {
  const { pubkey } = req.params;

  if (!pubkey || !BASE58_RE.test(pubkey)) {
    return res
      .status(400)
      .json({ error: "Invalid Base58 public key (SS58-style expected)." });
  }

  // Deterministic SVG
  const svg = svgForKey(pubkey, 256);

  // Caching: strong etag; cache for a year since deterministic
  const etag = crypto.createHash("sha1").update(svg).digest("hex");
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  // Conditional GET
  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  return res.status(200).send(svg);
});

export default router;
