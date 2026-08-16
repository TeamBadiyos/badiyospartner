package com.badiyos.partner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.Executors;

/**
 * Handles the Accept / Reject actions from the full-screen booking alert —
 * both the notification action buttons and the on-screen buttons in
 * {@link BookingRingActivity}.
 *
 * Accept  -> calls the same SECURITY DEFINER RPC the in-app Accept button
 *            uses (claim_booking_as_expert), then opens the app.
 * Reject  -> purely local dismiss. This matches current app behaviour: a
 *            reject is not a formal action anywhere in the Expert app today
 *            (the in-app card's "Dismiss" only removes the card locally);
 *            dispatch simply expands the radius on its own timer.
 */
public class BookingAlertActions extends BroadcastReceiver {

    private static final String TAG = "BadiyoAlertAction";

    public static final String ACTION_ACCEPT = "com.badiyos.partner.action.ALERT_ACCEPT";
    public static final String ACTION_REJECT = "com.badiyos.partner.action.ALERT_REJECT";
    public static final String ACTION_DISMISS = "com.badiyos.partner.action.ALERT_DISMISS";
    public static final String ACTION_EXT_ACCEPT = "com.badiyos.partner.action.EXT_ACCEPT";
    public static final String ACTION_EXT_DECLINE = "com.badiyos.partner.action.EXT_DECLINE";
    public static final String EXTRA_BOOKING_ID = "booking_id";
    public static final String EXTRA_EXTENSION_ID = "extension_id";

    static Intent acceptIntent(Context ctx, String bookingId) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(ACTION_ACCEPT);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        return i;
    }

    static Intent rejectIntent(Context ctx, String bookingId) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(ACTION_REJECT);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        return i;
    }

    static Intent dismissIntent(Context ctx, String bookingId) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(ACTION_DISMISS);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        return i;
    }

    static Intent extensionIntent(Context ctx, String bookingId, String extensionId, boolean accept) {
        Intent i = new Intent(ctx, BookingAlertActions.class);
        i.setAction(accept ? ACTION_EXT_ACCEPT : ACTION_EXT_DECLINE);
        i.putExtra(EXTRA_BOOKING_ID, bookingId);
        i.putExtra(EXTRA_EXTENSION_ID, extensionId);
        return i;
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        String bookingId = intent != null ? intent.getStringExtra(EXTRA_BOOKING_ID) : null;
        Log.d(TAG, "action=" + action + " booking=" + bookingId);

        // Stop the ringing UI/sound immediately for both actions.
        BadiyoMessagingService.cancelRingNotification(context.getApplicationContext());
        BookingRingActivity.dismissIfShowing(context.getApplicationContext(), bookingId);

        String extensionId = intent != null ? intent.getStringExtra(EXTRA_EXTENSION_ID) : null;

        if (ACTION_ACCEPT.equals(action) && bookingId != null && !bookingId.isEmpty()) {
            claimAsync(context.getApplicationContext(), bookingId);
        } else if (ACTION_EXT_ACCEPT.equals(action) || ACTION_EXT_DECLINE.equals(action)) {
            decideExtensionAsync(
                context.getApplicationContext(),
                bookingId,
                extensionId,
                ACTION_EXT_ACCEPT.equals(action)
            );
        } else if (ACTION_DISMISS.equals(action)) {
            // Informational alert acknowledged — deep-link to the booking.
            if (bookingId != null && !bookingId.isEmpty()) {
                openApp(context.getApplicationContext(), "/booking/" + bookingId);
            }
        }
        // Reject: nothing else to do — silent local dismiss.
    }

    /** Fire-and-forget claim on a worker thread, then open the app on success. */
    static void claimAsync(final Context appCtx, final String bookingId) {
        Executors.newSingleThreadExecutor().execute(() -> {
            SupabaseRpc.Result res;
            try {
                JSONObject params = new JSONObject();
                params.put("p_booking_id", bookingId);
                res = SupabaseRpc.call(appCtx, "claim_booking_as_expert", params);
            } catch (Throwable t) {
                Log.e(TAG, "claim failed", t);
                res = new SupabaseRpc.Result(false, 0, String.valueOf(t.getMessage()));
            }

            final boolean ok = res.ok;
            final String body = res.body;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (ok) {
                    openApp(appCtx, "/booking/" + bookingId);
                } else {
                    // Already claimed by someone else, session expired, etc.
                    Toast.makeText(
                        appCtx,
                        "Could not accept this booking. Open the app to retry.",
                        Toast.LENGTH_LONG
                    ).show();
                    Log.w(TAG, "claim rejected: " + body);
                    openApp(appCtx, "/home");
                }
            });
        });
    }

    /**
     * Accept / decline a customer time-extension request via
     * partner_decide_extension(_extension_id, _decision).
     */
    static void decideExtensionAsync(final Context appCtx, final String bookingId,
                                     final String extensionId, final boolean accept) {
        if (extensionId == null || extensionId.isEmpty()) {
            Log.w(TAG, "extension decision without extension_id — opening app");
            openApp(appCtx, bookingId == null || bookingId.isEmpty() ? "/home" : "/booking/" + bookingId);
            return;
        }
        final String decision = accept ? "accepted" : "declined";
        Executors.newSingleThreadExecutor().execute(() -> {
            SupabaseRpc.Result res;
            try {
                JSONObject params = new JSONObject();
                params.put("_extension_id", extensionId);
                params.put("_decision", decision);
                res = SupabaseRpc.call(appCtx, "partner_decide_extension", params);
            } catch (Throwable t) {
                Log.e(TAG, "extension decision failed", t);
                res = new SupabaseRpc.Result(false, 0, String.valueOf(t.getMessage()));
            }

            final boolean ok = res.ok;
            final String body = res.body;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (ok) {
                    Toast.makeText(
                        appCtx,
                        accept ? "Extension accepted" : "Extension declined",
                        Toast.LENGTH_SHORT
                    ).show();
                    if (accept && bookingId != null && !bookingId.isEmpty()) {
                        openApp(appCtx, "/booking/" + bookingId);
                    }
                } else {
                    Log.w(TAG, "extension decision rejected: " + body);
                    Toast.makeText(
                        appCtx,
                        "Could not update the extension. Open the app to retry.",
                        Toast.LENGTH_LONG
                    ).show();
                    openApp(appCtx, bookingId == null || bookingId.isEmpty() ? "/home" : "/booking/" + bookingId);
                }
            });
        });
    }

    static void openApp(Context appCtx, String route) {
        Intent open = new Intent(appCtx, MainActivity.class);
        open.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        open.putExtra(MainActivity.EXTRA_ROUTE, route);
        appCtx.startActivity(open);
    }
}
