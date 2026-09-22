package com.badiyos.expert;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Full-screen "ringing" alert for new booking pushes and courier (parcel)
 * offers.
 *
 * Extends the Capacitor push plugin's MessagingService (instead of
 * FirebaseMessagingService directly) so token registration and the JS
 * pushNotificationReceived / pushNotificationActionPerformed events keep
 * working exactly as before for every other message type.
 *
 * Behaviour:
 *   - Data-only message with alert_type = "assigned" | "broadcast" AND the app
 *     NOT in the foreground  -> build a CATEGORY_CALL, ongoing, full-screen
 *     intent notification on the existing "new_booking_alerts" channel and
 *     launch {@link BookingRingActivity} (rings + wakes/unlocks the screen).
 *   - Data-only message with type = "courier_offer" AND the app NOT in the
 *     foreground -> same treatment on the "courier_offer_alerts" channel, with
 *     the countdown driven by the offer's expires_at.
 *   - Anything else (app open, or any non-alert push) -> delegate to super,
 *     which forwards to the webview. The existing in-app looping alert on the
 *     Home screen is therefore untouched.
 */
public class BadiyoMessagingService extends MessagingService {

    private static final String TAG = "BadiyoFCM";

    static final String CHANNEL_ID = "new_booking_alerts";
    static final String COURIER_CHANNEL_ID = "courier_offer_alerts";
    static final int RING_NOTIFICATION_ID = 5120;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String alertType = data.get("alert_type");

        // data: type=courier_offer, offer_id, order_id, order_code, expires_at
        //       (ISO), earning, pickup_area, drop_area, trip_km
        if ("courier_offer".equals(orEmpty(data.get("type")))) {
            if (MainActivity.isAppInForeground()) {
                Log.d(TAG, "courier offer while foreground — delegating to webview");
                super.onMessageReceived(remoteMessage);
                return;
            }
            try {
                showCourierOffer(data);
            } catch (Throwable t) {
                Log.e(TAG, "showCourierOffer failed — falling back", t);
                super.onMessageReceived(remoteMessage);
            }
            return;
        }

        boolean isBookingAlert = isRingAlert(alertType);

        if (!isBookingAlert) {
            super.onMessageReceived(remoteMessage);
            return;
        }

        if (MainActivity.isAppInForeground()) {
            // App is open: the web layer already plays its own looping alert
            // and renders the broadcast card. Do not ring twice.
            Log.d(TAG, "booking alert while foreground — delegating to webview");
            super.onMessageReceived(remoteMessage);
            return;
        }

