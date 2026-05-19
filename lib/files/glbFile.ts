"use client";

import { fileOpen, fileSave, type FileWithHandle } from "browser-fs-access";

const GLB_OPTS = {
  description: "Paneler design (.glb)",
  extensions: [".glb"],
  mimeTypes: ["model/gltf-binary"],
  id: "paneler-glb",
};

export interface OpenedGlb {
  bytes: Uint8Array;
  /** Original filename (without extension is fine too). */
  name: string;
  /** Filesystem handle if the browser supports FSA — lets save() overwrite in place. */
  handle: FileSystemHandle | null;
}

/**
 * Pick a `.glb` from disk. On Chromium with FSA support returns a
 * `FileSystemFileHandle` we can reuse for in-place saves. Other browsers fall
 * back to a transient blob via `<input type="file">`.
 */
export async function openGlb(): Promise<OpenedGlb | null> {
  try {
    const file = (await fileOpen({
      ...GLB_OPTS,
      multiple: false,
    })) as FileWithHandle;
    const buf = await file.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      name: file.name,
      handle: file.handle ?? null,
    };
  } catch (err) {
    // browser-fs-access throws DOMException AbortError on cancel — treat as
    // a benign no-op so callers don't need to special-case it.
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/**
 * Save the given GLB bytes to disk. If `existingHandle` is supplied and the
 * browser supports FSA, the file is overwritten in place; otherwise the user
 * picks a destination via the OS file picker, and on legacy fallback browsers
 * a download is triggered with the suggested name.
 *
 * Returns the resulting handle (or null on legacy browsers).
 */
export async function saveGlb(
  bytes: Uint8Array,
  suggestedName: string,
  existingHandle: FileSystemHandle | null = null,
): Promise<FileSystemHandle | null> {
  const blob = new Blob([new Uint8Array(bytes)], {
    type: "model/gltf-binary",
  });
  try {
    const result = await fileSave(
      blob,
      {
        ...GLB_OPTS,
        fileName: suggestedName.endsWith(".glb")
          ? suggestedName
          : `${suggestedName}.glb`,
      },
      existingHandle as never,
    );
    return (result as FileSystemHandle | null) ?? null;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/**
 * True when the user agent ships the File System Access API. Used to gate UI
 * affordances that only work in Chromium — e.g., "Reopen recent" needs handle
 * persistence which fallback storage can't provide.
 */
export function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}
