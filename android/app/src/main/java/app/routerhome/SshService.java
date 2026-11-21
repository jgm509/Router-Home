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
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * Runs in the foreground while an SSH terminal is connected, with an
 * "SSH connection open" notification. Android freezes apps a few seconds
 * after they leave the screen; a foreground service keeps the app running,
 * so the connection survives switching to another app.
 *
 * A service started with startForegroundService() must call startForeground()
 * even if it's no longer needed, or Android crashes the app ("did not then
 * call Service.startForeground()"). So the service always goes to the
 * foreground first and only then stops itself, and nothing outside it calls
 * stopService(): a connection that closes right after opening is safe.
 */
public class SshService extends Service {
	private static final String CHANNEL = "ssh";
	private static final Object LOCK = new Object();
	private static final Handler MAIN = new Handler(Looper.getMainLooper());
	private static int open;
	/* the running service, touched on the main thread only */
	private static SshService running;

	static void hold(Context c) {
		synchronized (LOCK) {
			open++;
		}
		Context app = c.getApplicationContext();
		MAIN.post(() -> {
			if (running != null) {
				running.refresh();
				return;
			}
			try {
				app.startForegroundService(new Intent(app, SshService.class));
			} catch (Exception ignored) {
				// Android didn't allow it (the app is in the background): the
				// connection works, it just won't survive leaving the app
			}
		});
	}

	static void release(Context c) {
		synchronized (LOCK) {
			if (open > 0) open--;
		}
		// a service still starting stops itself in onStartCommand
		MAIN.post(() -> {
			if (running != null) running.refresh();
		});
	}

	private static int count() {
		synchronized (LOCK) {
			return open;
		}
	}

	@Override
	public void onCreate() {
		super.onCreate();
		running = this;
	}

	@Override
	public void onDestroy() {
		if (running == this) running = null;
		super.onDestroy();
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		// always, even when about to stop: see the class comment
		int n = Math.max(1, count());
		Notification note = notification(n);
		if (Build.VERSION.SDK_INT >= 34) startForeground(1, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
		else startForeground(1, note);
		refresh();
		return START_NOT_STICKY;
	}

	/** Updates the count in the notification, or stops when nothing is open. */
	private void refresh() {
		int n = count();
		if (n == 0) {
			stopForeground(STOP_FOREGROUND_REMOVE);
			stopSelf();
			return;
		}
		NotificationManager nm = getSystemService(NotificationManager.class);
		if (nm != null) nm.notify(1, notification(n));
	}

	private Notification notification(int n) {
		NotificationManager nm = getSystemService(NotificationManager.class);
		if (nm != null && nm.getNotificationChannel(CHANNEL) == null)
			nm.createNotificationChannel(new NotificationChannel(CHANNEL, "SSH connections", NotificationManager.IMPORTANCE_LOW));

		// tapping it brings the app back as it was (the terminal on top)
		Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
		PendingIntent pi = launch == null ? null
				: PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
		return new Notification.Builder(this, CHANNEL)
				.setSmallIcon(R.drawable.ic_stat_ssh)
				.setContentTitle(n == 1 ? "SSH connection open" : n + " SSH connections open")
				.setContentText("Router Home keeps it open while you use other apps.")
				.setOngoing(true)
				.setContentIntent(pi)
				.build();
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}
}
