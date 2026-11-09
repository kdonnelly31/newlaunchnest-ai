// lib/pinImageRenderer.js
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pinterest's standard 2:3 pin ratio.
export const PIN_WIDTH = 1000;
export const PIN_HEIGHT = 1500;

// resvg-wasm's WASM binary must be initialized exactly once per process --
// calling initWasm twice throws. Memoized so every renderPinImage call
// after the first process-wide call reuses the same initialization. The
// path below is a fully-literal path.join() (no variables/params in the
// path) so Vercel's file-tracing bundler (@vercel/nft) can statically find
// and ship it -- and the asset itself lives in a repo-local assets/ dir,
// not node_modules, which Vercel prunes aggressively before deploy.
let wasmInit = null;
function ensureResvgWasmInitialized() {
  if (!wasmInit) {
    const wasmPath = path.join(__dirname, '..', 'assets', 'wasm', 'resvg.wasm');
    wasmInit = initWasm(fs.readFileSync(wasmPath)).catch((err) => {
      // Don't cache a rejected promise -- that would poison this warm
      // serverless container for the rest of its lifetime after a single
      // transient init failure.
      wasmInit = null;
      throw err;
    });
  }
  return wasmInit;
}

// Satori needs fonts as real file bytes -- it cannot load a system font or
// a webfont URL (design doc §16 item 8). @fontsource ships real,
// installable .woff files, which Satori supports directly -- verified
// against the installed @fontsource/inter package before choosing this
// approach. Copied into a repo-local assets/ dir (see note above) and read
// via fully-literal path.join() calls so @vercel/nft can trace them.
const FONT_FILES = {
  inter: () => fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'inter-700.woff')),
  fraunces: () => fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'fraunces-700.woff')),
};

// Visual styles that put the headline directly over the photo with a
// gradient scrim (buildOverlayLayout), vs. styles that fall through to the
// photo-plus-solid-color-panel layout (buildMinimalLayout). Matches the
// Brand Kit's "visual_style" options from the design doc §7 wireframe, but
// note it's a 2-vs-2 grouping, not 4 distinct renders: "typography_forward"
// currently renders identically to "minimal" (both use buildMinimalLayout);
// only "lifestyle" and "photo_first" get the overlay treatment.
const OVERLAY_STYLES = new Set(['lifestyle', 'photo_first']);

function buildMinimalLayout({ photoUrl, headline, primaryColor, accentColor, fontKey }) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column',
        width: `${PIN_WIDTH}px`, height: `${PIN_HEIGHT}px`,
        backgroundColor: '#ffffff',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', width: '100%', height: '1050px',
              backgroundImage: `url(${photoUrl})`,
              backgroundSize: 'cover', backgroundPosition: 'center',
            },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', flex: 1, alignItems: 'center',
              padding: '0 48px', backgroundColor: primaryColor,
            },
            children: [{
              type: 'div',
              props: {
                style: { fontFamily: fontKey, fontSize: 52, fontWeight: 700, color: '#ffffff', lineHeight: 1.15 },
                children: headline,
              },
            }],
          },
        },
        {
          type: 'div',
          props: { style: { display: 'flex', width: '100%', height: '10px', backgroundColor: accentColor } },
        },
      ],
    },
  };
}

function buildOverlayLayout({ photoUrl, headline, fontKey }) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        width: `${PIN_WIDTH}px`, height: `${PIN_HEIGHT}px`,
        backgroundImage: `url(${photoUrl})`,
        backgroundSize: 'cover', backgroundPosition: 'center',
      },
      children: [{
        type: 'div',
        props: {
          style: {
            display: 'flex', width: '100%', padding: '56px 48px',
            backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))',
          },
          children: [{
            type: 'div',
            props: {
              style: { fontFamily: fontKey, fontSize: 56, fontWeight: 700, color: '#ffffff', lineHeight: 1.15 },
              children: headline,
            },
          }],
        },
      }],
    },
  };
}

export async function renderPinImage({ photoUrl, headline, brandKit }) {
  if (!photoUrl) throw new Error('renderPinImage requires a photoUrl.');
  if (!headline) throw new Error('renderPinImage requires a headline.');

  const {
    primaryColor = '#2E4636',
    accentColor = '#C97B3D',
    headlineFont = 'inter',
    visualStyle = 'minimal',
  } = brandKit || {};

  const fontKey = FONT_FILES[headlineFont] ? headlineFont : 'inter';
  const tree = OVERLAY_STYLES.has(visualStyle)
    ? buildOverlayLayout({ photoUrl, headline, fontKey })
    : buildMinimalLayout({ photoUrl, headline, primaryColor, accentColor, fontKey });

  await ensureResvgWasmInitialized();

  const svg = await satori(tree, {
    width: PIN_WIDTH,
    height: PIN_HEIGHT,
    fonts: [{ name: fontKey, data: FONT_FILES[fontKey](), weight: 700, style: 'normal' }],
  });

  const resvg = new Resvg(svg);
  const pngBytes = resvg.render().asPng();
  return Buffer.from(pngBytes);
}
