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
 * Full-screen "ringing" alert for new booking pushes.
 *
 * Extends the Capacitor push plugin's MessagingService (instead of
 * FirebaseMessagingService directly) so token registration and the JS
 * pushNotificationReceived / pushNotificationActionPerformed events keep
 * working exactly as before for every other message type.
 *
 * Behaviour:
 *   - Data-only message with alert_type = "assigned" | "broadcast" AND the app
 *     NOT in the foreground  -> build a CATEGORY_CALL, ongoing, full-screen
 *     intent notification on the "new_booking_alerts_v2" channel and
 *     launch {@link BookingRingActivity} (rings + wakes/unlocks the screen).
 *   - Anything else (app open, or any non-alert push) -> delegate to super,
 *     which forwards to the webview. The existing in-app looping alert on the
 *     Home screen is therefore untouched.
 */
public class BadiyoMessagingService extends MessagingService {

    private static final String TAG = "BadiyoFCM";

    static final String CHANNEL_ID = "new_booking_alerts_v2";
    /** Old channel created with the default chime; deleted so it cannot win. */
    static final String LEGACY_CHANNEL_ID = "new_booking_alerts";
    static final int RING_NOTIFICATION_ID = 5120;

    @Override
    public void onCreate() {
        super.onCreate();
        // Process may have died mid-ring with the alarm volume boosted.
        if (!BookingRingService.isRunning()) RingGuard.restoreIfPending(this);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = new java.util.HashMap<>(remoteMessage.getData());
        // A push can arrive before MainActivity ever ran (killed / rebooted).
        ensureChannel(getApplicationContext());
        String alertType = resolveAlertType(data);
        if (alertType != null) data.put("alert_type", alertType);

        // "Already taken" / offer withdrawn / order closed: no sound, stop any ring.
        if (isStopAlert(alertType)) {
            String id = orEmpty(data.get("booking_id"));
            if (id.isEmpty()) id = orEmpty(data.get("order_id"));
            BookingRingService.stopFor(getApplicationContext(), id);
            BookingRingActivity.dismissIfShowing(getApplicationContext(), id);
            super.onMessageReceived(remoteMessage);
            return;
        }

        boolean isBookingAlert = isRingAlert(alertType);

        if (!isBookingAlert) {
            // Wallet / offers / info / unknown types. A data-only push is never
            // shown by the OS, so post a normal heads-up ourselves when the app
            // is not open — nothing gets dropped silently.
            if (remoteMessage.getNotification() == null && !MainActivity.isAppInForeground()) {
                try {
                    showInfoNotification(data);
                } catch (Throwable t) {
                    Log.e(TAG, "showInfoNotification failed", t);
                }
            }
            super.onMessageReceived(remoteMessage);
            return;
        }

        if (MainActivity.isAppInForeground()) {
            // App is open: the web layer already plays its own looping alert
            // and renders the offer card. Do not ring twice.
            Log.d(TAG, "booking alert while foreground — delegating to webview");
            super.onMessageReceived(remoteMessage);
            return;
        }

        try {
            showRingingNotification(data);
        } catch (Throwable t) {
            Log.e(TAG, "showRingingNotification failed — falling back", t);
            try { showInfoNotification(data); } catch (Throwable ignored) {}
            super.onMessageReceived(remoteMessage);
        }
    }

    static final String INFO_CHANNEL_ID = "badiyo_general_v1";

    /** Normal-sound heads-up for info pushes and any unrecognised data-only push. */
    private void showInfoNotification(Map<String, String> data) {
        Context ctx = getApplicationContext();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && nm.getNotificationChannel(INFO_CHANNEL_ID) == null) {
            android.app.NotificationChannel ch = new android.app.NotificationChannel(
                INFO_CHANNEL_ID, "Updates", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Wallet, offers and other updates.");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
        String title = fallback(data.get("title"), "Badiyos Expert");
        String body = fallback(data.get("body"), fallback(data.get("message"), "You have a new update"));
        String route = orEmpty(data.get("route"));
        if (route.isEmpty()) route = orEmpty(data.get("url"));
        if (!route.startsWith("/")) route = "/home";

        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(MainActivity.EXTRA_ROUTE, route);
        int id = (int) (System.currentTimeMillis() & 0x7fffffff);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, piFlags(PendingIntent.FLAG_UPDATE_CURRENT));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, INFO_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(pi);
        nm.notify(id, b.build());
    }

