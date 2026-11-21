package app.routerhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * One router's Router Home (http://<router>/home/). With a saved password the
 * app signs in first and hands the session to the page, so the sign-in screen
 * is skipped.
 */
public class RouterActivity extends Activity {
	private static final int PICK_FILE = 1;
	private static final String OFFLINE = "file:///android_asset/offline.html";

	private WebView web;
	private Routers store;
	private String id, name, addr, user, home;
	private ValueCallback<Uri[]> upload;
	private ScriptHandler pageScript;
	private boolean clearHistory;

	@Override
	protected void onCreate(Bundle state) {
		super.onCreate(state);
		store = new Routers(this);
		id = getIntent().getStringExtra("id");
		JSONObject r = id == null ? null : store.get(id);
		if (r == null) { finish(); return; }
		name = r.optString("name");
		addr = r.optString("addr");
		user = r.optString("user", "root");
		home = "http://" + addr + "/home/";
		setTitle(name);

		web = Web.make(this);
		web.addJavascriptInterface(new Bridge(), "RouterHomeApp");
		web.setWebViewClient(new Client());
		web.setWebChromeClient(new Chrome());
		// Always sign in fresh, even when Android recreates this screen after
		// killing the app in the background: restoring the old page skipped the
		// page scripts (signing out didn't go back to the list) and the session
		// handed to the page was gone with the app, so it showed the sign-in.
		signInAndLoad();
	}

	@Override
	public void onBackPressed() {
		String url = web.getUrl();
		if (url != null && !url.startsWith(OFFLINE) && web.canGoBack()) web.goBack();
		else finish();
	}

	/* ---------------- signing in ---------------- */

	private void signInAndLoad() {
		String pw = store.password(id);
		if (pw == null) { pageScripts(null); load(); return; }
		new Thread(() -> {
			String sid = login(pw);
			runOnUiThread(() -> {
				if (isFinishing() || isDestroyed()) return;
				pageScripts(sid != null && !sid.isEmpty() ? sid : null);
				if (sid != null && sid.isEmpty())
					Toast.makeText(this, "The saved password didn't work. Sign in, then update it in the router list.", Toast.LENGTH_LONG).show();
				load();
			});
		}).start();
	}

	private void load() {
		clearHistory = true;
		web.loadUrl(home);
	}

	/** ubus session login: the session id, "" if the router said no, null if it didn't answer. */
	private String login(String pw) {
		HttpURLConnection c = null;
		try {
			JSONObject p = new JSONObject();
			p.put("username", user);
			p.put("password", pw);
			p.put("timeout", 3600);
			JSONObject body = new JSONObject();
			body.put("jsonrpc", "2.0");
			body.put("id", 1);
			body.put("method", "call");
			body.put("params", new JSONArray().put("00000000000000000000000000000000").put("session").put("login").put(p));

			c = (HttpURLConnection) new URL("http://" + addr + "/ubus").openConnection();
			c.setConnectTimeout(4000);
			c.setReadTimeout(8000);
			c.setDoOutput(true);
			c.setRequestMethod("POST");
			c.setRequestProperty("Content-Type", "application/json");
			try (OutputStream o = c.getOutputStream()) {
				o.write(body.toString().getBytes(StandardCharsets.UTF_8));
			}
			if (c.getResponseCode() != 200) return null;
			String text;
			try (InputStream in = c.getInputStream()) {
				text = new String(readAll(in), StandardCharsets.UTF_8);
			}
			JSONArray res = new JSONObject(text).optJSONArray("result");
			if (res == null) return null;
			JSONObject data = res.optInt(0, -1) == 0 ? res.optJSONObject(1) : null;
			return data != null ? data.optString("ubus_rpc_session", "") : "";
		} catch (Exception e) {
			return null;
		} finally {
			if (c != null) c.disconnect();
		}
	}

	/* Scripts that run in Router Home's pages before their own scripts:
	 * - signing out (Router Home ends its session with ubus session.destroy)
	 *   goes back to the router list
	 * - with a fresh session from the saved password, the page gets it in
	 *   sessionStorage "home-sid", once: after signing out it isn't reused */
	private static final String SIGNOUT_HOOK = "(function(){var f=window.fetch;window.fetch=function(u,o){"
			+ "try{if(o&&typeof o.body==='string'&&o.body.indexOf('\"session\",\"destroy\"')>0&&window.RouterHomeApp)"
			+ "setTimeout(function(){RouterHomeApp.signedOut()},300)}catch(e){}return f.apply(this,arguments)}})();";

