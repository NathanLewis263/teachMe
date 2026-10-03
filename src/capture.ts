import type { NativeImage } from "electron";

// Base64 makes the image bigger, so check the final string before sending it.
export function encodeScreen(image: NativeImage, maxBytes: number): string {
  if (!Number.isInteger(maxBytes) || maxBytes < 8192 || maxBytes > 1024 * 1024)
    throw new Error("Invalid screenshot size budget");
  const originalWidth = image.getSize().width;
  // Try smaller images until one fits the voice connection's message limit.
  for (const width of [1600, 1280, 1024, 800, 640, 480]) {
    const resized = image.resize({ width: Math.min(width, originalWidth), quality: "best" });
    for (const quality of [82, 65, 45]) {
      const data = `data:image/jpeg;base64,${resized.toJPEG(quality).toString("base64")}`;
      if (Buffer.byteLength(data, "utf8") <= maxBytes) return data;
    }
  }
  throw new Error("This screen is too detailed to send on this connection. Turn off screen context or show a simpler window and try again.");
}
