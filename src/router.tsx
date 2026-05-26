import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
  "Load error",
];

function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

function ChunkLoadErrorFallback() {
  const key = "chunk_reload_attempted";
  if (typeof sessionStorage !== "undefined" && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
    return null;
  }
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Sem ligação</p>
        <p className="text-sm text-[#6B7280]">
          Verifica a tua ligação à internet e tenta novamente.
        </p>
        <button
          onClick={() => {
            sessionStorage.removeItem(key);
            window.location.reload();
          }}
          className="mt-2 text-sm font-medium text-[#F4623A] underline"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

function DefaultErrorFallback({ error }: { error: Error }) {
  if (isChunkLoadError(error)) return <ChunkLoadErrorFallback />;
  return (
    <div className="min-h-screen bg-[#FAFAF8] flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-[#1A1A1A] font-semibold">Algo correu mal</p>
        <p className="text-sm text-[#6B7280]">{error.message}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-sm font-medium text-[#F4623A] underline"
        >
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 300,
    defaultErrorComponent: ({ error }) => (
      <DefaultErrorFallback error={error as Error} />
    ),
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
