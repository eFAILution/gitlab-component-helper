// Captures the workbench with CDP screencast frames, then encodes them to a GIF with ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEVICE_SCALE, FRAMES_DIR, GIF, OUT_DIR, VIEWPORT } from './config.mjs';
import { sleep } from './vscode.mjs';

const JPEG_QUALITY = 95;
const SHEET_COLUMNS = 6;
const SHEET_TILE_WIDTH = 400;

export class Recorder {
  constructor(cdp, name) {
    this.cdp = cdp;
    this.name = name;
    this.dir = path.join(FRAMES_DIR, name);
    this.frames = [];
    this.onFrame = (event) => this.saveFrame(event);
  }

  async saveFrame({ data, metadata, sessionId }) {
    const file = path.join(this.dir, `${String(this.frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    this.frames.push({ file, time: metadata.timestamp });
    await this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp.on('Page.screencastFrame', this.onFrame);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: JPEG_QUALITY,
      maxWidth: VIEWPORT.width * DEVICE_SCALE, maxHeight: VIEWPORT.height * DEVICE_SCALE,
    });
  }

  /** Stop and write an ffmpeg concat list. Frames only arrive on change, so each frame lasts until the next one. */
  async stop(holdSeconds = 2) {
    await this.cdp.send('Page.stopScreencast');
    this.cdp.off('Page.screencastFrame', this.onFrame);
    await sleep(300);
    const entries = this.frames.map((frame, i) => {
      const next = this.frames[i + 1]?.time ?? frame.time + holdSeconds;
      return `file '${frame.file}'\nduration ${Math.max(0.01, next - frame.time).toFixed(3)}`;
    });
    // The concat demuxer ignores the last duration unless the final file is listed again.
    fs.writeFileSync(path.join(this.dir, 'concat.txt'), [...entries, `file '${this.frames.at(-1).file}'`].join('\n') + '\n');
    return this.frames.at(-1).time + holdSeconds - this.frames[0].time;
  }
}

export function encodeGif(name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = path.join(OUT_DIR, `${name}.gif`);
  const filters = `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];`
    + `[a]palettegen=max_colors=${GIF.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', path.join(FRAMES_DIR, name, 'concat.txt'), '-vf', filters, '-loop', '0', output]);
  return output;
}

/** One frame per second, tiled, so a person can check every moment for private details before publishing. */
export function writeReviewSheet(name, durationSeconds) {
  const rows = Math.ceil(durationSeconds / SHEET_COLUMNS);
  const output = path.join(OUT_DIR, `${name}-review.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(OUT_DIR, `${name}.gif`),
    '-vf', `fps=1,scale=${SHEET_TILE_WIDTH}:-1,tile=${SHEET_COLUMNS}x${rows}:padding=4:color=white`,
    '-frames:v', '1', output]);
  return output;
}