        try {
            showRingingNotification(data);
        } catch (Throwable t) {
            Log.e(TAG, "showRingingNotification failed — falling back", t);
            super.onMessageReceived(remoteMessage);
        }
    }

    /** Alert types that get the full-screen wake-the-lockscreen treatment. */
    static boolean isRingAlert(String alertType) {
        if (alertType == null) return false;
        switch (alertType) {
            case "assigned":
            case "broadcast":
            case "new_order":
            case "extension_request":
            case "order_cancelled":
            case "order_completed":
            case "reminder_10min":
                return true;
            default:
                return false;
        }
    }

    /** Single "OK" dismiss alerts (informational). */
    static boolean isInfoAlert(String alertType) {
        return "order_cancelled".equals(alertType)
            || "order_completed".equals(alertType)
            || "reminder_10min".equals(alertType);
    }

    // ---------------- courier (parcel) offers ----------------

    private void showCourierOffer(Map<String, String> data) {
        String offerId = orEmpty(data.get("offer_id"));
        String orderId = orEmpty(data.get("order_id"));
        String expiresAt = orEmpty(data.get("expires_at"));
        String pickup = orEmpty(data.get("pickup_area"));
        String drop = orEmpty(data.get("drop_area"));
        String earning = orEmpty(data.get("earning"));
        String tripKm = orEmpty(data.get("trip_km"));
        String title = fallback(data.get("order_code"), "New parcel delivery");
        String body = (pickup.isEmpty() && drop.isEmpty())
            ? "Tap to view the delivery"
            : pickup + " -> " + drop;

        int seconds = BookingRingActivity.secondsUntil(expiresAt);
        if (seconds <= 0) {
            Log.d(TAG, "courier offer already expired offer=" + offerId);
            return;
        }

        Log.d(TAG, "courier offer=" + offerId + " order=" + orderId
            + " expires_in=" + seconds + "s");

        Intent ring = new Intent(this, BookingRingActivity.class);
        ring.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        ring.putExtra(BookingRingActivity.EXTRA_ALERT_KIND, "courier_offer");
        ring.putExtra(BookingRingActivity.EXTRA_OFFER_ID, offerId);
        ring.putExtra(BookingRingActivity.EXTRA_ORDER_ID, orderId);
        ring.putExtra(BookingRingActivity.EXTRA_EXPIRES_AT, expiresAt);
        ring.putExtra(BookingRingActivity.EXTRA_EARNING, earning);
        ring.putExtra(BookingRingActivity.EXTRA_DURATION, tripKm.isEmpty() ? "" : tripKm + " km");
        ring.putExtra(BookingRingActivity.EXTRA_TITLE, title);
        ring.putExtra(BookingRingActivity.EXTRA_BODY, body);
        ring.putExtra(BookingRingActivity.EXTRA_ADDRESS, body);
        ring.putExtra(BookingRingActivity.EXTRA_TIMEOUT, seconds);

        startFullScreenAlert(ring, COURIER_CHANNEL_ID, offerId.hashCode(),
            title, body, seconds);
    }

    // ---------------- home-service booking alerts ----------------

    private void showRingingNotification(Map<String, String> data) {
        String bookingId = orEmpty(data.get("booking_id"));
        String alertType = orEmpty(data.get("alert_type"));
        String title = fallback(data.get("title"), "New booking nearby");
        String body = fallback(data.get("body"), "Tap to view details");
        String address = orEmpty(data.get("address"));
        String duration = orEmpty(data.get("duration"));
        String soundUrl = orEmpty(data.get("sound_url"));
        String extensionId = orEmpty(data.get("extension_id"));
        String extraMinutes = orEmpty(data.get("extra_minutes"));
        String extraPrice = orEmpty(data.get("extra_price"));
        boolean info = isInfoAlert(alertType);
        boolean extension = "extension_request".equals(alertType);
        int timeoutSeconds = parseInt(data.get("timeout_seconds"), info ? 20 : 60);

        Log.d(TAG, "ring alert booking=" + bookingId + " type=" + alertType
            + " timeout=" + timeoutSeconds + "s");

        Intent ring = new Intent(this, BookingRingActivity.class);
        ring.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        ring.putExtra(BookingRingActivity.EXTRA_BOOKING_ID, bookingId);
        ring.putExtra(BookingRingActivity.EXTRA_ALERT_TYPE, alertType);
        ring.putExtra(BookingRingActivity.EXTRA_TITLE, title);
        ring.putExtra(BookingRingActivity.EXTRA_BODY, body);
        ring.putExtra(BookingRingActivity.EXTRA_ADDRESS, address);
        ring.putExtra(BookingRingActivity.EXTRA_DURATION, duration);
        ring.putExtra(BookingRingActivity.EXTRA_TIMEOUT, timeoutSeconds);
        ring.putExtra(BookingRingActivity.EXTRA_SOUND_URL, soundUrl);
        ring.putExtra(BookingRingActivity.EXTRA_EXTENSION_ID, extensionId);
        ring.putExtra(BookingRingActivity.EXTRA_EXTRA_MINUTES, extraMinutes);
        ring.putExtra(BookingRingActivity.EXTRA_EXTRA_PRICE, extraPrice);

        String text = address.isEmpty() ? body : (duration.isEmpty() ? address : duration + " · " + address);

        NotificationCompat.Action[] actions;
        if (info) {
            PendingIntent okPi = PendingIntent.getBroadcast(
                this,
                ("ok:" + bookingId + alertType).hashCode(),
                BookingAlertActions.dismissIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            actions = new NotificationCompat.Action[] {
                new NotificationCompat.Action(0, "OK", okPi)
            };
        } else if (extension) {
            PendingIntent acceptPi = PendingIntent.getBroadcast(
                this,
                ("ext-accept:" + extensionId).hashCode(),
                BookingAlertActions.extensionIntent(this, bookingId, extensionId, true),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            PendingIntent declinePi = PendingIntent.getBroadcast(
                this,
                ("ext-decline:" + extensionId).hashCode(),
                BookingAlertActions.extensionIntent(this, bookingId, extensionId, false),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            actions = new NotificationCompat.Action[] {
                new NotificationCompat.Action(0, "Accept", acceptPi),
                new NotificationCompat.Action(0, "Decline", declinePi)
            };
        } else {
            PendingIntent acceptPi = PendingIntent.getBroadcast(
                this,
                ("accept:" + bookingId).hashCode(),
                BookingAlertActions.acceptIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            PendingIntent rejectPi = PendingIntent.getBroadcast(
                this,
                ("reject:" + bookingId).hashCode(),
                BookingAlertActions.rejectIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            actions = new NotificationCompat.Action[] {
                new NotificationCompat.Action(0, "Accept", acceptPi),
                new NotificationCompat.Action(0, "Reject", rejectPi)
            };
        }

        startFullScreenAlert(ring, CHANNEL_ID, bookingId.hashCode(),
            title, text, timeoutSeconds, actions);
    }

    // ---------------- shared full-screen alert plumbing ----------------

    private void startFullScreenAlert(Intent ring, String channelId, int requestKey,
                                      String title, String text, int timeoutSeconds,
                                      NotificationCompat.Action... actions) {
        // The push can arrive before MainActivity has ever run (app killed /
        // fresh boot), so make sure the channel exists before notifying —
        // otherwise Android O+ silently drops the notification.
        ensureChannel(channelId);

        PendingIntent fullScreen = PendingIntent.getActivity(
            this, requestKey, ring, piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setTimeoutAfter(timeoutSeconds * 1000L)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen);

        if (actions != null) {
            for (NotificationCompat.Action action : actions) {
                if (action != null) builder.addAction(action);
            }
        }

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        Notification n = builder.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until acted on
        nm.notify(RING_NOTIFICATION_ID, n);

        // On locked / dozing devices the full-screen intent fires immediately.
        // When the device is merely idle-but-unlocked some OEMs only show the
        // heads-up, so start the activity ourselves too (safe: singleTask).
        KeyguardManager km = getSystemService(KeyguardManager.class);
        boolean locked = km != null && km.isKeyguardLocked();
        if (locked || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                startActivity(ring);
            } catch (Throwable t) {
                Log.w(TAG, "direct startActivity blocked; relying on full-screen intent", t);
            }
        }
    }

    static int piFlags(int base) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? base | PendingIntent.FLAG_IMMUTABLE
            : base;
    }

    static void cancelRingNotification(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(RING_NOTIFICATION_ID);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String fallback(String s, String def) {
        return (s == null || s.isEmpty()) ? def : s;
    }

    private static int parseInt(String s, int def) {
        try {
            return s == null ? def : Integer.parseInt(s.trim());
        } catch (Throwable t) {
            return def;
        }
    }
}
