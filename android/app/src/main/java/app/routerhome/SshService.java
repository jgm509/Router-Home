package app.routerhome;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Runs in the foreground while an SSH terminal is connected, with an
 * "SSH connection open" notification. Android freezes apps a few seconds
 * after they leave the screen; a foreground service keeps the app running,
 * so the connection survives switching to another app.
 */
public class SshService extends Service {
	private static final String CHANNEL = "ssh";
	private static final Object LOCK = new Object();
	private static int open;

	static void hold(Context c) {
		synchronized (LOCK) {
			open++;
		}
		update(c);
	}

	static void release(Context c) {
		synchronized (LOCK) {
			if (open > 0) open--;
		}
		update(c);
	}

	private static void update(Context c) {
		try {
			Intent i = new Intent(c, SshService.class);
			if (count() == 0) c.stopService(i);
			else c.startForegroundService(i);
		} catch (Exception ignored) {
			// Android didn't allow it (the app is in the background): the
			// connection works, it just won't survive leaving the app
		}
	}

	private static int count() {
		synchronized (LOCK) {
			return open;
		}
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		int n = count();
		if (n == 0) {
			stopSelf();
			return START_NOT_STICKY;
		}
		NotificationManager nm = getSystemService(NotificationManager.class);
		if (nm != null && nm.getNotificationChannel(CHANNEL) == null)
			nm.createNotificationChannel(new NotificationChannel(CHANNEL, "SSH connections", NotificationManager.IMPORTANCE_LOW));

		// tapping it brings the app back as it was (the terminal on top)
		Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
		PendingIntent pi = open == null ? null
				: PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
		Notification note = new Notification.Builder(this, CHANNEL)
				.setSmallIcon(R.drawable.ic_stat_ssh)
				.setContentTitle(n == 1 ? "SSH connection open" : n + " SSH connections open")
				.setContentText("Router Home keeps it open while you use other apps.")
				.setOngoing(true)
				.setContentIntent(pi)
				.build();
		if (Build.VERSION.SDK_INT >= 34) startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
		else startForeground(1, note);
		return START_NOT_STICKY;
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}
}