	private void pageScripts(String sid) {
		if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
		if (pageScript != null) pageScript.remove();
		String js = "if(location.pathname.indexOf('/home')===0){" + SIGNOUT_HOOK;
		if (sid != null)
			js += "try{if(!sessionStorage.getItem('app-sid')){sessionStorage.setItem('app-sid','1');"
					+ "sessionStorage.setItem('home-sid'," + Web.js(sid) + ")}}catch(e){}";
		js += "}";
		try {
			pageScript = WebViewCompat.addDocumentStartJavaScript(web, js, Collections.singleton("http://" + addr));
		} catch (IllegalArgumentException e) {
			pageScript = null;	// an address the origin rules don't accept: sign in by hand
		}
	}

	private static byte[] readAll(InputStream in) throws java.io.IOException {
		java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
		byte[] buf = new byte[8192];
		int n;
		while ((n = in.read(buf)) > 0) {
			b.write(buf, 0, n);
			if (b.size() > 65536) break;
		}
		return b.toByteArray();
	}

	/* Router Home keeps its theme in the page's storage: copy it, so the
	 * bars and the app's own screens use the same colors */
	private void readTheme() {
		String url = web.getUrl();
		if (url == null || !url.startsWith("http")) return;
		web.evaluateJavascript(Theme.READ, v -> {
			if (Theme.save(this, v)) Web.retheme(this, web);
		});
	}

	@Override
	protected void onPause() {
		if (web != null) readTheme();
		super.onPause();
	}

	/* ---------------- web view ---------------- */

	private final class Client extends WebViewClient {
		@Override
		public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
			Uri u = req.getUrl();
			if ("file".equals(u.getScheme()) || Web.isLocal(u) || addr.equalsIgnoreCase(u.getAuthority())) return false;
			Web.openExternal(RouterActivity.this, u);
			return true;
		}

		@Override
		public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
			if (!req.isForMainFrame() || "file".equals(req.getUrl().getScheme())) return;
			v.loadUrl(OFFLINE + "#" + Uri.encode(name + "\n" + addr));
		}

		@Override
		public void onPageFinished(WebView v, String url) {
			if (url == null || !url.startsWith("http")) return;
			if (clearHistory) {
				clearHistory = false;
				v.clearHistory();
			}
			readTheme();
		}
	}

	private final class Chrome extends WebChromeClient {
		@Override
		public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
			if (upload != null) upload.onReceiveValue(null);
			upload = cb;
			Intent i = new Intent(Intent.ACTION_GET_CONTENT);
			i.addCategory(Intent.CATEGORY_OPENABLE);
			i.setType("*/*");
			try {
				startActivityForResult(Intent.createChooser(i, null), PICK_FILE);
				return true;
			} catch (ActivityNotFoundException e) {
				upload = null;
				return false;
			}
		}
	}

	@Override
	protected void onActivityResult(int req, int result, Intent data) {
		if (req == PICK_FILE) {
			if (upload != null) upload.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
			upload = null;
			return;
		}
		super.onActivityResult(req, result, data);
	}

	@Override
	protected void onDestroy() {
		if (web != null) web.destroy();
		super.onDestroy();
	}

	/** window.RouterHomeApp: in Router Home's pages and the offline page. */
	private final class Bridge {
		/** Saves a file (base64) to Downloads; Router Home uses it for backups. */
		@JavascriptInterface
		public boolean saveFile(String fileName, String mime, String b64) {
			try {
				byte[] data = Base64.decode(b64, Base64.DEFAULT);
				ContentValues v = new ContentValues();
				v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
				v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
				v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/");
				ContentResolver cr = getContentResolver();
				Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
				if (u == null) return false;
				try (OutputStream o = cr.openOutputStream(u)) {
					if (o == null) return false;
					o.write(data);
				}
				return true;
			} catch (Exception e) {
				return false;
			}
		}

		/** Signed out of Router Home: back to the router list. */
		@JavascriptInterface
		public void signedOut() {
			runOnUiThread(RouterActivity.this::finish);
		}

		@JavascriptInterface
		public void retry() {
			runOnUiThread(RouterActivity.this::signInAndLoad);
		}

		@JavascriptInterface
		public void routers() {
			runOnUiThread(RouterActivity.this::finish);
		}

		@JavascriptInterface
		public void ssh() {
			runOnUiThread(() -> startActivity(new Intent(RouterActivity.this, TerminalActivity.class).putExtra("id", id)));
		}
	}
}
