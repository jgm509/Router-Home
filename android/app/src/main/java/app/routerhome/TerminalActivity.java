package app.routerhome;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * An SSH terminal to one router. The terminal itself is xterm.js in a web
 * view (assets/terminal.html); the SSH connection is JSch. The router's host
 * key is kept with the router (HostKeys), and its saved password is used to
 * sign in.
 */
public class TerminalActivity extends Activity {
	static {
		// JSch picks Java's own Ed25519/X25519 on desktop Java; Android has
		// neither, so use the Bouncy Castle versions bundled with the app
		JSch.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519");
		JSch.setConfig("ssh-ed448", "com.jcraft.jsch.bc.SignatureEd448");
		JSch.setConfig("keypairgen.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA");
		JSch.setConfig("xdh", "com.jcraft.jsch.bc.XDH");
	}

	private WebView web;
	private Routers store;
	private String id, name, host, user;
	private int port;

	private final ExecutorService io = Executors.newSingleThreadExecutor();
	private volatile Session session;
	private volatile ChannelShell shell;
	private volatile OutputStream out;
	private volatile boolean connecting, closed;
	private volatile int cols = 80, rows = 24;

	@Override
	protected void onCreate(Bundle state) {
		super.onCreate(state);
		store = new Routers(this);
		id = getIntent().getStringExtra("id");
		JSONObject r = id == null ? null : store.get(id);
		if (r == null) { finish(); return; }
		name = r.optString("name");
		host = Routers.host(r.optString("addr"));
		user = r.optString("user", "root");
		port = r.optInt("sshPort", 22);
		setTitle(name + " (SSH)");
		getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

		web = Web.make(this, new TermView(this));
		web.addJavascriptInterface(new Term(), "Term");
		web.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
				Uri u = req.getUrl();
				if (!"file".equals(u.getScheme())) Web.openExternal(TerminalActivity.this, u);
				return true;
			}
		});
		web.loadUrl("file:///android_asset/terminal.html");
	}

	@Override
	protected void onDestroy() {
		closed = true;
		CountDownLatch l = waiting;
		if (l != null) l.countDown();
		disconnect();
		io.shutdown();
		if (web != null) web.destroy();
		super.onDestroy();
	}

	/* The phone keyboard as a terminal keyboard: no suggestions, no
	 * autocorrect, and every key sent at once. Keyboards otherwise hold a
	 * word being typed ("composing") and only send it at the end, which
	 * breaks Ctrl+key and moves a floating letter around the screen. */
	private static final class TermView extends WebView {
		TermView(android.content.Context c) {
			super(c);
		}

		@Override
		public InputConnection onCreateInputConnection(EditorInfo out) {
			InputConnection ic = super.onCreateInputConnection(out);
			out.inputType = InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
					| InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
			out.imeOptions |= EditorInfo.IME_FLAG_NO_FULLSCREEN | EditorInfo.IME_FLAG_NO_EXTRACT_UI
					| EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
			return ic;
		}
	}

	/* ---------------- talking to the page ---------------- */

	private void js(String code) {
		runOnUiThread(() -> {
			if (!closed && web != null) web.evaluateJavascript(code, null);
		});
	}

	private void print(String text) {
		js("say(" + Web.js(text) + ")");
	}

	/** window.Term in terminal.html */
	private final class Term {
		@JavascriptInterface
		public String title() {
			return name + "\n" + user + "@" + host + (port == 22 ? "" : ":" + port);
		}

		@JavascriptInterface
		public void ready(int c, int r) {
			cols = c;
			rows = r;
			connect();
		}

		@JavascriptInterface
		public void input(String s) {
			final OutputStream o = out;
			if (o == null || s == null) return;
			final byte[] b = s.getBytes(StandardCharsets.UTF_8);
			io.execute(() -> {
				try {
					o.write(b);
					o.flush();
				} catch (Exception ignored) { }
			});
		}

		@JavascriptInterface
		public void resize(int c, int r) {
			if (c < 2 || r < 2) return;
			cols = c;
			rows = r;
			final ChannelShell ch = shell;
			if (ch != null) io.execute(() -> ch.setPtySize(c, r, 0, 0));
		}

		/** The answer to askPassword / askYesNo. */
		@JavascriptInterface
		public void answer(String v) {
			CountDownLatch l = waiting;
			if (l == null) return;
			answer = v;
			l.countDown();
		}

		/** The clipboard's text, for the Paste key. */
		@JavascriptInterface
		public String clipboard() {
			try {
				ClipboardManager cm = getSystemService(ClipboardManager.class);
				ClipData c = cm == null ? null : cm.getPrimaryClip();
				if (c == null || c.getItemCount() == 0) return "";
				CharSequence t = c.getItemAt(0).coerceToText(TerminalActivity.this);
				return t == null ? "" : t.toString();
			} catch (Exception e) {
				return "";
			}
		}

		@JavascriptInterface
		public void reconnect() {
			connect();
		}

		@JavascriptInterface
		public void close() {
			runOnUiThread(TerminalActivity.this::finish);
		}
	}

	/* ---------------- the connection ---------------- */

	private synchronized void connect() {
		if (connecting || closed) return;
		connecting = true;
		new Thread(this::run, "ssh").start();
	}

	private void disconnect() {
		final Session s = session;
		final ChannelShell ch = shell;
		session = null;
		shell = null;
		out = null;
		// disconnecting sends a packet: never on the main thread
		new Thread(() -> {
			try { if (ch != null) ch.disconnect(); } catch (Exception ignored) { }
			try { if (s != null) s.disconnect(); } catch (Exception ignored) { }
		}).start();
	}

	private void run() {
		try {
			disconnect();
			js("state('connecting')");
			print("Connecting to " + user + "@" + host + (port == 22 ? "" : ":" + port) + "…\r\n");
			String pw = store.password(id);
			boolean fromStore = pw != null, remember = false;

			for (int attempt = 0; attempt < 4 && !closed; attempt++) {
				if (pw == null) {
					String[] a = askPassword(attempt > 0);
					if (a == null) {
						print("\r\nNot connected.\r\n");
						js("state('ended')");
						return;
					}
					pw = a[0];
					remember = a[1] != null;
					fromStore = false;
				}
				JSch jsch = new JSch();
				HostKeys keys = new HostKeys(store, id);
				jsch.setHostKeyRepository(keys);
				Session s = jsch.getSession(user, host, port);
				s.setPassword(pw);
				s.setUserInfo(new Asker(keys, pw));
				s.setConfig("StrictHostKeyChecking", "ask");
				s.setConfig("PreferredAuthentications", "password,keyboard-interactive");
				s.setServerAliveInterval(30000);
				try {
					s.connect(10000);
				} catch (JSchException e) {
					if (isAuthFailure(e)) {
						print(fromStore ? "The saved password didn't work.\r\n" : "Wrong password.\r\n");
						if (fromStore) store.setPassword(id, null);
						pw = null;
						continue;
					}
					throw e;
				}
				if (remember) store.setPassword(id, pw);
				session = s;
				openShell(s);
				return;
			}
			if (!closed) {
				print("\r\nNot connected.\r\n");
				js("state('ended')");
			}
		} catch (Exception e) {
			if (!closed) {
				print("\r\n" + explain(e) + "\r\n");
				js("state('ended')");
			}
		} finally {
			connecting = false;
		}
	}

	private void openShell(Session s) throws Exception {
		ChannelShell ch = (ChannelShell) s.openChannel("shell");
		ch.setPtyType("xterm-256color", cols, rows, 0, 0);
		InputStream in = ch.getInputStream();
		out = ch.getOutputStream();
		ch.connect(10000);
		shell = ch;
		js("state('connected')");
		byte[] buf = new byte[16384];
		try {
			int n;
			while ((n = in.read(buf)) >= 0) {
				if (n == 0) continue;
				String b64 = android.util.Base64.encodeToString(buf, 0, n, android.util.Base64.NO_WRAP);
				js("recv('" + b64 + "')");
			}
		} catch (java.io.IOException ignored) {
			// the connection dropped
		}
		if (closed) return;
		out = null;
		shell = null;
		print("\r\n[Connection closed]\r\n");
		js("state('ended')");
	}

	private static boolean isAuthFailure(JSchException e) {
		String m = String.valueOf(e.getMessage());
		return m.contains("Auth fail") || m.contains("Auth cancel") || m.contains("Too many authentication failures");
	}

	private String explain(Exception e) {
		String m = String.valueOf(e.getMessage());
		// JSch's words when the key question is answered with Cancel
		if (m.startsWith("reject HostKey") || m.startsWith("HostKey has been changed"))
			return "Not connected: the router's key wasn't accepted.";
		Throwable c = e.getCause() != null ? e.getCause() : e;
		if (c instanceof UnknownHostException) return "Can't find " + host + ". Check the router's address.";
		if (c instanceof ConnectException)
			return "The router refused the connection on port " + port + ". Is SSH turned on (System → Administration → SSH Access in LuCI)?";
		if (c instanceof SocketTimeoutException || c instanceof NoRouteToHostException
				|| m.contains("timeout"))
			return "No answer from " + host + ". Is the phone on the router's network?";
		return "Could not connect: " + (c.getMessage() != null ? c.getMessage() : c.toString());
	}

	/* ---------------- questions, shown as sheets in the page ---------------- */

	private final Object askLock = new Object();
	private volatile CountDownLatch waiting;
	private volatile String answer;

	/** Runs a page function that asks something and waits for Term.answer(). */
	private String ask(String call) {
		synchronized (askLock) {
			CountDownLatch l = new CountDownLatch(1);
			answer = null;
			waiting = l;
			js(call);
			try {
				l.await();
			} catch (InterruptedException e) {
				return null;
			} finally {
				waiting = null;
			}
			return answer;
		}
	}

	/** {password, remember ? "1" : null}, or null if cancelled. */
	private String[] askPassword(boolean again) {
		try {
			JSONObject o = new JSONObject();
			o.put("title", again ? "Try the password again" : "Sign in to " + name);
			o.put("user", user);
			String a = ask("askPassword(" + o + ")");
			if (a == null || "null".equals(a)) return null;
			JSONObject r = new JSONObject(a);
			return new String[] { r.optString("pw"), r.optBoolean("remember") ? "1" : null };
		} catch (Exception e) {
			return null;
		}
	}

	private boolean askYesNo(String title, String text, String detail, String yes, boolean danger) {
		try {
			JSONObject o = new JSONObject();
			o.put("title", title);
			o.put("text", text);
			if (detail != null) o.put("detail", detail);
			o.put("yes", yes);
			o.put("danger", danger);
			return "true".equals(ask("askYesNo(" + o + ")"));
		} catch (Exception e) {
			return false;
		}
	}

	@Override
	public void onBackPressed() {
		web.evaluateJavascript("window.back ? back() : false", v -> {
			if (!"true".equals(v)) finish();
		});
	}

	/** JSch's questions, in plain words. */
	private final class Asker implements UserInfo, UIKeyboardInteractive {
		private final HostKeys keys;
		private final String pw;

		Asker(HostKeys keys, String pw) {
			this.keys = keys;
			this.pw = pw;
		}

		@Override
		public boolean promptYesNo(String message) {
			if (keys.found == HostKeys.NEW)
				return askYesNo("Trust " + name + "?",
						"This is the first SSH connection to " + name + ". Router Home will remember its key, so next time it can tell it's the same router.",
						keys.foundType + "\n" + keys.foundFp, "Trust", false);
			if (keys.found == HostKeys.CHANGED_KEY)
				return askYesNo(name + "'s key changed",
						"The router answered with a different SSH key than last time. That's normal after a reflash or a reset. If you didn't do that, don't connect: another device may be answering in its place.",
						"Saved: " + keys.savedFp + "\nNow:   " + keys.foundType + " " + keys.foundFp, "Replace key", true);
			return askYesNo("SSH", message, null, "Continue", false);
		}

		@Override
		public String[] promptKeyboardInteractive(String dest, String nm, String instruction, String[] prompt, boolean[] echo) {
			String[] r = new String[prompt.length];
			for (int i = 0; i < prompt.length; i++) {
				if (echo[i]) return null;
				r[i] = pw;
			}
			return r;
		}

		@Override public String getPassphrase() { return null; }
		@Override public String getPassword() { return pw; }
		@Override public boolean promptPassword(String message) { return pw != null; }
		@Override public boolean promptPassphrase(String message) { return false; }
		@Override public void showMessage(String message) { print(message.replace("\n", "\r\n") + "\r\n"); }
	}
}
