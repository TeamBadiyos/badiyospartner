import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The standalone courier offers list is gone: parcel delivery offers now appear
 * inside the normal Home order queue, exactly like maid / car wash requests.
 * Old links and shortcuts land on Home instead.
 */
export const Route = createFileRoute("/courier/")({
  beforeLoad: () => {
    throw redirect({ to: "/home" });
  },
  component: () => null,
});
