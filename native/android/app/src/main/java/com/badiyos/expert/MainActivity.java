package com.badiyos.expert;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.webkit.GeolocationPermissions;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Custom MainActivity:
 *   1. Overrides WebChromeClient to auto-grant HTML5 Geolocation for the app's
 *      own origin (Capacitor still enforces OS-level permission via JS layer).
 *   2. Registers the "new_booking_alerts_v2" NotificationChannel on Android O+
 *      so FCM pushes for new bookings ring loudly with heads-up + vibration.
 *
 * The Android project is NOT committed to the repo — it's generated locally via
 * `npx cap add android`. After generation, keep this MainActivity.java and run
 * `npx cap sync android` before rebuilding the APK.
 */
public class MainActivity extends BridgeActivity {

    private static final String NEW_BOOKING_CHANNEL_ID = BadiyoMessagingService.CHANNEL_ID;
    private static final String COURIER_OFFER_CHANNEL_ID = "courier_offer_alerts";

    /** Extra used by the full-screen booking alert to deep-link after Accept. */
    public static final String EXTRA_ROUTE = "badiyo_route";
    /** Set by notification taps: stop the ring + remove the notification on open. */
    public static final String EXTRA_STOP_RING = "badiyo_stop_ring";
    public static final String EXTRA_RING_BOOKING_ID = "badiyo_ring_booking_id";

    /**
     * Tracks whether the webview UI is currently visible. BadiyoMessagingService
     * uses this to decide between the in-app alert (foreground) and the
     * full-screen ringing notification (background / locked).
     */
    private static volatile boolean appInForeground = false;

    public static boolean isAppInForeground() {
        return appInForeground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins BEFORE super.onCreate so Capacitor picks them up.
        registerPlugin(BackgroundLocationPlugin.class);
        registerPlugin(AlertSetupPlugin.class);
        super.onCreate(savedInstanceState);



        this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) {
                callback.invoke(origin, true, false);
            }
        });

        // If the app crashed / was killed mid-ring, put the expert's alarm volume back.
        if (!BookingRingService.isRunning()) RingGuard.restoreIfPending(this);
        createNewBookingNotificationChannel();
        createCourierOfferNotificationChannel();
        handleRouteExtra(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRouteExtra(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        appInForeground = true;
    }

    @Override
    protected void onPause() {
        appInForeground = false;
        super.onPause();
    }

    /**
     * When launched from the full-screen booking alert we carry the target
     * in-app route; navigate the webview there once the bridge is ready.
     */
    private void handleRouteExtra(Intent intent) {
        if (intent == null) return;
        if (intent.getBooleanExtra(EXTRA_STOP_RING, false)) {
            intent.removeExtra(EXTRA_STOP_RING);
            String bid = intent.getStringExtra(EXTRA_RING_BOOKING_ID);
            BadiyoMessagingService.cancelRingNotification(getApplicationContext());
            BookingRingActivity.dismissIfShowing(getApplicationContext(), bid);
        }
        final String route = intent.getStringExtra(EXTRA_ROUTE);
        if (TextUtils.isEmpty(route)) return;
        intent.removeExtra(EXTRA_ROUTE);
        if (this.bridge == null || this.bridge.getWebView() == null) return;
        this.bridge.getWebView().post(() ->
            this.bridge.getWebView().evaluateJavascript(
                "window.location.replace('" + route.replace("'", "") + "');", null
            )
        );
    }

    private void createNewBookingNotificationChannel() {
        // v2 channel with the loud alarm sound; also deletes the old chime channel.
        BadiyoMessagingService.ensureChannel(this);
    }

    private void createCourierOfferNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(COURIER_OFFER_CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            COURIER_OFFER_CHANNEL_ID,
            "Parcel Delivery Offers",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Loud alerts when a parcel delivery offer arrives nearby.");

        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 400, 200, 400 });

        Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (soundUri == null) {
            soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(soundUri, audioAttributes);

        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.enableLights(true);

        manager.createNotificationChannel(channel);
    }
}
