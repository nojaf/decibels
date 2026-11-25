/**
 * Builds the app icons from the Loudred sprite (Pokedex #294).
 *
 * Both inputs in src/icons/ come from ~/Projects/favicon-maker:
 *
 *   bun run src/main.ts 294 -o <decibels>/src/icons
 *   bun run src/main.ts 294 --png -w 58 --height 61 -o <decibels>/src/icons
 *
 * The first writes favicon.ico. The second writes the sprite cropped and at
 * its native size (rename 294.png to loudred.png). The larger icons are made
 * here instead of by the tool, because pixel art has to be scaled up by a
 * whole factor with nearest-neighbour or it turns to mush.
 *
 * Run with `bun run icons`, and commit the results: the build copies
 * src/icons/ as it is.
 */
import sharp, { type Metadata } from "sharp";

/** `--bg` in src/style.css. */
const BG = "#120f1a";
const DIR: string = new URL("../src/icons/", import.meta.url).pathname;
const SPRITE: string = `${DIR}loudred.png`;

type Icon = {
  name: string;
  size: number;
  /** Largest share of the icon's side the sprite may cover. */
  fill: number;
  /** Rounded corners for the "any" icons; iOS and maskable icons get cropped by the OS. */
  rounded: boolean;
};

const ICONS: Array<Icon> = [
  { name: "pwa-192.png", size: 192, fill: 0.8, rounded: true },
  { name: "pwa-512.png", size: 512, fill: 0.8, rounded: true },
  { name: "icon-180.png", size: 180, fill: 0.72, rounded: false },
  // Maskable icons must keep the subject inside the middle 80% circle;
  // checked below, since whether it fits depends on the sprite's shape.
  { name: "maskable-512.png", size: 512, fill: 0.6, rounded: false },
];

const meta: Metadata = await sharp(SPRITE).metadata();
const spriteW: number = meta.width;
const spriteH: number = meta.height;

for (const icon of ICONS) {
  const scale: number = Math.max(
    1,
    Math.floor((icon.size * icon.fill) / Math.max(spriteW, spriteH)),
  );
  // Sequential on purpose: the log is only readable in the order listed.
  // oxlint-disable-next-line no-await-in-loop
  const sprite: Buffer = await sharp(SPRITE)
    .resize(spriteW * scale, spriteH * scale, { kernel: "nearest" })
    .png()
    .toBuffer();
  const radius: number = icon.rounded ? Math.round(icon.size * 0.22) : 0;
  const background: Buffer = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}">
      <rect width="${icon.size}" height="${icon.size}" rx="${radius}" fill="${BG}"/>
    </svg>`,
  );
  // oxlint-disable-next-line no-await-in-loop
  await sharp(background)
    .composite([
      {
        input: sprite,
        left: Math.round((icon.size - spriteW * scale) / 2),
        top: Math.round((icon.size - spriteH * scale) / 2),
      },
    ])
    .png()
    .toFile(`${DIR}${icon.name}`);
  console.log(`wrote src/icons/${icon.name} (sprite at ${scale}x)`);
}

// Android crops maskable icons to any shape that contains the central circle
// of radius 40%. Fail loudly if a sprite pixel falls outside it.
const maskable: { data: Buffer; info: { width: number; height: number } } = await sharp(
  `${DIR}maskable-512.png`,
)
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = maskable.info;
const channels: number = maskable.data.length / (width * height);
const [r, g, b] = [0x12, 0x0f, 0x1a];
let farthest = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i: number = (y * width + x) * channels;
    const isBg: boolean =
      maskable.data[i] === r && maskable.data[i + 1] === g && maskable.data[i + 2] === b;
    if (!isBg) farthest = Math.max(farthest, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
  }
}
if (farthest > 0.4 * width) {
  throw new Error(
    `maskable-512.png: sprite reaches ${farthest.toFixed(1)}px from the centre, over the ${0.4 * width}px safe zone`,
  );
}
console.log(`maskable safe zone ok (${farthest.toFixed(1)} of ${0.4 * width}px)`);
