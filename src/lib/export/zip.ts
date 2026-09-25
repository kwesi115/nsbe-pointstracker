/**
 * A zip that is produced as it is sent, never assembled first.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * The bulk resume bundle (resume-bundle.ts) is the only caller. Forty resumes
 * would fit in memory comfortably; two hundred would not, and a Vercel
 * function that allocates the whole archive before writing a byte hits its
 * memory ceiling at exactly the roster size where this feature stops being a
 * nice-to-have. So the archive is a `ReadableStream<Uint8Array>` that pulls one
 * source file at a time, and peak memory is one file plus whatever the client
 * has not drained yet — not the sum of the bundle.
 *
 * STORED, NOT DEFLATED
 * --------------------
 * Every entry is written with no compression (fflate's `ZipPassThrough`). The
 * payload is PDFs and .docx files, both of which are already-compressed
 * containers: deflating them again buys a percent or two and costs CPU time on
 * a function billed by the millisecond. It also keeps each entry a pure
 * pass-through, so a 2MB resume never sits in a compressor's window.
 *
 * BACKPRESSURE IS REAL HERE
 * -------------------------
 * `start()` kicks off the producer and returns; `pull()` wakes it. Between
 * pushes the producer parks whenever `desiredSize` has gone non-positive, so a
 * slow client throttles the blob reads behind it instead of letting the
 * stream's internal queue grow into the thing this file exists to avoid. A
 * `ByteLengthQueuingStrategy` is what makes `desiredSize` count bytes rather
 * than chunks, which is the only measure that means anything for file bytes.
 */

import { Zip, ZipPassThrough } from "fflate";

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; the caller owns sanitizing it. */
  name: string;
  /**
   * The bytes, resolved lazily — the producer does not call this until the
   * previous entry is fully written, which is what keeps one file in memory
   * rather than all of them.
   *
   * Sync iterables are allowed so a small in-memory entry (the manifest) does
   * not need a generator wrapper to say "here is one chunk"; `for await`
   * consumes either.
   */
  open: () => Promise<AsyncIterable<Uint8Array> | Iterable<Uint8Array>>;
}

/** Roughly one file's worth of slack before the producer parks. */
const DEFAULT_HIGH_WATER_MARK = 1024 * 1024;

const EMPTY = new Uint8Array(0);

/**
 * `entries` is a function returning an async iterable rather than an iterable
 * itself so nothing is enumerated until the stream is actually pulled — a
 * response that is never read must not run a single query.
 */
export function createZipStream(
  entries: () => AsyncIterable<ZipEntry>,
  options: { highWaterMark?: number } = {},
): ReadableStream<Uint8Array> {
  let wake: (() => void) | null = null;
  let canceled = false;

  const resume = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        // fflate reports a write failure through this callback rather than by
        // throwing out of push(), so it is stashed and re-thrown from the
        // producer loop, where there is a try/catch that can error the stream.
        let zipError: unknown = null;

        const zip = new Zip((err, chunk, final) => {
          if (err) {
            zipError = err;
            return;
          }
          if (canceled) return;
          if (chunk.byteLength > 0) controller.enqueue(chunk);
          if (final) controller.close();
        });

        const parkIfFull = async () => {
          if (canceled) return;
          const desired = controller.desiredSize;
          if (desired !== null && desired <= 0) {
            await new Promise<void>((r) => {
              wake = r;
            });
          }
        };

        const produce = async () => {
          try {
            for await (const entry of entries()) {
              if (canceled) return;
              const source = await entry.open();
              const file = new ZipPassThrough(entry.name);
              zip.add(file);
              for await (const chunk of source) {
                if (canceled) return;
                if (zipError) throw zipError;
                file.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), false);
                await parkIfFull();
              }
              // A zip entry is only closed by a final push — an empty one for a
              // source that ended exactly on a chunk boundary, which is the
              // common case.
              file.push(EMPTY, true);
              if (zipError) throw zipError;
              await parkIfFull();
            }
            if (canceled) return;
            // Writes the central directory, then fires the callback above with
            // final=true, which is what closes the stream.
            zip.end();
            if (zipError) throw zipError;
          } catch (err) {
            if (!canceled) controller.error(err);
          }
        };

        void produce();
      },
      pull() {
        resume();
      },
      cancel() {
        // The browser navigated away or the client hung up. Stop reading blobs;
        // the producer loop checks this between every chunk.
        canceled = true;
        resume();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK }),
  );
}
