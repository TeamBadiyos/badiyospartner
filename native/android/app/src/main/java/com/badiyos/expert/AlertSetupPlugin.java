package com.badiyos.expert;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Job-alert setup checks + direct settings shortcuts for the
 * "Alerts & battery" checklist screen.
 *
 * No REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission is used (Play policy):
 * we open the system battery-optimisation list and the expert picks
 * "Don't optimise" themselves.
 */
@CapacitorPlugin(name = "AlertSetup")
public class AlertSetupPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("sdkInt", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase());
        r.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        r.put("fullScreen", RingGuard.canUseFullScreenIntent(ctx));
        r.put("fullScreenRequiresSetting", Build.VERSION.SDK_INT >= 34);
        PowerManager pm = ctx.getSystemService(PowerManager.class);
        r.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        r.put("dndAccess", RingGuard.hasDndAccess(ctx));
        r.put("dndOn", RingGuard.isDndOn(ctx));
        call.resolve(r);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            if (tryStart(i)) { ok(call, true); return; }
        }
        ok(call, openAppNotificationSettings());
    }

    @PluginMethod
    public void openDndAccessSettings(PluginCall call) {
        ok(call, tryStart(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        ok(call, openAppNotificationSettings());
    }

    @PluginMethod
    public void openBatteryOptimisation(PluginCall call) {
        if (tryStart(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) { ok(call, true); return; }
        ok(call, openAppDetails());
    }

    /** kind: xiaomi_autostart | xiaomi_popup | vivo | oppo | realme | samsung */
    @PluginMethod
    public void openOemSetting(PluginCall call) {
        String kind = call.getString("kind", "");
        String pkg = getContext().getPackageName();
        boolean opened = false;
        switch (kind) {
            case "xiaomi_autostart":
                opened = tryComponent("com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity", null);
                break;
            case "xiaomi_popup": {
                // "Display pop-up windows while running in the background"
                Intent i = new Intent("miui.intent.action.APP_PERM_EDITOR");
                i.setClassName("com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity");
                i.putExtra("extra_pkgname", pkg);
                opened = tryStart(i);
                if (!opened) {
                    Intent j = new Intent("miui.intent.action.APP_PERM_EDITOR");
                    j.setClassName("com.miui.securitycenter",
                        "com.miui.permcenter.permissions.AppPermissionsEditorActivity");
                    j.putExtra("extra_pkgname", pkg);
                    opened = tryStart(j);
                }
                break;
            }
            case "vivo":
                opened = tryComponent("com.vivo.permissionmanager",
                        "com.vivo.permissionmanager.activity.BgStartUpManagerActivity", null)
                    || tryComponent("com.iqoo.secure",
                        "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager", null)
                    || tryComponent("com.vivo.permissionmanager",
                        "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity", pkg);
                break;
            case "oppo":
            case "realme":
                opened = tryComponent("com.coloros.safecenter",
                        "com.coloros.safecenter.permission.startup.StartupAppListActivity", null)
                    || tryComponent("com.coloros.safecenter",
                        "com.coloros.safecenter.startupapp.StartupAppListActivity", null)
                    || tryComponent("com.oppo.safe",
                        "com.oppo.safe.permission.startup.StartupAppListActivity", null)
                    || tryComponent("com.coloros.oppoguardelf",
                        "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity", null);
                break;
            case "samsung":
                opened = tryComponent("com.samsung.android.lool",
                        "com.samsung.android.sm.battery.ui.BatteryActivity", null)
                    || tryComponent("com.samsung.android.sm",
                        "com.samsung.android.sm.battery.ui.BatteryActivity", null);
                break;
            default:
                break;
        }
        if (!opened) opened = openAppDetails();
        ok(call, opened);
    }

    // ---------------- helpers ----------------

    private boolean tryComponent(String pkg, String cls, String extraPkg) {
        Intent i = new Intent();
        i.setComponent(new ComponentName(pkg, cls));
        if (extraPkg != null) i.putExtra("packagename", extraPkg);
        return tryStart(i);
    }

    private boolean openAppNotificationSettings() {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        return tryStart(i) || openAppDetails();
    }

    private boolean openAppDetails() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        return tryStart(i);
    }

    private boolean tryStart(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    private static void ok(PluginCall call, boolean opened) {
        JSObject r = new JSObject();
        r.put("opened", opened);
        call.resolve(r);
    }
}