    /** alert_type, falling back to the payload "type" for job pushes. */
    static String resolveAlertType(Map<String, String> data) {
        String a = data.get("alert_type");
        if (a != null && !a.isEmpty()) return a;
        String t = data.get("type");
        if (t == null || t.isEmpty()) return null;
        switch (t) {
            case "new_booking_broadcast": return "broadcast";
            case "booking_assigned": return "assigned";
            default: return t; // e.g. "courier_offer", "order_closed"
        }
    }

    /** Creates the loud alarm-sound job channel (idempotent). */
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        try { if (nm.getNotificationChannel(LEGACY_CHANNEL_ID) != null) nm.deleteNotificationChannel(LEGACY_CHANNEL_ID); } catch (Throwable ignored) {}
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        android.app.NotificationChannel ch = new android.app.NotificationChannel(
            CHANNEL_ID, "New Job Alerts", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Loud ringing alerts for new jobs.");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 700, 400, 700 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        int resId = ctx.getResources().getIdentifier("booking_alert", "raw", ctx.getPackageName());
        android.net.Uri sound = resId != 0
            ? android.net.Uri.parse("android.resource://" + ctx.getPackageName() + "/" + resId)
            : android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM);
        ch.setSound(sound, new android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ch.enableLights(true);
        nm.createNotificationChannel(ch);
    }

    /** Alert types that get the full-screen wake-the-lockscreen treatment. */
    static boolean isRingAlert(String alertType) {
        if (alertType == null) return false;
        switch (alertType) {
            case "assigned":
            case "broadcast":
            case "new_order":
            case "extension_request":
            case "courier_offer":
            case "order_cancelled":
            case "order_completed":
            case "reminder_10min":
            case "reminder_30min":
                return true;
            default:
                return false;
        }
    }

    /** Pushes that mean "stop ringing — job no longer available to you". */
    static boolean isStopAlert(String alertType) {
        if (alertType == null) return false;
        switch (alertType) {
            case "already_taken":
            case "booking_taken":
            case "offer_taken":
            case "offer_expired":
            case "offer_withdrawn":
            case "ring_stop":
            case "order_closed":
            case "courier_offer_taken":
            case "courier_offer_expired":
                return true;
            default:
                return false;
        }
    }

    /** Single "OK" dismiss alerts (informational). */
    static boolean isInfoAlert(String alertType) {
        return "order_cancelled".equals(alertType)
            || "order_completed".equals(alertType)
            || "reminder_10min".equals(alertType)
            || "reminder_30min".equals(alertType);
    }

    /**
     * Ring window from the backend: prefer the absolute expires_at (exact
     * remaining time, accounts for push delay), then timeout_seconds /
     * accept_timeout_seconds. The fixed default is only used when the backend
     * sent nothing. Returns 0 when the offer has already expired.
     */
    static int resolveTimeoutSeconds(Map<String, String> data, boolean info) {
        String exp = data.get("expires_at");
        if (exp != null && !exp.isEmpty()) {
            long ms = parseIsoMs(exp);
            if (ms > 0) {
                long left = (ms - System.currentTimeMillis()) / 1000L;
                return (int) Math.max(0, left);
            }
        }
        int t = parseInt(data.get("accept_timeout_seconds"), -1);
        if (t <= 0) t = parseInt(data.get("timeout_seconds"), -1);
        if (t > 0) return t;
        return info ? 20 : 60;
    }

