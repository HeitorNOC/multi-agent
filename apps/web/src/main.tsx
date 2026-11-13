import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isRetryable } from "@/lib/api";
import { AuthGate } from "@/features/access/auth-gate";
import { router } from "./app/router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erros de pedido (4xx) não melhoram com nova tentativa; queda de conexão, sim.
      retry: (count, error) => isRetryable(error) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
