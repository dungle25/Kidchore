import type { MetadataRoute } from "next";

/**
 * Web app manifest, so a family can add KidChore to a phone or tablet home screen
 * and open it full screen without browser chrome. This is what makes it usable as
 * an app for a child rather than a website.
 *
 * The icons are served from the route in app/icon.tsx rather than static files, so
 * there is no binary asset to keep in sync.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KidChore — Việc nhà cho gia đình",
    short_name: "KidChore",
    description:
      "Giao việc nhà, theo dõi thói quen và thưởng điểm cho trẻ trong gia đình.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#7c3aed",
    lang: "vi",
    dir: "ltr",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
