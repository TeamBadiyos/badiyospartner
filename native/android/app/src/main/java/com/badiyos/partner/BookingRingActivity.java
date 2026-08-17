package com.badiyos.partner;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

/**
 * Full-screen "incoming job" screen, launched by the full-screen intent from
 * {@link BadiyoMessagingService}. Shows over the lockscreen, turns the screen
 * on, rings a looping sound + vibration, and auto-dismisses after the
 * dispatch timeout (dispatch_config.radius_expand_after_seconds, delivered in
 * the push payload as timeout_seconds; defaults to 60s).
 *
 * On timeout this device simply stops ringing — the backend dispatcher expands
 * the search radius on its own schedule, so no call-back is needed.
 *
 * Alert sound: uses res/raw/booking_alert (any audio file with that name) when
 * present, otherwise falls back to the device's default ringtone.
 */
public class BookingRingActivity extends Activity {

    private static final String TAG = "BadiyoRing";

    public static final String EXTRA_BOOKING_ID = "booking_id";
    public static final String EXTRA_ALERT_TYPE = "alert_type";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    public static final String EXTRA_ADDRESS = "address";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_TIMEOUT = "timeout_seconds";
    public static final String EXTRA_SOUND_URL = "sound_url";
    public static final String EXTRA_EXTENSION_ID = "extension_id";
    public static final String EXTRA_EXTRA_MINUTES = "extra_minutes";
    public static final String EXTRA_EXTRA_PRICE = "extra_price";

    private static final String ACTION_DISMISS = "com.badiyos.partner.action.RING_DISMISS";

    private String bookingId = "";
    private String alertType = "";
    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable timeoutTask;
    private Runnable tickTask;
    private long endsAtMs;
    private TextView countdownView;
    private BroadcastReceiver dismissReceiver;

