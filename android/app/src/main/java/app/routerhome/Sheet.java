package app.routerhome;

import android.app.Activity;
import android.app.Dialog;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Router Home's bottom sheet, as a native dialog: a title, some text, optional
 * content and two buttons. Used by the SSH terminal for its questions.
 */
final class Sheet {
	interface Answer { void done(boolean yes); }

	private final Activity a;
	private final Theme.Colors c;
	private final Dialog dialog;
	private final LinearLayout body;
	private boolean answered;

	Sheet(Activity a, String title, String text) {
		this.a = a;
		this.c = Theme.colors(a);
		dialog = new Dialog(a);
		dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
		body = new LinearLayout(a);
		body.setOrientation(LinearLayout.VERTICAL);
		body.setPadding(dp(16), dp(10), dp(16), dp(20));
		GradientDrawable bg = new GradientDrawable();
		bg.setColor(c.bg);
		float r = dp(24);
		bg.setCornerRadii(new float[] { r, r, r, r, 0, 0, 0, 0 });
		body.setBackground(bg);

		View grabber = new View(a);
		grabber.setBackground(round(c.line, dp(3)));
		LinearLayout.LayoutParams gl = new LinearLayout.LayoutParams(dp(40), dp(5));
		gl.gravity = Gravity.CENTER_HORIZONTAL;
		gl.bottomMargin = dp(12);
		body.addView(grabber, gl);

		TextView t = text(title, 20, c.ink);
		t.setTypeface(Typeface.DEFAULT_BOLD);
		body.addView(t, wrap(0, dp(6)));
		if (text != null) body.addView(text(text, 15, c.muted), wrap(0, dp(14)));
	}

	/* ---------------- content ---------------- */

	/** A monospace box, for key fingerprints. */
	Sheet detail(String s) {
		TextView d = text(s, 13, c.ink);
		d.setTypeface(Typeface.MONOSPACE);
		d.setTextIsSelectable(true);
		d.setPadding(dp(14), dp(12), dp(14), dp(12));
		d.setBackground(round(c.surface, dp(14)));
		body.addView(d, wrap(0, dp(4)));
		return this;
	}

	/** A password field and a "remember" box, in a Router Home group. */
	EditText password(CheckBox[] keep) {
		LinearLayout group = new LinearLayout(a);
		group.setOrientation(LinearLayout.VERTICAL);
		group.setBackground(round(c.surface, dp(18)));
		group.setPadding(dp(16), dp(10), dp(16), dp(4));
		TextView label = text("Password", 13, c.muted);
		group.addView(label);
		EditText pw = new EditText(a);
		pw.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
		pw.setTextColor(c.ink);
		pw.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16.5f);
		pw.setBackground(null);
		pw.setPadding(0, dp(4), 0, dp(8));
		group.addView(pw, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
		View line = new View(a);
		line.setBackgroundColor(c.line);
		group.addView(line, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
		CheckBox cb = new CheckBox(a);
		cb.setText("Remember for this router");
		cb.setTextColor(c.ink);
		cb.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
		cb.setButtonTintList(ColorStateList.valueOf(c.accent));
		cb.setChecked(true);
		cb.setPadding(dp(6), dp(10), 0, dp(10));
		group.addView(cb);
		keep[0] = cb;
		body.addView(group, wrap(dp(4), 0));
		return pw;
	}

	/* ---------------- showing ---------------- */

	/** Shows it with Cancel and the given button; answer runs once. */
	void show(String yes, boolean danger, Answer answer) {
		LinearLayout row = new LinearLayout(a);
		row.setOrientation(LinearLayout.HORIZONTAL);
		Button no = button("Cancel", c.surface, c.ink, true);
		Button ok = button(yes, danger ? c.bad : c.accent, danger ? Color.WHITE : c.accentInk, false);
		LinearLayout.LayoutParams l1 = new LinearLayout.LayoutParams(0, dp(46), 1);
		l1.rightMargin = dp(5);
		LinearLayout.LayoutParams l2 = new LinearLayout.LayoutParams(0, dp(46), 1);
		l2.leftMargin = dp(5);
		row.addView(no, l1);
		row.addView(ok, l2);
		body.addView(row, wrap(dp(18), 0));

		no.setOnClickListener(v -> finish(answer, false));
		ok.setOnClickListener(v -> finish(answer, true));
		dialog.setOnCancelListener(d -> finish(answer, false));

		dialog.setContentView(body);
		Window w = dialog.getWindow();
		if (w != null) {
			w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
			w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
			w.setGravity(Gravity.BOTTOM);
			w.setWindowAnimations(android.R.style.Animation_InputMethod);
			w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE | WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
		}
		dialog.show();
	}

	private void finish(Answer answer, boolean yes) {
		if (answered) return;
		answered = true;
		dialog.dismiss();
		answer.done(yes);
	}

	/* ---------------- pieces ---------------- */

	private Button button(String label, int bg, int fg, boolean outline) {
		Button b = new Button(a);
		b.setText(label);
		b.setAllCaps(false);
		b.setTextColor(fg);
		b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15.5f);
		b.setTypeface(Typeface.DEFAULT_BOLD);
		b.setStateListAnimator(null);
		GradientDrawable d = round(bg, dp(99));
		if (outline) d.setStroke(dp(1), c.line);
		b.setBackground(d);
		return b;
	}

	private TextView text(String s, float sp, int color) {
		TextView t = new TextView(a);
		t.setText(s);
		t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
		t.setTextColor(color);
		return t;
	}

	private static GradientDrawable round(int color, float radius) {
		GradientDrawable d = new GradientDrawable();
		d.setColor(color);
		d.setCornerRadius(radius);
		return d;
	}

	private LinearLayout.LayoutParams wrap(int top, int bottom) {
		LinearLayout.LayoutParams l = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
		l.topMargin = top;
		l.bottomMargin = bottom;
		return l;
	}

	private int dp(float v) {
		return (int) (v * a.getResources().getDisplayMetrics().density + .5f);
	}
}
