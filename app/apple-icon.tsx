import { ImageResponse } from "next/og";

// iOS home-screen icon (apple-touch-icon). 180x180 is the canonical iOS
// size; Apple downscales for older devices automatically. Solid background
// because iOS does NOT respect transparency on home-screen icons — they
// get a default white square underneath which clashes with the dark UI.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #11141b 0%, #1f2430 100%)",
          fontSize: 128,
        }}
      >
        🏆
      </div>
    ),
    size,
  );
}
