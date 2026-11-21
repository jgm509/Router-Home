package app.routerhome;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.jcraft.jsch.ChannelShell;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;
import com.termux.terminal.KeyHandler;
import com.termux.terminal.TerminalColors;
import com.termux.terminal.TerminalSession;
import com.termux.terminal.TerminalSessionClient;
import com.termux.view.TerminalView;
import com.termux.view.TerminalViewClient;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.Properties;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * An SSH terminal to one router. The screen is Termux's terminal view (native:
 * touch-and-hold to select and copy, pinch to zoom, real keyboard handling);
 * the connection is JSch. The router's host key is kept with the router
 * (HostKeys), and its saved password is used to sign in.
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

	private static final int MIN_SIZE = 9, MAX_SIZE = 24, DEFAULT_SIZE = 14;

	private Routers store;
	private String id, name, host, user;
	private int port;

	/* the screen */
	private Theme.Colors colors;
	private LinearLayout root, header, keyRow;
	private HorizontalScrollView keyBar;
	private View statusDot, line1, line2;
	private TextView titleView, subView;
	private Button again, ctrlKey;
	private final java.util.List<Button> keys = new java.util.ArrayList<>();
	private TerminalView term;
	private TerminalSession tsession;
	private int textSize;
	private boolean ctrl, started;

	/* the connection */
	private final ExecutorService io = Executors.newSingleThreadExecutor();
	private volatile Session session;
	private volatile ChannelShell shell;
	private volatile OutputStream out;
	private volatile boolean connecting, closed;

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
		// the "SSH connection open" notification, to come back to the terminal
		if (Build.VERSION.SDK_INT >= 33
				&& checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
			requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 2);

		textSize = prefs().getInt("size", DEFAULT_SIZE);
		buildScreen();
		applyTheme();
		term.requestFocus();
	}

	@Override
	protected void onDestroy() {
		closed = true;
		CountDownLatch l = waiting;
		if (l != null) l.countDown();
		disconnect();
		io.shutdown();
		super.onDestroy();
	}

	/* uiMode is in configChanges, so a light/dark switch doesn't recreate the
	 * terminal (and drop the connection): recolor by hand instead */
	@Override
	public void onConfigurationChanged(Configuration c) {
		super.onConfigurationChanged(c);
		if (term != null) applyTheme();
	}

	private SharedPreferences prefs() {
		return getSharedPreferences("terminal", Context.MODE_PRIVATE);
	}

	/* ---------------- the screen ---------------- */

	private void buildScreen() {
		root = new LinearLayout(this);
		root.setOrientation(LinearLayout.VERTICAL);

		// header: status, router, Reconnect, text size
		header = new LinearLayout(this);
		header.setOrientation(LinearLayout.HORIZONTAL);
		header.setGravity(Gravity.CENTER_VERTICAL);
		header.setPadding(dp(16), dp(8), dp(8), dp(8));
		statusDot = new View(this);
		header.addView(statusDot, new LinearLayout.LayoutParams(dp(10), dp(10)));
		LinearLayout who = new LinearLayout(this);
		who.setOrientation(LinearLayout.VERTICAL);
		who.setPadding(dp(12), 0, dp(8), 0);
		titleView = label(name, 15, true);
		subView = label("Connecting…", 12.5f, false);
		who.addView(titleView);
		who.addView(subView);
		header.addView(who, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
		again = new Button(this);
		again.setText("Reconnect");
		again.setAllCaps(false);
		again.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
		again.setTypeface(Typeface.DEFAULT_BOLD);
		again.setStateListAnimator(null);
		again.setPadding(dp(14), 0, dp(14), 0);
		again.setMinWidth(0);
		again.setMinimumWidth(0);
		again.setVisibility(View.GONE);
		again.setOnClickListener(v -> {
			tsession.print("\r\n");
			connect();
		});
		header.addView(again, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)));
		header.addView(sizeButton("A−", -1));
		header.addView(sizeButton("A+", +1));
		root.addView(header);
		line1 = new View(this);
		root.addView(line1, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));

		// the terminal
		tsession = new TerminalSession(5000, new SessionClient());
		term = new TerminalView(this, null);
		term.setTerminalViewClient(new ViewClient());
		// setTextSize creates the view's renderer (monospace by default): it
		// must come before anything else that uses the renderer
		term.setTextSize(sp(textSize));
		term.setFocusable(true);
		term.setFocusableInTouchMode(true);
		term.attachSession(tsession);
		LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1);
		tl.leftMargin = dp(6);
		tl.topMargin = dp(4);
		root.addView(term, tl);

		// keys the phone keyboard doesn't have
		line2 = new View(this);
		root.addView(line2, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
		keyBar = new HorizontalScrollView(this);
		keyBar.setHorizontalScrollBarEnabled(false);
		keyRow = new LinearLayout(this);
		keyRow.setOrientation(LinearLayout.HORIZONTAL);
		keyRow.setPadding(dp(8), dp(7), dp(8), dp(7));
		addKey("Esc", () -> key(KeyEvent.KEYCODE_ESCAPE));
		addKey("Tab", () -> key(KeyEvent.KEYCODE_TAB));
		ctrlKey = addKey("Ctrl", () -> setCtrl(!ctrl));
		addKey("↑", () -> key(KeyEvent.KEYCODE_DPAD_UP));
		addKey("↓", () -> key(KeyEvent.KEYCODE_DPAD_DOWN));
		addKey("←", () -> key(KeyEvent.KEYCODE_DPAD_LEFT));
		addKey("→", () -> key(KeyEvent.KEYCODE_DPAD_RIGHT));
		for (String ch : new String[] { "|", "-", "/", "~" }) addKey(ch, () -> tsession.writeCodePoint(false, ch.codePointAt(0)));
		addKey("Home", () -> key(KeyEvent.KEYCODE_MOVE_HOME));
		addKey("End", () -> key(KeyEvent.KEYCODE_MOVE_END));
		addKey("PgUp", () -> key(KeyEvent.KEYCODE_PAGE_UP));
		addKey("PgDn", () -> key(KeyEvent.KEYCODE_PAGE_DOWN));
		addKey("Paste", this::paste);
		keyBar.addView(keyRow);
		root.addView(keyBar);

		setContentView(root);
	}

	private Button addKey(String label, Runnable action) {
		Button b = new Button(this);
		b.setText(label);
		b.setAllCaps(false);
		b.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
		b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
		b.setStateListAnimator(null);
		b.setMinWidth(dp(46));
		b.setMinimumWidth(dp(46));
		b.setPadding(dp(12), 0, dp(12), 0);
		// keys never take the focus, so the phone keyboard stays open
		b.setFocusable(false);
		b.setOnClickListener(v -> action.run());
		LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38));
		l.rightMargin = dp(6);
		keyRow.addView(b, l);
		keys.add(b);
		return b;
	}

	private View sizeButton(String label, int step) {
		TextView t = label(label, 14, true);
		t.setGravity(Gravity.CENTER);
		t.setOnClickListener(v -> setTextSize(textSize + step));
		t.setLayoutParams(new LinearLayout.LayoutParams(dp(40), dp(36)));
		return t;
	}

	private TextView label(String s, float sp, boolean bold) {
		TextView t = new TextView(this);
		t.setText(s);
		t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
		if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
		t.setSingleLine(true);
		t.setEllipsize(android.text.TextUtils.TruncateAt.END);
		return t;
	}

	/** Router Home's theme, on every part of the screen and the terminal's colors. */
	private void applyTheme() {
		colors = Theme.colors(this);
		Theme.bars(this);
		root.setBackgroundColor(colors.bg);
		header.setBackgroundColor(colors.surface);
		keyBar.setBackgroundColor(colors.surface);
		line1.setBackgroundColor(colors.line);
		line2.setBackgroundColor(colors.line);
		titleView.setTextColor(colors.ink);
		subView.setTextColor(colors.muted);
		for (int i = 0; i < header.getChildCount(); i++)
			if (header.getChildAt(i) instanceof TextView && !(header.getChildAt(i) instanceof Button))
				((TextView) header.getChildAt(i)).setTextColor(colors.ink);
		again.setTextColor(colors.accentInk);
		again.setBackground(round(colors.accent));
		for (Button b : keys) b.setTextColor(colors.ink);
		setCtrl(ctrl);
		showState(stateNow);

		Properties p = new Properties();
		p.put("background", Theme.hex(colors.bg));
		p.put("foreground", Theme.hex(colors.ink));
		p.put("cursor", Theme.hex(colors.accent));
		TerminalColors.COLOR_SCHEME.updateWith(p);
		if (tsession.getEmulator() != null) tsession.getEmulator().mColors.reset();
		term.setBackgroundColor(colors.bg);
		term.invalidate();
	}

	private GradientDrawable round(int color) {
		GradientDrawable d = new GradientDrawable();
		d.setColor(color);
		d.setCornerRadius(dp(99));
		return d;
	}

	private void setCtrl(boolean on) {
		ctrl = on;
		for (Button b : keys) {
			boolean lit = b == ctrlKey && on;
			b.setBackground(round(lit ? colors.accent : colors.surface2));
			b.setTextColor(lit ? colors.accentInk : colors.ink);
		}
	}

	private void setTextSize(int size) {
		textSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size));
		term.setTextSize(sp(textSize));
		prefs().edit().putInt("size", textSize).apply();
	}

	/** A key from the bar, with Ctrl if it's on. */
	private void key(int keyCode) {
		int mod = ctrl ? KeyHandler.KEYMOD_CTRL : 0;
		setCtrl(false);
		term.handleKeyCode(keyCode, mod);
	}

	private void paste() {
		ClipboardManager cm = getSystemService(ClipboardManager.class);
		ClipData c = cm == null ? null : cm.getPrimaryClip();
		if (c == null || c.getItemCount() == 0) return;
		CharSequence t = c.getItemAt(0).coerceToText(this);
		if (t != null && tsession.getEmulator() != null) tsession.getEmulator().paste(t.toString());
	}

	private void showKeyboard() {
		term.requestFocus();
		InputMethodManager imm = getSystemService(InputMethodManager.class);
		if (imm != null) imm.showSoftInput(term, 0);
	}

	/* connecting / connected / ended */
	private String stateNow = "connecting";

	private void state(String s) {
		runOnUiThread(() -> showState(s));
	}

	private void showState(String s) {
		stateNow = s;
		if (statusDot == null || colors == null) return;
		int c = "connected".equals(s) ? colors.good : "ended".equals(s) ? colors.bad : colors.warn;
		GradientDrawable d = new GradientDrawable();
		d.setShape(GradientDrawable.OVAL);
		d.setColor(c);
		statusDot.setBackground(d);
		subView.setText("connected".equals(s) ? user + "@" + host + (port == 22 ? "" : ":" + port)
				: "ended".equals(s) ? "Not connected" : "Connecting…");
		again.setVisibility("ended".equals(s) ? View.VISIBLE : View.GONE);
	}

	private void print(String text) {
		tsession.print(text);
	}

	private int dp(float v) {
		return (int) (v * getResources().getDisplayMetrics().density + .5f);
	}

	private int sp(float v) {
		return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, getResources().getDisplayMetrics());
	}

	/* ---------------- Termux terminal callbacks ---------------- */

	private final class SessionClient implements TerminalSessionClient {
		@Override public void onTextChanged(TerminalSession s) { term.onScreenUpdated(); }
		@Override public void onTitleChanged(TerminalSession s) { }
		@Override public void onSessionFinished(TerminalSession s) { }

		@Override
		public void onCopyTextToClipboard(TerminalSession s, String text) {
			ClipboardManager cm = getSystemService(ClipboardManager.class);
			if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("SSH", text));
		}

		@Override public void onPasteTextFromClipboard(TerminalSession s) { paste(); }
		@Override public void onBell(TerminalSession s) { }
		@Override public void onColorsChanged(TerminalSession s) { term.invalidate(); }
		@Override public void onTerminalCursorStateChange(boolean state) { }
		@Override public void setTerminalShellPid(TerminalSession s, int pid) { }
		@Override public Integer getTerminalCursorStyle() { return null; }
		@Override public void logError(String tag, String message) { }
		@Override public void logWarn(String tag, String message) { }
		@Override public void logInfo(String tag, String message) { }
		@Override public void logDebug(String tag, String message) { }
		@Override public void logVerbose(String tag, String message) { }
		@Override public void logStackTraceWithMessage(String tag, String message, Exception e) { }
		@Override public void logStackTrace(String tag, Exception e) { }
	}

	private final class ViewClient implements TerminalViewClient {
		/* pinch: one text size step at a time */
		@Override
		public float onScale(float scale) {
			if (scale < 0.9f || scale > 1.1f) {
				setTextSize(textSize + (scale > 1 ? 1 : -1));
				return 1.0f;
			}
			return scale;
		}

		@Override public void onSingleTapUp(MotionEvent e) { showKeyboard(); }
		@Override public boolean shouldBackButtonBeMappedToEscape() { return false; }
		@Override public boolean shouldEnforceCharBasedInput() { return false; }
		@Override public boolean shouldUseCtrlSpaceWorkaround() { return false; }
		@Override public boolean isTerminalViewSelected() { return true; }
		@Override public void copyModeChanged(boolean copyMode) { }
		@Override public boolean onKeyDown(int keyCode, KeyEvent e, TerminalSession s) { return false; }
		@Override public boolean onKeyUp(int keyCode, KeyEvent e) { return false; }
		@Override public boolean onLongPress(MotionEvent event) { return false; }

		/* the bar's Ctrl applies to the next key typed on the keyboard */
		@Override
		public boolean readControlKey() {
			if (!ctrl) return false;
			runOnUiThread(() -> setCtrl(false));
			ctrl = false;
			return true;
		}

		@Override public boolean readAltKey() { return false; }
		@Override public boolean readShiftKey() { return false; }
		@Override public boolean readFnKey() { return false; }
		@Override public boolean onCodePoint(int codePoint, boolean ctrlDown, TerminalSession s) { return false; }

		/* the terminal has its size: time to connect */
		@Override
		public void onEmulatorSet() {
			if (started) return;
			started = true;
			applyTheme();
			connect();
			term.post(TerminalActivity.this::showKeyboard);
		}

		@Override public void logError(String tag, String message) { }
		@Override public void logWarn(String tag, String message) { }
		@Override public void logInfo(String tag, String message) { }
		@Override public void logDebug(String tag, String message) { }
		@Override public void logVerbose(String tag, String message) { }
		@Override public void logStackTraceWithMessage(String tag, String message, Exception e) { }
		@Override public void logStackTrace(String tag, Exception e) { }
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
		if (tsession != null) tsession.setLink(null);
		// disconnecting sends a packet: never on the main thread
		new Thread(() -> {
			try { if (ch != null) ch.disconnect(); } catch (Exception ignored) { }
			try { if (s != null) s.disconnect(); } catch (Exception ignored) { }
		}).start();
	}

	private void run() {
		try {
			disconnect();
			state("connecting");
			print("Connecting to " + user + "@" + host + (port == 22 ? "" : ":" + port) + "…\r\n");
			String pw = store.password(id);
			boolean fromStore = pw != null, remember = false;

			for (int attempt = 0; attempt < 4 && !closed; attempt++) {
				if (pw == null) {
					String[] a = askPassword(attempt > 0);
					if (a == null) {
						print("\r\nNot connected.\r\n");
						ended();
						return;
					}
					pw = a[0];
					remember = a[1] != null;
					fromStore = false;
				}
				JSch jsch = new JSch();
				HostKeys hk = new HostKeys(store, id);
				jsch.setHostKeyRepository(hk);
				Session s = jsch.getSession(user, host, port);
				s.setPassword(pw);
				s.setUserInfo(new Asker(hk, pw));
				s.setConfig("StrictHostKeyChecking", "ask");
				s.setConfig("PreferredAuthentications", "password,keyboard-interactive");
				s.setServerAliveInterval(30000);
				try {
					s.connect(10000);
				} catch (JSchException e) {
					if (isAuthFailure(e)) {
						print(fromStore ? (pw.isEmpty() ? "The router has a password now.\r\n" : "The saved password didn't work.\r\n")
								: "Wrong password.\r\n");
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
				ended();
			}
		} catch (Exception e) {
			if (!closed) {
				print("\r\n" + explain(e) + "\r\n");
				ended();
			}
		} finally {
			connecting = false;
		}
	}

	private void openShell(Session s) throws Exception {
		ChannelShell ch = (ChannelShell) s.openChannel("shell");
		int c = Math.max(tsession.getColumns(), 20), r = Math.max(tsession.getRows(), 5);
		ch.setPtyType("xterm-256color", c, r, 0, 0);
		InputStream in = ch.getInputStream();
		OutputStream o = ch.getOutputStream();
		ch.connect(10000);
		out = o;
		shell = ch;
		// typed keys and size changes go to the channel, off the main thread
		tsession.setLink(new TerminalSession.Link() {
			@Override
			public void send(byte[] data) {
				io.execute(() -> {
					try {
						o.write(data);
						o.flush();
					} catch (Exception ignored) { }
				});
			}

			@Override
			public void resize(int cols, int rows, int w, int h) {
				io.execute(() -> ch.setPtySize(cols, rows, w, h));
			}
		});
		state("connected");
		// a foreground service while connected: without it Android freezes the
		// app a few seconds after you switch away, and the connection drops
		SshService.hold(getApplicationContext());
		byte[] buf = new byte[16384];
		try {
			int n;
			while ((n = in.read(buf)) >= 0) {
				if (n > 0) tsession.feed(buf, n);
			}
		} catch (java.io.IOException ignored) {
			// the connection dropped
		} finally {
			SshService.release(getApplicationContext());
		}
		if (closed) return;
		tsession.setLink(null);
		out = null;
		shell = null;
		// the router's shell ended by itself ("exit", Ctrl+D): back to the
		// router list. A dropped connection has no exit status: stay, with
		// Reconnect.
		if (ch.getExitStatus() != -1) {
			runOnUiThread(this::finish);
			return;
		}
		print("\r\n[Connection closed]\r\n");
		ended();
	}

	/* Shows the Reconnect button. Clears "connecting" first, so a tap on it
	 * right away isn't ignored while this thread is still winding down. */
	private void ended() {
		connecting = false;
		state("ended");
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

	/* ---------------- questions, as Router Home sheets ---------------- */

	private final Object askLock = new Object();
	private volatile CountDownLatch waiting;

	private interface Shower { void show(java.util.function.Consumer<Object> answer); }

	/** Shows a sheet on the main thread and waits for its answer (from the SSH thread). */
	private Object ask(Shower shower) {
		synchronized (askLock) {
			final Object[] result = new Object[1];
			CountDownLatch l = new CountDownLatch(1);
			waiting = l;
			runOnUiThread(() -> {
				if (isFinishing() || isDestroyed()) { l.countDown(); return; }
				shower.show(v -> { result[0] = v; l.countDown(); });
			});
			try {
				l.await();
			} catch (InterruptedException e) {
				return null;
			} finally {
				waiting = null;
			}
			return result[0];
		}
	}

	/** {password, remember ? "1" : null}, or null if cancelled. */
	private String[] askPassword(boolean again) {
		Object r = ask(answer -> {
			Sheet s = new Sheet(this, again ? "Try the password again" : "Sign in to " + name,
					"Password for " + user + ". Leave it empty if the router has no password.");
			CheckBox[] keep = new CheckBox[1];
			EditText pw = s.password(keep);
			s.show("Connect", false, yes -> answer.accept(yes
					? new String[] { pw.getText().toString(), keep[0].isChecked() ? "1" : null } : null));
			pw.requestFocus();
		});
		return (String[]) r;
	}

	private boolean askYesNo(String title, String text, String detail, String yes, boolean danger) {
		Object r = ask(answer -> {
			Sheet s = new Sheet(this, title, text);
			if (detail != null) s.detail(detail);
			s.show(yes, danger, ok -> answer.accept(ok));
		});
		return Boolean.TRUE.equals(r);
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
