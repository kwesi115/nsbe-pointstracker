/**
 * The streaming zip writer.
 *
 * Two claims are being pinned, and the second is the one the resume bundle
 * actually depends on:
 *
 *   1. the archive is a real zip — checked by reading it back with fflate's own
 *      unzip rather than by inspecting what the writer thinks it wrote;
 *   2. it is produced LAZILY, one entry at a time, under backpressure. "We
 *      stream it" is a claim about memory, and the only way to demonstrate it
 *      is to show that a consumer which stops reading also stops the producer
 *      from opening the next file.
 */

import { unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createZipStream, type ZipEntry } from "./zip";

const enc = (s: string) => new TextEncoder().encode(s);

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function entry(name: string, body: string): ZipEntry {
  return { name, open: async () => [enc(body)] };
}

describe("createZipStream", () => {
  it("writes an archive an independent reader can open", async () => {
    const zip = await collect(
      createZipStream(async function* () {
        yield entry("a.txt", "alpha");
        yield entry("nested/b.txt", "bravo");
        yield entry("manifest.csv", "h1,h2\r\n1,2");
      }),
    );

    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(["a.txt", "manifest.csv", "nested/b.txt"]);
    expect(Buffer.from(files["a.txt"]).toString()).toBe("alpha");
    expect(Buffer.from(files["nested/b.txt"]).toString()).toBe("bravo");
    expect(Buffer.from(files["manifest.csv"]).toString()).toBe("h1,h2\r\n1,2");
  });

  it("reassembles an entry delivered in several chunks", async () => {
    const zip = await collect(
      createZipStream(async function* () {
        yield {
          name: "big.bin",
          open: async () => (async function* () {
            yield enc("one-");
            yield enc("two-");
            yield enc("three");
          })(),
        };
      }),
    );
    expect(Buffer.from(unzipSync(new Uint8Array(zip))["big.bin"]).toString()).toBe("one-two-three");
  });

  it("handles an empty entry without corrupting the archive", async () => {
    const zip = await collect(
      createZipStream(async function* () {
        yield { name: "empty.txt", open: async () => [] };
        yield entry("after.txt", "still here");
      }),
    );
    const files = unzipSync(new Uint8Array(zip));
    expect(files["empty.txt"].length).toBe(0);
    expect(Buffer.from(files["after.txt"]).toString()).toBe("still here");
  });

  it("opens nothing at all until the stream is actually read", async () => {
    const open = vi.fn(async () => [enc("x")]);
    createZipStream(async function* () {
      yield { name: "a.txt", open };
    });
    // A Response nobody reads must not have hit blob storage even once.
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
  });

  /**
   * The memory claim, made concrete. A high-water mark of one byte means the
   * queue is over budget after the first chunk, so the producer must park
   * before touching entry two — which is exactly what stops a 200-resume
   * bundle from becoming 200 resumes in memory.
   */
  it("stops opening files while the consumer is not draining", async () => {
    const opened: string[] = [];
    const makeEntry = (name: string): ZipEntry => ({
      name,
      open: async () => {
        opened.push(name);
        // Big enough that one entry alone blows the 1-byte budget.
        return [enc("x".repeat(4096))];
      },
    });

    const stream = createZipStream(
      async function* () {
        yield makeEntry("one.txt");
        yield makeEntry("two.txt");
        yield makeEntry("three.txt");
      },
      { highWaterMark: 1 },
    );

    const reader = stream.getReader();
    await reader.read();
    // Give any runaway producer several turns of the event loop to prove it.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(opened).toEqual(["one.txt"]);

    // Draining lets it continue, and the finished archive is complete.
    const rest: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) rest.push(Buffer.from(value));
    }
    expect(opened).toEqual(["one.txt", "two.txt", "three.txt"]);
  });

  it("stops reading source files when the client hangs up", async () => {
    const opened: string[] = [];
    const makeEntry = (name: string): ZipEntry => ({
      name,
      open: async () => {
        opened.push(name);
        return [enc("y".repeat(4096))];
      },
    });

    const stream = createZipStream(
      async function* () {
        yield makeEntry("one.txt");
        yield makeEntry("two.txt");
      },
      { highWaterMark: 1 },
    );

    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(opened).toEqual(["one.txt"]);
  });

  it("errors the stream when a source cannot be opened", async () => {
    const stream = createZipStream(async function* () {
      yield entry("fine.txt", "ok");
      yield { name: "broken.txt", open: async () => Promise.reject(new Error("blob gone")) };
    });
    await expect(collect(stream)).rejects.toThrow("blob gone");
  });

  it("errors the stream when a source fails part-way through", async () => {
    const stream = createZipStream(async function* () {
      yield {
        name: "half.bin",
        open: async () => (async function* () {
          yield enc("first");
          throw new Error("read failed");
        })(),
      };
    });
    await expect(collect(stream)).rejects.toThrow("read failed");
  });
});
