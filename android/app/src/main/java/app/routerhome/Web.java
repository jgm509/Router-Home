package app.routerhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.util.regex.Pattern;

/** What the app's web views have in common. */
final class Web {
	/* addresses that stay in the app: private networks, .lan and .home.arpa
	 * names, localhost and IPv6 ULAs; anything else opens in the browser */
	private static final Pattern LOCAL = Pattern.compile(
			"(192\\.168\\..*|10\\..*|172\\.(1[6-9]|2[0-9]|3[01])\\..*|100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\\..*"
					+ "|.*\\.lan|.*\\.home\\.arpa|localhost|\\[?f[cd][0-9a-f:]*\\]?)",
			Pattern.CASE_INSENSITIVE);

	private Web() { }

	static WebView make(Activity a) {
		return make(a, new WebView(a));
	}

	static WebView make(Activity a, WebView w) {
		w.setBackgroundColor(Theme.background(a));
		Theme.bars(a);
		w.addJavascriptInterface(new Theme.Bridge(a), "AppTheme");
		WebSettings s = w.getSettings();
		s.setJavaScriptEnabled(true);
		s.setDomStorageEnabled(true);
		// Router Home looks for "RouterHomeApp" to know it runs inside the app
		s.setUserAgentString(s.getUserAgentString() + " RouterHomeApp/2.0");
		a.setContentView(w);
		return w;
	}

	/** After the theme changed: bars, background and the page's colors. */
	static void retheme(Activity a, WebView w) {
		Theme.bars(a);
		w.setBackgroundColor(Theme.background(a));
		w.evaluateJavascript("window.applyTheme && applyTheme()", null);
	}

	static boolean isLocal(Uri u) {
		String h = u.getHost();
		return h != null && LOCAL.matcher(h).matches();
	}

	static void openExternal(Activity a, Uri u) {
		try {
			a.startActivity(new Intent(Intent.ACTION_VIEW, u));
		} catch (ActivityNotFoundException ignored) { }
	}

	/** A string as a JavaScript string literal. */
	static String js(String s) {
		return org.json.JSONObject.quote(s == null ? "" : s);
	}
}
