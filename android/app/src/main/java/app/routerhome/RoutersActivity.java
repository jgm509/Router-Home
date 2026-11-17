package app.routerhome;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * The first screen: the list of routers (assets/routers.html). Only this page
 * gets the "RH" bridge, which can change the saved routers; router pages run
 * in RouterActivity's own web view and never see it.
 */
public class RoutersActivity extends Activity {
	private WebView web;
	private Routers store;
	private boolean loaded;

	@Override
	protected void onCreate(Bundle state) {
		super.onCreate(state);
		store = new Routers(this);
		web = Web.make(this);
		web.addJavascriptInterface(new Api(), "RH");
		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
				Uri u = req.getUrl();
				if ("file".equals(u.getScheme())) return false;
				Web.openExternal(RoutersActivity.this, u);
				return true;
			}

			@Override
			public void onPageFinished(WebView v, String url) {
				loaded = true;
			}
		});
		web.loadUrl("file:///android_asset/routers.html");
	}

	@Override
	protected void onResume() {
		super.onResume();
		// back from a router or a terminal: a password, a key or the theme may have changed
		if (!loaded) return;
		Web.retheme(this, web);
		web.evaluateJavascript("window.refresh && refresh()", null);
	}

	@Override
	public void onBackPressed() {
		web.evaluateJavascript("window.back ? back() : false", v -> {
			if (!"true".equals(v)) finish();
		});
	}

	private void start(Class<?> c, String id) {
		if (store.get(id) == null) return;
		runOnUiThread(() -> startActivity(new Intent(this, c).putExtra("id", id)));
	}

	/** window.RH in routers.html */
	private final class Api {
		@JavascriptInterface
		public String list() {
			return store.forPage().toString();
		}

		/** Returns the router's id, or "" if it couldn't be saved. */
		@JavascriptInterface
		public String save(String json) {
			try {
				return store.save(new JSONObject(json));
			} catch (Exception e) {
				return "";
			}
		}

		@JavascriptInterface
		public void remove(String id) {
			store.remove(id);
		}

		@JavascriptInterface
		public void forgetKey(String id) {
			store.clearHostKey(id);
		}

		@JavascriptInterface
		public void open(String id) {
			start(RouterActivity.class, id);
		}

		@JavascriptInterface
		public void ssh(String id) {
			start(TerminalActivity.class, id);
		}
	}
}
