import path from "path";
import { createSerwistRoute } from "@serwist/turbopack";

const serwistRoute = createSerwistRoute({
  swSrc: path.join(process.cwd(), "src/sw.ts"),
  globDirectory: ".next",
  globPatterns: [
    ".next/static/**/*.{js,css,html,ico,png,svg,webp,json,webmanifest}",
    "public/**/*",
  ],
});

export const { dynamic, dynamicParams, revalidate } = serwistRoute;

// @serwist/turbopack@9.5.7 bug — deux faces du même problème :
//   generateStaticParams() retourne { path: string } mais Next.js [...path] exige string[]
//   GET() reçoit { path: string[] } de Next.js mais path.join() interne attend string
export async function generateStaticParams() {
  const params = await serwistRoute.generateStaticParams();
  return params.map((p: { path: string | string[] }) => ({
    path: typeof p.path === "string" ? p.path.split("/") : p.path,
  }));
}

// Dev only: Service Worker "kill switch" served in place of the real worker.
// It removes itself, purges caches and reloads open tabs; it has no fetch handler.
const DEV_KILL_SWITCH = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => { try { c.navigate(c.url); } catch (e) {} });
  })());
});
`;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string | string[] }> }
) {
  if (process.env.NODE_ENV !== "production") {
    return new Response(DEV_KILL_SWITCH, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Service-Worker-Allowed": "/",
      },
    });
  }
  const resolved = await params;
  const flatPath = Array.isArray(resolved.path)
    ? resolved.path.join("/")
    : resolved.path;
  return serwistRoute.GET(request, {
    params: Promise.resolve({ path: flatPath }) as Promise<{ path: string }>,
  });
}
