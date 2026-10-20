package com.badiyos.expert;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

/**
 * Play-Store-safe helpers for the loud job ring.
 *
 *  - Alarm volume is saved to disk BEFORE it is boosted and restored when the
 *    ring stops. If the process dies mid-ring, {@link #restoreIfPending} (called
 *    on every app / service start) puts the expert's own volume back.
 *  - Volume is never touched while Do Not Disturb is on unless the expert has
 *    granted Notification Policy (DND) access.
 */
final class RingGuard {

    private static final String TAG = "BadiyoRingGuard";
    private static final String PREFS = "badiyo_ring_prefs";
    private static final String KEY_VOLUME = "original_alarm_volume";

    private RingGuard() {}

    /** Android 14+: whether full-screen intents are allowed. Older = always true. */
    static boolean canUseFullScreenIntent(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        try {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            return nm != null && nm.canUseFullScreenIntent();
        } catch (Throwable t) {
            return false;
        }
    }

    static boolean hasDndAccess(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }

    /** True when Do Not Disturb is filtering anything (priority / alarms / none). */
    static boolean isDndOn(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        int f = nm.getCurrentInterruptionFilter();
        return f != NotificationManager.INTERRUPTION_FILTER_ALL
            && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
    }

    /** Boost the alarm stream to max. Saves the original level to disk first. */
    static void boostAlarmVolume(Context ctx) {
        try {
            if (isDndOn(ctx) && !hasDndAccess(ctx)) {
                Log.d(TAG, "DND on without policy access — not changing volume");
                return;
            }
            AudioManager am = ctx.getSystemService(AudioManager.class);
            if (am == null) return;
            SharedPreferences p = prefs(ctx);
            if (!p.contains(KEY_VOLUME)) {
                int current = am.getStreamVolume(AudioManager.STREAM_ALARM);
                // commit(): must be on disk before we change anything.
                p.edit().putInt(KEY_VOLUME, current).commit();
            }
            am.setStreamVolume(AudioManager.STREAM_ALARM,
                am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
        } catch (Throwable t) {
            Log.w(TAG, "volume boost failed", t);
        }
    }

    /** Restore the saved alarm volume (if any) and clear the saved value. */
    static void restoreIfPending(Context ctx) {
        try {
            SharedPreferences p = prefs(ctx);
            if (!p.contains(KEY_VOLUME)) return;
            int saved = p.getInt(KEY_VOLUME, -1);
            AudioManager am = ctx.getSystemService(AudioManager.class);
            if (am != null && saved >= 0) {
                am.setStreamVolume(AudioManager.STREAM_ALARM, saved, 0);
            }
            p.edit().remove(KEY_VOLUME).commit();
        } catch (Throwable t) {
            Log.w(TAG, "volume restore failed", t);
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