    private static long parseIsoMs(String s) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                return java.time.OffsetDateTime.parse(s.trim().replace(' ', 'T')).toInstant().toEpochMilli();
            }
        } catch (Throwable ignored) {}
        try {
            return Long.parseLong(s.trim()); // epoch ms fallback
        } catch (Throwable t) {
            return -1;
        }
    }

    private void showRingingNotification(Map<String, String> data) {
        String alertType = orEmpty(data.get("alert_type"));
        boolean courier = "courier_offer".equals(alertType);
        String bookingId = orEmpty(data.get("booking_id"));
        if (bookingId.isEmpty() || courier) {
            String oid = orEmpty(data.get("order_id"));
            if (!oid.isEmpty()) bookingId = oid;
        }
        String title = fallback(data.get("title"), courier ? "New delivery offer" : "New booking nearby");
        String body = orEmpty(data.get("body"));
        if (body.isEmpty() && courier) {
            String earning = orEmpty(data.get("earning"));
            String pickup = orEmpty(data.get("pickup_area"));
            String drop = orEmpty(data.get("drop_area"));
            StringBuilder sb = new StringBuilder();
            if (!earning.isEmpty()) sb.append("You earn ₹").append(earning);
            if (!pickup.isEmpty()) sb.append(sb.length() > 0 ? " · " : "").append("Pickup ").append(pickup);
            if (!drop.isEmpty()) sb.append(" → ").append(drop);
            body = sb.toString();
        }
        if (body.isEmpty()) body = "Tap to view details";
        String address = orEmpty(data.get("address"));
        String duration = orEmpty(data.get("duration"));
        String soundUrl = orEmpty(data.get("sound_url"));
        String extensionId = orEmpty(data.get("extension_id"));
        String extraMinutes = orEmpty(data.get("extra_minutes"));
        String extraPrice = orEmpty(data.get("extra_price"));
        boolean info = isInfoAlert(alertType);
        boolean extension = "extension_request".equals(alertType);
        int timeoutSeconds = resolveTimeoutSeconds(data, info);
        if (timeoutSeconds <= 0) {
            Log.d(TAG, "offer already expired — not ringing");
            return;
        }

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

        PendingIntent fullScreen = PendingIntent.getActivity(
            this, bookingId.hashCode(), ring, piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
        );

        String text = address.isEmpty() ? body : (duration.isEmpty() ? address : duration + " · " + address);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setTimeoutAfter(timeoutSeconds * 1000L)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen);

        if (info) {
            PendingIntent okPi = PendingIntent.getBroadcast(
                this,
                ("ok:" + bookingId + alertType).hashCode(),
                BookingAlertActions.dismissIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            builder.addAction(0, "OK", okPi);
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
            builder.addAction(0, "Accept", acceptPi).addAction(0, "Decline", declinePi);
        } else if (courier) {
            PendingIntent openPi = PendingIntent.getBroadcast(
                this,
                ("courier-open:" + bookingId).hashCode(),
                BookingAlertActions.openCourierIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            PendingIntent dismissPi = PendingIntent.getBroadcast(
                this,
                ("courier-dismiss:" + bookingId).hashCode(),
                BookingAlertActions.rejectIntent(this, bookingId),
                piFlags(PendingIntent.FLAG_UPDATE_CURRENT)
            );
            builder.addAction(0, "Open offer", openPi).addAction(0, "Dismiss", dismissPi);
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
            builder.addAction(0, "Accept", acceptPi).addAction(0, "Reject", rejectPi);
        }

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        // Android 14+: full-screen intent only when the expert allowed it.
        // Otherwise this stays a PRIORITY_MAX heads-up with the looping alarm.
        boolean fullScreenAllowed = RingGuard.canUseFullScreenIntent(this);
        if (!fullScreenAllowed) {
            builder.setFullScreenIntent(null, false);
            Log.d(TAG, "full-screen intent not allowed — heads-up fallback");
        }

        // The looping sound comes from the foreground service, so the
        // notification itself only alerts once (no double sound).
        builder.setOnlyAlertOnce(true).setSilent(true);
        Notification n = builder.build();

        boolean serviceStarted = BookingRingService.start(
            getApplicationContext(), n, bookingId, soundUrl, timeoutSeconds * 1000L);
        if (!serviceStarted) {
            // FGS start refused (rare OEM restriction): fall back to an
            // insistent notification that loops the channel sound.
            Notification loud = builder.setSilent(false).setOnlyAlertOnce(false).build();
            loud.flags |= Notification.FLAG_INSISTENT;
            nm.notify(RING_NOTIFICATION_ID, loud);
        }

        // On locked devices start the ring screen directly too (singleTask),
        // but only when full-screen alerts are allowed.
        KeyguardManager km = getSystemService(KeyguardManager.class);
        boolean locked = km != null && km.isKeyguardLocked();
        if (fullScreenAllowed && (locked || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)) {
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
        BookingRingService.stop(ctx.getApplicationContext());
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
