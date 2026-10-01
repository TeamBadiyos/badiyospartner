import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { routeTree } from "./routeTree.gen";
import { friendlyError } from "./lib/friendly-error";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Safety net: any action that fails without its own error handler still
    // tells the user what went wrong instead of silently doing nothing.
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.options.onError) return;
        toast.error(friendlyError(err));
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
