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

	/** Router Home's colors (app.css) for native screens. */
	static final class Colors {
		int bg, surface, surface2, ink, muted, line, accent, accentInk, good, warn, bad;
		boolean light;
	}

	static Colors colors(Context c) {
		Colors k = new Colors();
		String m = resolved(c);
		k.light = "light".equals(m);
		switch (m) {
			case "dark": k.bg = 0xff16181b; k.surface = 0xff1f2226; k.surface2 = 0xff272b30; k.ink = 0xffe9ecef; k.muted = 0xff9aa2ab; k.line = 0xff30353b; break;
			case "black": k.bg = 0xff000000; k.surface = 0xff101113; k.surface2 = 0xff1a1c1f; k.ink = 0xffeceff1; k.muted = 0xff8f979f; k.line = 0xff25282c; break;
			case "midnight": k.bg = 0xff0c1520; k.surface = 0xff142130; k.surface2 = 0xff101b28; k.ink = 0xffe6edf4; k.muted = 0xff8d9cab; k.line = 0xff23344a; break;
			default: k.bg = 0xfff3f5f7; k.surface = 0xffffffff; k.surface2 = 0xfff0f2f5; k.ink = 0xff161a1f; k.muted = 0xff5f6873; k.line = 0xffe2e6eb;
		}
		int[] acc; // light, dark
		switch (accent(c)) {
			case "ocean": acc = new int[] { 0xff2f6df6, 0xff5b8eff }; break;
			case "forest": acc = new int[] { 0xff15803d, 0xff4ade80 }; break;
			case "violet": acc = new int[] { 0xff7c3aed, 0xffa78bfa }; break;
			case "rose": acc = new int[] { 0xffe11d48, 0xfffb7185 }; break;
			case "teal": acc = new int[] { 0xff0f766e, 0xff2dd4bf }; break;
			case "amber": acc = new int[] { 0xffb45309, 0xfffbbf24 }; break;
			default: acc = new int[] { 0xffc2410c, 0xfffb7a3c };
		}
		if (k.light) {
			k.accent = acc[0]; k.accentInk = 0xffffffff;
			k.good = 0xff1f8a5b; k.warn = 0xffc98a06; k.bad = 0xffd9373d;
		} else {
			k.accent = acc[1]; k.accentInk = 0xff14100c;
			k.good = 0xff3fbf86; k.warn = 0xfff0b429; k.bad = 0xffff5c61;
		}
		return k;
	}

	static String hex(int color) {
		return String.format("#%06x", color & 0xffffff);
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
