package com.badiyos.expert;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service (type mediaPlayback) that owns the looping job alarm.
 *
 * Started ONLY from {@link BadiyoMessagingService} when a high-priority FCM
 * data message arrives (the Android 12+ background-start exemption) or from
 * the visible {@link BookingRingActivity}. Stops on accept / reject /
 * timeout / "already taken" via {@link #stop(Context)}.
 */
public class BookingRingService extends Service {

    private static final String TAG = "BadiyoRingSvc";

    static final String ACTION_START = "com.badiyos.expert.action.RING_START";
    static final String ACTION_STOP = "com.badiyos.expert.action.RING_STOP";
    static final String EXTRA_NOTIFICATION = "ring_notification";
    static final String EXTRA_SOUND_URL = "sound_url";
    static final String EXTRA_TIMEOUT_MS = "timeout_ms";
    static final String EXTRA_BOOKING_ID = "booking_id";

    private static volatile boolean running = false;
    private static volatile String currentBookingId = "";

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());

    static boolean isRunning() { return running; }

    /** Returns false when Android refused to start the service. */
    static boolean start(Context ctx, Notification n, String bookingId, String soundUrl, long timeoutMs) {
        try {
            Intent i = new Intent(ctx, BookingRingService.class);
            i.setAction(ACTION_START);
            if (n != null) i.putExtra(EXTRA_NOTIFICATION, n);
            i.putExtra(EXTRA_BOOKING_ID, bookingId == null ? "" : bookingId);
            i.putExtra(EXTRA_SOUND_URL, soundUrl == null ? "" : soundUrl);
            i.putExtra(EXTRA_TIMEOUT_MS, timeoutMs);
            ContextCompat.startForegroundService(ctx, i);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "start refused", t);
            return false;
        }
    }

    static void stop(Context ctx) {
        if (!running) {
            RingGuard.restoreIfPending(ctx);
            return;
        }
        try {
            ctx.stopService(new Intent(ctx, BookingRingService.class));
        } catch (Throwable t) {
            Log.w(TAG, "stop failed", t);
        }
    }

    /** Stop only if the ring belongs to this booking (empty id = any). */
    static void stopFor(Context ctx, String bookingId) {
        if (bookingId == null || bookingId.isEmpty() || bookingId.equals(currentBookingId)) stop(ctx);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // A previous ring may have died with the volume boosted.
        RingGuard.restoreIfPending(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = intent != null ? intent.getParcelableExtra(EXTRA_NOTIFICATION) : null;
        if (n == null) n = fallbackNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(BadiyoMessagingService.RING_NOTIFICATION_ID, n,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(BadiyoMessagingService.RING_NOTIFICATION_ID, n);
            }
        } catch (Throwable t) {
            Log.e(TAG, "startForeground failed", t);
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        currentBookingId = intent != null ? str(intent.getStringExtra(EXTRA_BOOKING_ID)) : "";
        long timeoutMs = intent != null ? intent.getLongExtra(EXTRA_TIMEOUT_MS, 60_000L) : 60_000L;
        if (timeoutMs <= 0) timeoutMs = 60_000L;

        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(() -> {
            Log.d(TAG, "ring timeout");
            BookingRingActivity.dismissIfShowing(getApplicationContext(), "");
            stopSelf();
        }, timeoutMs);

        if (player == null) {
            acquireWakeLock(timeoutMs);
            RingGuard.boostAlarmVolume(this);
            startSound(intent != null ? str(intent.getStringExtra(EXTRA_SOUND_URL)) : "");
            startVibration();
        }
        // Never restart after being killed — an old offer must not ring again.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try { if (player != null) { if (player.isPlaying()) player.stop(); player.release(); } } catch (Throwable ignored) {}
        player = null;
        try { if (vibrator != null) vibrator.cancel(); } catch (Throwable ignored) {}
        vibrator = null;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Throwable ignored) {}
        wakeLock = null;
        RingGuard.restoreIfPending(this);
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(BadiyoMessagingService.RING_NOTIFICATION_ID);
        } catch (Throwable ignored) {}
        running = false;
        currentBookingId = "";
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away: stop and restore volume.
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ---------------- sound ----------------

    private AudioAttributes attrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    private void startSound(String soundUrl) {
        Uri local = customAlertUri();
        if (local == null && soundUrl.startsWith("http")) {
            try {
                player = new MediaPlayer();
                player.setAudioAttributes(attrs());
                player.setDataSource(soundUrl);
                player.setLooping(true);
                player.setOnPreparedListener(MediaPlayer::start);
                player.setOnErrorListener((mp, w, e) -> {
                    try { mp.release(); } catch (Throwable ignored) {}
                    player = null;
                    startLocal();
                    return true;
                });
                player.prepareAsync();
                return;
            } catch (Throwable t) {
                player = null;
            }
        }
        startLocal();
    }

    private void startLocal() {
        if (player != null) return;
        try {
            Uri sound = customAlertUri();
            if (sound == null) sound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            player = new MediaPlayer();
            player.setAudioAttributes(attrs());
            player.setDataSource(this, sound);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Throwable t) {
            Log.e(TAG, "ring sound failed", t);
        }
    }

    private Uri customAlertUri() {
        int resId = getResources().getIdentifier("booking_alert", "raw", getPackageName());
        if (resId == 0) return null;
        return Uri.parse("android.resource://" + getPackageName() + "/" + resId);
    }

    private void startVibration() {
        try {
            vibrator = getSystemService(Vibrator.class);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = { 0, 700, 400, 700, 400 };
            if (Build.VERSION.SDK_INT >= 26) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                //noinspection deprecation
                vibrator.vibrate(pattern, 0);
            }
        } catch (Throwable t) {
            Log.w(TAG, "vibration failed", t);
        }
    }

    private void acquireWakeLock(long timeoutMs) {
        try {
            if (wakeLock != null) return;
            PowerManager pm = getSystemService(PowerManager.class);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "badiyo:ringsvc");
            wakeLock.acquire(timeoutMs + 5_000L);
        } catch (Throwable t) {
            Log.w(TAG, "wakelock failed", t);
        }
    }

    private Notification fallbackNotification() {
        return new NotificationCompat.Builder(this, BadiyoMessagingService.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle("New job")
            .setContentText("Tap to view")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setSilent(true)
            .build();
    }

    private static String str(String s) { return s == null ? "" : s; }
}
