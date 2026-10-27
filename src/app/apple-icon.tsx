import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Apple touch icon — white spark+search on ocean accent. */
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
          background: "#1d6fbf",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
          <circle
            cx="10"
            cy="10.5"
            r="5.25"
            stroke="#ffffff"
            strokeWidth="1.75"
          />
          <path
            d="M14.2 14.7 19 19.5"
            stroke="#ffffff"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M17.5 4.5v3.5M15.75 6.25h3.5"
            stroke="#ffffff"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M19.5 9v2M18.5 10h2"
            stroke="#ffffff"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
