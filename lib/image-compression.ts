"use client";

/**
 * Client-side image compression, so a phone photo does not eat the storage quota.
 *
 * This matters more than it looks: a modern phone photo is 3-8 MB, Supabase Free
 * includes 1 GB, and proof photos accumulate daily. Downscaling to a 1280px long edge
 * and re-encoding as JPEG typically lands between 100 and 300 KB, which is what makes
 * the free tier last years instead of months.
 *
 * Everything here runs in the browser using canvas. If any step fails, the caller
 * falls back to uploading the original file, so a compression bug degrades bandwidth
 * rather than breaking the feature.
 */

/** Longest edge of the stored image. Enough to see a tidy room, small enough to send. */
const MAX_EDGE = 1280;

/** JPEG quality. 0.75 is a good balance for photos of rooms and homework. */
const QUALITY = 0.75;

/** Formats we accept from the picker. */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Hard ceiling for the original file, before compression. */
export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;

export interface CompressResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  /** True when the original was sent unchanged because compression was not possible. */
  usedOriginal: boolean;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("ENCODE_FAILED"))),
      "image/jpeg",
      QUALITY
    );
  });
}

/**
 * Downscales and re-encodes an image.
 *
 * Returns the original file when the input is already small, is not a decodable
 * image, or when the browser cannot encode it. Never throws for those cases: the
 * upload should still work.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const originalBytes = file.size;

  // Small enough already, or the orientation/format work is not worth it.
  if (originalBytes <= 400 * 1024) {
    return { file, originalBytes, compressedBytes: originalBytes, usedOriginal: true };
  }

  try {
    const image = await loadImage(file);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);

    // Never upscale: shrinking a small image would only lose detail.
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    // A white background prevents transparent PNGs turning black in JPEG.
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("NO_CANVAS_CONTEXT");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas);
    const compressed = new File([blob], "proof.jpg", { type: "image/jpeg" });

    // If encoding somehow produced something larger, keep the original.
    if (compressed.size >= originalBytes) {
      return {
        file,
        originalBytes,
        compressedBytes: originalBytes,
        usedOriginal: true,
      };
    }

    return {
      file: compressed,
      originalBytes,
      compressedBytes: compressed.size,
      usedOriginal: false,
    };
  } catch {
    return { file, originalBytes, compressedBytes: originalBytes, usedOriginal: true };
  }
}

/** Human-readable size, for showing the user what will be uploaded. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
