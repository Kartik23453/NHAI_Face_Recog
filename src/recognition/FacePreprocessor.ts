/**
 * @file FacePreprocessor.ts
 * @description Face image preprocessing pipeline for GhostFaceNet TFLite input.
 *
 * GhostFaceNet expects a single 112×112 RGB image with pixel values in [-1, 1]:
 *   tensor = (pixel_rgb / 127.5) - 1.0
 *
 * This module handles three responsibilities:
 *   1. Resizing a face crop to 112×112 using bilinear interpolation.
 *   2. Normalising pixel values from [0, 255] to [-1.0, 1.0].
 *   3. Packing the result into a Float32Array in HWC order for TFLite.
 *
 * Input source:
 *   The face crop is provided as raw RGBA pixel data (Uint8ClampedArray)
 *   from react-native-vision-camera's snapshot API or a frame pixel buffer.
 *   Alpha channel is discarded; only RGB is used.
 *
 * Architecture (mobile-developer skill):
 *   Pure functions — no React, no native modules, no side effects.
 *   Platform-agnostic: runs on both Android and iOS JS threads.
 *   Designed to be called once per recognition event, NOT per frame.
 */

import { MODEL_INPUT, type PreprocessedFace } from './RecognitionTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Raw image data container — mirrors the shape of data from
 * react-native-vision-camera's `frame.toArrayBuffer()` or a Canvas ImageData.
 */
export interface RawImageData {
  /** Raw pixel bytes in RGBA order, one byte per channel, row-major */
  data: Uint8ClampedArray | Uint8Array;
  /** Original image width in pixels */
  width: number;
  /** Original image height in pixels */
  height: number;
}

// ---------------------------------------------------------------------------
// Bilinear Resize
// ---------------------------------------------------------------------------

/**
 * Resizes an RGBA image to targetW × targetH using bilinear interpolation.
 *
 * Bilinear interpolation is preferred over nearest-neighbour for face
 * recognition because it produces smoother pixel transitions when upsampling,
 * reducing the risk of aliasing artifacts affecting model accuracy.
 *
 * @param src     - Source RGBA pixel data
 * @param srcW    - Source image width
 * @param srcH    - Source image height
 * @param targetW - Desired output width (112 for GhostFaceNet)
 * @param targetH - Desired output height (112 for GhostFaceNet)
 * @returns         Resized RGBA Uint8Array of length targetW × targetH × 4
 */