    /** Asks a showing ring screen (for this booking, or any) to close itself. */
    static void dismissIfShowing(Context appCtx, String bookingId) {
        Intent i = new Intent(ACTION_DISMISS);
        i.setPackage(appCtx.getPackageName());
        i.putExtra(EXTRA_BOOKING_ID, bookingId == null ? "" : bookingId);
        appCtx.sendBroadcast(i);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockscreen();
        setContentView(R.layout.activity_booking_ring);

        applyIntent(getIntent());

        dismissReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String id = intent.getStringExtra(EXTRA_BOOKING_ID);
                if (id == null || id.isEmpty() || id.equals(bookingId)) finishRing();
            }
        };
        IntentFilter filter = new IntentFilter(ACTION_DISMISS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(dismissReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(dismissReceiver, filter);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyIntent(intent);
    }

    private void applyIntent(Intent intent) {
        if (intent == null) return;
        bookingId = str(intent.getStringExtra(EXTRA_BOOKING_ID));
        alertType = str(intent.getStringExtra(EXTRA_ALERT_TYPE));
        String soundUrl = str(intent.getStringExtra(EXTRA_SOUND_URL));
        String extensionId = str(intent.getStringExtra(EXTRA_EXTENSION_ID));
        String extraMinutes = str(intent.getStringExtra(EXTRA_EXTRA_MINUTES));
        String extraPrice = str(intent.getStringExtra(EXTRA_EXTRA_PRICE));
        boolean info = BadiyoMessagingService.isInfoAlert(alertType);
        boolean extension = "extension_request".equals(alertType);
        String title = str(intent.getStringExtra(EXTRA_TITLE));
        String body = str(intent.getStringExtra(EXTRA_BODY));
        String address = str(intent.getStringExtra(EXTRA_ADDRESS));
        String duration = str(intent.getStringExtra(EXTRA_DURATION));
        int defTimeout = info ? 20 : 60;
        int timeout = intent.getIntExtra(EXTRA_TIMEOUT, defTimeout);
        if (timeout <= 0) timeout = defTimeout;

        TextView titleView = findViewById(R.id.ring_title);
        TextView subtitleView = findViewById(R.id.ring_subtitle);
        TextView addressView = findViewById(R.id.ring_address);
        countdownView = findViewById(R.id.ring_countdown);

        TextView detailView = findViewById(R.id.ring_detail);
        Button accept = findViewById(R.id.ring_accept);
        Button reject = findViewById(R.id.ring_reject);
        Button ok = findViewById(R.id.ring_ok);

        titleView.setText(title.isEmpty() ? defaultTitle(alertType) : title);
        detailView.setVisibility(View.GONE);

        if (extension) {
            subtitleView.setText(body.isEmpty() ? "Customer requested more time" : body);
            String detail = extensionDetail(extraMinutes, extraPrice);
            if (!detail.isEmpty()) {
                detailView.setText(detail);
                detailView.setVisibility(View.VISIBLE);
            }
            addressView.setText(address);
            addressView.setVisibility(address.isEmpty() ? View.GONE : View.VISIBLE);

            accept.setVisibility(View.VISIBLE);
            reject.setVisibility(View.VISIBLE);
            ok.setVisibility(View.GONE);
            accept.setText("Accept");
            reject.setText("Decline");
            accept.setOnClickListener(v -> {
                stopRinging();
                BadiyoMessagingService.cancelRingNotification(getApplicationContext());
                BookingAlertActions.decideExtensionAsync(
                    getApplicationContext(), bookingId, extensionId, true);
                finishRing();
            });
            reject.setOnClickListener(v -> {
                stopRinging();
                BadiyoMessagingService.cancelRingNotification(getApplicationContext());
                BookingAlertActions.decideExtensionAsync(
                    getApplicationContext(), bookingId, extensionId, false);
                finishRing();
            });
        } else if (info) {
            subtitleView.setText(body);
            subtitleView.setVisibility(body.isEmpty() ? View.GONE : View.VISIBLE);
            addressView.setText(address);
            addressView.setVisibility(address.isEmpty() ? View.GONE : View.VISIBLE);

            accept.setVisibility(View.GONE);
            reject.setVisibility(View.GONE);
            ok.setVisibility(View.VISIBLE);
            ok.setOnClickListener(v -> {
                stopRinging();
                BadiyoMessagingService.cancelRingNotification(getApplicationContext());
                // Deep-link to the relevant booking on tap.
                if (!bookingId.isEmpty()) {
                    BookingAlertActions.openApp(getApplicationContext(), "/booking/" + bookingId);
                }
                finishRing();
            });
        } else {
            subtitleView.setVisibility(View.VISIBLE);
            addressView.setVisibility(View.VISIBLE);
            subtitleView.setText(duration.isEmpty() ? body : duration);
            addressView.setText(address.isEmpty() ? body : address);

            accept.setVisibility(View.VISIBLE);
            reject.setVisibility(View.VISIBLE);
            ok.setVisibility(View.GONE);
            accept.setText("Accept");
            reject.setText("Reject");
            accept.setOnClickListener(v -> {
                stopRinging();
                BadiyoMessagingService.cancelRingNotification(getApplicationContext());
                BookingAlertActions.claimAsync(getApplicationContext(), bookingId);
                finishRing();
            });
            reject.setOnClickListener(v -> {
                // Silent local dismiss — no backend reject action exists today.
                BadiyoMessagingService.cancelRingNotification(getApplicationContext());
                finishRing();
            });
        }

        startRinging(soundUrl);
        startCountdown(timeout);
    }

    // ---------------- lockscreen / screen wake ----------------

    @SuppressWarnings("deprecation")
    private void showOverLockscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    // ---------------- sound + vibration ----------------

    private static String defaultTitle(String alertType) {
        if (alertType == null) return "New booking";
        switch (alertType) {
            case "extension_request": return "Extension requested";
            case "order_cancelled":   return "Booking cancelled";
            case "order_completed":   return "Booking completed";
            case "reminder_10min":    return "Starting in 10 minutes";
            default:                  return "New booking";
        }
    }

    private static String extensionDetail(String extraMinutes, String extraPrice) {
        StringBuilder sb = new StringBuilder();
        if (extraMinutes != null && !extraMinutes.isEmpty()) {
            sb.append("+").append(extraMinutes).append(" min");
        }
        if (extraPrice != null && !extraPrice.isEmpty()) {
            if (sb.length() > 0) sb.append("  ·  ");
            sb.append("₹").append(extraPrice);
        }
        return sb.toString();
    }

    private void startRinging(String soundUrl) {
        if (player != null) return;
        // Remote (signed URL) sound first; fall back to the bundled raw
        // resource / device ringtone if it is missing or fails to stream.
        if (soundUrl != null && soundUrl.startsWith("http")) {
            try {
                player = new MediaPlayer();
                player.setAudioAttributes(ringAttributes());
                player.setDataSource(soundUrl);
                player.setLooping(true);
                player.setOnPreparedListener(MediaPlayer::start);
                player.setOnErrorListener((mp, what, extra) -> {
                    Log.w(TAG, "stream sound failed what=" + what + " extra=" + extra);
                    try { mp.release(); } catch (Throwable ignored) {}
                    player = null;
                    startLocalRinging();
                    return true;
                });
                player.prepareAsync();
            } catch (Throwable t) {
                Log.e(TAG, "stream sound setup failed", t);
                player = null;
                startLocalRinging();
            }
        } else {
            startLocalRinging();
        }
        startVibration();
    }

    private AudioAttributes ringAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    private void startLocalRinging() {
        if (player != null) return;
        try {
            Uri sound = customAlertUri();
            if (sound == null) {
                sound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
            }
            if (sound == null) {
                sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            player = new MediaPlayer();
            player.setAudioAttributes(ringAttributes());
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Throwable t) {
            Log.e(TAG, "ring sound failed", t);
        }
    }

    private void startVibration() {
        try {
            AudioManager am = getSystemService(AudioManager.class);
            boolean silent = am != null && am.getRingerMode() == AudioManager.RINGER_MODE_SILENT;
            vibrator = getSystemService(Vibrator.class);
            if (vibrator != null && vibrator.hasVibrator() && !silent) {
                long[] pattern = { 0, 700, 400, 700, 400 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    //noinspection deprecation
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "vibration failed", t);
        }
    }

    /** res/raw/booking_alert.* if the app ships one, else null. */
    private Uri customAlertUri() {
        int resId = getResources().getIdentifier("booking_alert", "raw", getPackageName());
        if (resId == 0) return null;
        return Uri.parse("android.resource://" + getPackageName() + "/" + resId);
    }

    private void stopRinging() {
        try {
            if (player != null) {
                if (player.isPlaying()) player.stop();
                player.release();
            }
        } catch (Throwable ignored) {
        } finally {
            player = null;
        }
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Throwable ignored) {
        } finally {
            vibrator = null;
        }
    }

    // ---------------- countdown / timeout ----------------

    private void startCountdown(int seconds) {
        if (timeoutTask != null) handler.removeCallbacks(timeoutTask);
        if (tickTask != null) handler.removeCallbacks(tickTask);

        endsAtMs = System.currentTimeMillis() + seconds * 1000L;

        tickTask = new Runnable() {
            @Override
            public void run() {
                long left = Math.max(0, (endsAtMs - System.currentTimeMillis()) / 1000L);
                if (countdownView != null) {
                    countdownView.setText(
                        BadiyoMessagingService.isInfoAlert(alertType)
                            ? "Closing in " + left + "s"
                            : "Expires in " + left + "s");
                }
                if (left > 0) handler.postDelayed(this, 1000L);
            }
        };
        handler.post(tickTask);

        timeoutTask = () -> {
            Log.d(TAG, "ring timed out for booking=" + bookingId);
            BadiyoMessagingService.cancelRingNotification(getApplicationContext());
            finishRing();
        };
        handler.postDelayed(timeoutTask, seconds * 1000L);
    }

    private void finishRing() {
        stopRinging();
        handler.removeCallbacksAndMessages(null);
        finish();
    }

    @Override
    protected void onDestroy() {
        stopRinging();
        handler.removeCallbacksAndMessages(null);
        if (dismissReceiver != null) {
            try {
                unregisterReceiver(dismissReceiver);
            } catch (Throwable ignored) {}
            dismissReceiver = null;
        }
        super.onDestroy();
    }

    private static String str(String s) {
        return s == null ? "" : s;
    }
}
