/**
 * Template downloads shared between a hover over a gallery card (started
 * early) and picking it (reused, so the pick doesn't wait on the network).
 * Keeps the last few; each caller gets its own copy of the bytes, since
 * loaders may take ownership of a buffer.
 */
const KEEP = 4;
const downloads = new Map<string, Promise<Uint8Array>>();

export function fetchGlbBytes(url: string): Promise<Uint8Array> {
  let download = downloads.get(url);
  if (download) {
    // Most recently used moves to the back of the queue.
    downloads.delete(url);
  } else {
    download = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => new Uint8Array(buf));
    // A failed download isn't kept: the next try starts afresh.
    download.catch(() => downloads.delete(url));
  }
  downloads.set(url, download);
  while (downloads.size > KEEP) downloads.delete(downloads.keys().next().value!);
  return download.then((bytes) => bytes.slice());
}

/** Start downloading a template now, ignoring failure (the pick retries). */
export function prefetchGlb(url: string): void {
  fetchGlbBytes(url).catch(() => {});
}