export function bilinearResize(
  src: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): Uint8Array {
  const output = new Uint8Array(targetW * targetH * 4);
  const xScale = srcW / targetW;
  const yScale = srcH / targetH;

  for (let dstY = 0; dstY < targetH; dstY++) {
    for (let dstX = 0; dstX < targetW; dstX++) {
      // Map destination pixel to source space
      const srcXFloat = (dstX + 0.5) * xScale - 0.5;
      const srcYFloat = (dstY + 0.5) * yScale - 0.5;

      const x0 = Math.max(0, Math.floor(srcXFloat));
      const y0 = Math.max(0, Math.floor(srcYFloat));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);

      const xFrac = srcXFloat - x0;
      const yFrac = srcYFloat - y0;

      // Four neighbouring pixel offsets (RGBA = 4 bytes per pixel)
      const idx00 = (y0 * srcW + x0) * 4;
      const idx10 = (y0 * srcW + x1) * 4;
      const idx01 = (y1 * srcW + x0) * 4;
      const idx11 = (y1 * srcW + x1) * 4;

      const dstIdx = (dstY * targetW + dstX) * 4;

      // Bilinear blend for each channel
      for (let c = 0; c < 4; c++) {
        const top    = src[idx00 + c] * (1 - xFrac) + src[idx10 + c] * xFrac;
        const bottom = src[idx01 + c] * (1 - xFrac) + src[idx11 + c] * xFrac;
        output[dstIdx + c] = Math.round(top * (1 - yFrac) + bottom * yFrac);
      }
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Converts a resized RGBA Uint8Array into a Float32Array in RGB HWC order
 * with pixel values normalised to [-1.0, 1.0] for GhostFaceNet.
 *
 * Normalisation formula: value = (pixel / 127.5) - 1.0
 *
 * Memory layout (HWC = Height × Width × Channels):
 *   [R(0,0), G(0,0), B(0,0), R(0,1), G(0,1), B(0,1), ..., B(H-1,W-1)]
 *
 * Alpha channel is discarded — only RGB is used.
 *
 * @param rgbaData - Resized RGBA pixel data (width × height × 4 bytes)
 * @param width    - Image width in pixels
 * @param height   - Image height in pixels
 * @returns         Float32Array of length width × height × 3
 */
export function rgbaToNormalisedRGB(
  rgbaData: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const tensor = new Float32Array(width * height * 3);
  let outIdx = 0;

  for (let i = 0; i < width * height; i++) {
    const inIdx = i * 4; // RGBA stride
    tensor[outIdx++] = rgbaData[inIdx]     / 127.5 - 1.0; // R
    tensor[outIdx++] = rgbaData[inIdx + 1] / 127.5 - 1.0; // G
    tensor[outIdx++] = rgbaData[inIdx + 2] / 127.5 - 1.0; // B
    // Alpha [inIdx + 3] discarded
  }

  return tensor;
}

// ---------------------------------------------------------------------------
// Face Crop Extraction
// ---------------------------------------------------------------------------

/**
 * Crops the face region from a full-frame RGBA image using the provided
 * bounding box coordinates. Adds a configurable padding margin so the
 * model sees a bit of context around the face.
 *
 * @param src     - Full frame RGBA pixel data
 * @param srcW    - Frame width
 * @param srcH    - Frame height
 * @param faceX   - Bounding box left edge in frame pixels
 * @param faceY   - Bounding box top edge in frame pixels
 * @param faceW   - Bounding box width in frame pixels
 * @param faceH   - Bounding box height in frame pixels
 * @param padding - Fractional padding to add on each side (default: 0.15 = 15%)
 * @returns         Cropped RGBA Uint8Array and the crop dimensions
 */
export function cropFaceRegion(
  src: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  faceX: number,
  faceY: number,
  faceW: number,
  faceH: number,
  padding: number = 0.15,
): { data: Uint8Array; width: number; height: number } {
  const padX = Math.round(faceW * padding);
  const padY = Math.round(faceH * padding);

  const x0 = Math.max(0, Math.round(faceX - padX));
  const y0 = Math.max(0, Math.round(faceY - padY));
  const x1 = Math.min(srcW, Math.round(faceX + faceW + padX));
  const y1 = Math.min(srcH, Math.round(faceY + faceH + padY));

  const cropW = x1 - x0;
  const cropH = y1 - y0;

  const crop = new Uint8Array(cropW * cropH * 4);

  for (let row = 0; row < cropH; row++) {
    const srcRowStart = ((y0 + row) * srcW + x0) * 4;
    const dstRowStart = row * cropW * 4;
    crop.set(src.subarray(srcRowStart, srcRowStart + cropW * 4), dstRowStart);
  }

  return { data: crop, width: cropW, height: cropH };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Full preprocessing pipeline: crop → resize → normalise → tensor.
 *
 * Call this once after liveness verification is complete to prepare the face
 * image for GhostFaceNet inference.
 *
 * Pipeline:
 *   1. Crop the face region from the full frame (+ 15% padding margin)
 *   2. Bilinear resize to 112×112
 *   3. Convert RGBA → normalised Float32 RGB tensor
 *
 * @param image  - Full camera frame RGBA pixel data
 * @param faceX  - Detected face bounding box X (frame pixels)
 * @param faceY  - Detected face bounding box Y (frame pixels)
 * @param faceW  - Detected face bounding box width
 * @param faceH  - Detected face bounding box height
 * @returns       PreprocessedFace ready for TFLite input
 * @throws        If the image data is empty or face bounds are invalid
 */
export function preprocessFace(
  image: RawImageData,
  faceX: number,
  faceY: number,
  faceW: number,
  faceH: number,
): PreprocessedFace {
  if (image.data.length === 0) {
    throw new Error('[FacePreprocessor] Empty image data');
  }
  if (faceW <= 0 || faceH <= 0) {
    throw new Error(`[FacePreprocessor] Invalid face bounds: ${faceW}×${faceH}`);
  }

  // Step 1: Crop face region with padding
  const crop = cropFaceRegion(
    image.data,
    image.width,
    image.height,
    faceX,
    faceY,
    faceW,
    faceH,
  );

  // Step 2: Resize to model input dimensions
  const resized = bilinearResize(
    crop.data,
    crop.width,
    crop.height,
    MODEL_INPUT.width,
    MODEL_INPUT.height,
  );

  // Step 3: Normalise and convert to Float32 tensor
  const tensor = rgbaToNormalisedRGB(resized, MODEL_INPUT.width, MODEL_INPUT.height);

  return {
    tensor,
    width: MODEL_INPUT.width,
    height: MODEL_INPUT.height,
  };
}
