import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * App icon, generated rather than committed as a binary.
 *
 * A generator keeps the icon in version control as code: no opaque PNG in the diff
 * and no risk of the manifest referencing a file that was never added.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)",
          fontSize: 300,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 340,
            height: 340,
            borderRadius: 80,
            background: "#ffffff",
          }}
        >
          ✅
        </span>
      </div>
    ),
    size
  );
}
