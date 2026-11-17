package app.routerhome;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.List;

/**
 * Router Home's theme (mode and accent), copied from the router pages when
 * they're open so the app's own pages and the bars around them match.
 */
final class Theme {
	private static final List<String> MODES = Arrays.asList("auto", "light", "dark", "black", "midnight");
	private static final List<String> ACCENTS = Arrays.asList("ember", "ocean", "forest", "violet", "rose", "teal", "amber");

	private Theme() { }

	private static SharedPreferences sp(Context c) {
		return c.getApplicationContext().getSharedPreferences("theme", Context.MODE_PRIVATE);
	}

	static String mode(Context c) {
		return sp(c).getString("mode", "auto");
	}

	static String accent(Context c) {
		return sp(c).getString("accent", "ember");
	}

	/** The mode actually shown: "auto" becomes light or dark like the phone. */
	static String resolved(Context c) {
		String m = mode(c);
		if (!"auto".equals(m)) return m;
		int night = c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
		return night == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
	}

	static int background(Context c) {
		switch (resolved(c)) {
			case "dark": return 0xff16181b;
			case "black": return 0xff000000;
			case "midnight": return 0xff0c1520;
			default: return 0xfff3f5f7;
		}
	}

	/**
	 * Saves what a Router Home page reported: a JSON array [mode, accent] as
	 * returned by evaluateJavascript (so a JSON string holding that JSON).
	 * Returns true if the theme changed.
	 */
	static boolean save(Context c, String jsResult) {
		try {
			if (jsResult == null || "null".equals(jsResult)) return false;
			String inner = new JSONArray("[" + jsResult + "]").getString(0);
			JSONArray a = new JSONArray(inner);
			String m = a.isNull(0) ? "auto" : a.optString(0, "auto");
			String ac = a.isNull(1) ? "ember" : a.optString(1, "ember");
			if (!MODES.contains(m)) m = "auto";
			if (!ACCENTS.contains(ac)) ac = "ember";
			if (m.equals(mode(c)) && ac.equals(accent(c))) return false;
			sp(c).edit().putString("mode", m).putString("accent", ac).apply();
			return true;
		} catch (Exception e) {
			return false;
		}
	}

	/** The script that reads Router Home's theme in a router page. */
	static final String READ = "(function(){try{return JSON.stringify([localStorage.getItem('home-theme'),localStorage.getItem('home-accent')])}catch(e){return null}})()";

	/** Status and navigation bars in the page's background color. */
	@SuppressWarnings("deprecation")
	static void bars(Activity a) {
		int bg = background(a);
		boolean light = "light".equals(resolved(a));
		Window w = a.getWindow();
		w.setStatusBarColor(bg);
		w.setNavigationBarColor(bg);
		if (Build.VERSION.SDK_INT >= 30) {
			WindowInsetsController ic = w.getInsetsController();
			if (ic != null) {
				int both = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
				ic.setSystemBarsAppearance(light ? both : 0, both);
			}
		} else {
			View d = w.getDecorView();
			int f = d.getSystemUiVisibility() & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
			if (light) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
			d.setSystemUiVisibility(f);
		}
	}

	/** window.AppTheme in the app's own pages (read-only). */
	static final class Bridge {
		private final Context c;

		Bridge(Context c) {
			this.c = c.getApplicationContext();
		}

		@JavascriptInterface
		public String get() {
			try {
				return new JSONObject().put("mode", mode(c)).put("accent", accent(c)).toString();
			} catch (Exception e) {
				return "{}";
			}
		}
	}
}
